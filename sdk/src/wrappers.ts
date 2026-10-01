/**
 * Auto-instrumentation for the official Anthropic and OpenAI SDKs.
 *
 * Both wrappers patch the client IN PLACE and return the same object, so the
 * values you get back (including APIPromise helpers like `.withResponse()` and
 * stream objects) are the SDK's own. Usage is observed on the side; any
 * failure inside TokenFin is swallowed and SDK errors propagate untouched.
 *
 * `@anthropic-ai/sdk` and `openai` are optional peer dependencies — they are
 * typed loosely here so the SDK has no hard dependency on either.
 */
import type { TokenFinClient } from './client'
import type { TrackEvent } from './types'
import { TokenFinPolicyError, findRoute, isModelBlocked } from './policy'

export interface WrapOptions {
  /** Attach the prompt text (last user message) to events. Off by default. */
  capturePrompts?: boolean
  /** Max characters of prompt text to send when capturePrompts is on. @default unlimited (the full prompt) */
  maxPromptChars?: number
  projectId?: string
  userEmail?: string
  sessionId?: string
  tags?: Record<string, string>
  metadata?: Record<string, unknown>
  /** @default "sdk" */
  source?: string
  /**
   * Rewrite `model` per the org's active model routes (GET /api/v1/policy,
   * e.g. an automatic switch after a usage limit). The event records
   * `metadata.routed_from`. @default true
   */
  routeModels?: boolean
  /**
   * Throw TokenFinPolicyError for models the org blocked (a limit's
   * "block in SDKs" action). Off by default: without it the wrapper only routes.
   * @default false
   */
  enforcePolicy?: boolean
  /**
   * Longest a call waits for the FIRST policy fetch (later calls never wait).
   * The fetch starts when the client is wrapped. @default 200
   */
  policyWaitMs?: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any
type Obj = Record<string | symbol, any>

const WRAPPED = Symbol.for('tokenfin.wrapped')

interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

// ─── Anthropic ────────────────────────────────────────────────────────────────

/**
 * Instrument an `Anthropic` client: `messages.create` (incl. `stream: true`),
 * and therefore `messages.stream()`, plus `beta.messages.create` when present.
 */
export function wrapAnthropic<T>(client: T, tf: TokenFinClient, opts: WrapOptions = {}): T {
  try {
    const c = client as unknown as Obj
    const gate = policyGate(tf, opts)
    patchMethod(c?.messages, 'create', (params, result, started, ctx) =>
      observe(result, started, tf, opts, 'anthropic', params, anthropicCollector(), ctx.routedFrom), undefined, gate)
    patchMethod(c?.beta?.messages, 'create', (params, result, started, ctx) =>
      observe(result, started, tf, opts, 'anthropic', params, anthropicCollector(), ctx.routedFrom), undefined, gate)
  } catch { /* never break the host */ }
  return client
}

function anthropicCollector(): Collector {
  const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let model: string | undefined
  let seen = false
  const apply = (usage: Obj | undefined | null) => {
    if (!usage) return
    seen = true
    if (usage.input_tokens != null)                u.input      = num(usage.input_tokens)
    if (usage.output_tokens != null)               u.output     = num(usage.output_tokens)
    if (usage.cache_read_input_tokens != null)     u.cacheRead  = num(usage.cache_read_input_tokens)
    if (usage.cache_creation_input_tokens != null) u.cacheWrite = num(usage.cache_creation_input_tokens)
  }
  return {
    final(res) { model = res?.model; apply(res?.usage) },
    chunk(ev) {
      if (ev?.type === 'message_start') { model = ev.message?.model ?? model; apply(ev.message?.usage) }
      else if (ev?.type === 'message_delta') apply(ev.usage) // output_tokens is cumulative
      return true
    },
    result: () => (seen ? { model, usage: u } : null),
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

/**
 * Instrument an `OpenAI` client: `chat.completions.create` and
 * `responses.create` (incl. streaming). When streaming a chat completion
 * without `stream_options.include_usage`, it is turned on automatically and
 * the extra usage-only chunk is hidden from your iterator.
 */
export function wrapOpenAI<T>(client: T, tf: TokenFinClient, opts: WrapOptions = {}): T {
  try {
    const c = client as unknown as Obj
    const gate = policyGate(tf, opts)
    patchMethod(c?.chat?.completions, 'create',
      (params, result, started, ctx) => observe(result, started, tf, opts, 'openai', params, openaiChatCollector(ctx.injected), ctx.routedFrom),
      (params) => {
        if (params && params.stream === true && !params.stream_options?.include_usage) {
          return { params: { ...params, stream_options: { ...(params.stream_options ?? {}), include_usage: true } }, injected: true }
        }
        return { params, injected: false }
      }, gate)
    patchMethod(c?.responses, 'create', (params, result, started, ctx) =>
      observe(result, started, tf, opts, 'openai', params, openaiResponsesCollector(), ctx.routedFrom), undefined, gate)
  } catch { /* never break the host */ }
  return client
}

function openaiUsage(usage: Obj): Usage {
  // Chat Completions: prompt_tokens (incl. cached) / completion_tokens.
  // Responses API:    input_tokens  (incl. cached) / output_tokens.
  const prompt = num(usage.prompt_tokens ?? usage.input_tokens)
  const cached = num(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens)
  return {
    input: Math.max(0, prompt - cached),
    output: num(usage.completion_tokens ?? usage.output_tokens),
    cacheRead: cached,
    cacheWrite: 0,
  }
}

function openaiChatCollector(injected: boolean): Collector {
  let usage: Usage | null = null
  let model: string | undefined
  return {
    final(res) { model = res?.model; if (res?.usage) usage = openaiUsage(res.usage) },
    chunk(ch) {
      if (ch?.model) model = ch.model
      if (ch?.usage) usage = openaiUsage(ch.usage)
      // Hide the usage-only trailer we asked for so caller code indexing choices[0] keeps working.
      return !(injected && ch?.usage && Array.isArray(ch.choices) && ch.choices.length === 0)
    },
    result: () => (usage ? { model, usage } : null),
  }
}

function openaiResponsesCollector(): Collector {
  let usage: Usage | null = null
  let model: string | undefined
  return {
    final(res) { model = res?.model; if (res?.usage) usage = openaiUsage(res.usage) },
    chunk(ev) {
      const r = ev?.response
      if (r?.model) model = r.model
      if (r?.usage) usage = openaiUsage(r.usage)
      return true
    },
    result: () => (usage ? { model, usage } : null),
  }
}

// ─── shared machinery ─────────────────────────────────────────────────────────

interface Collector {
  final(res: Obj): void
  /** Observe a stream chunk; return false to hide it from the caller. */
  chunk(ev: Obj): boolean
  result(): { model?: string; usage: Usage } | null
}

type Observer = (params: Obj, result: unknown, started: number, ctx: { injected: boolean; routedFrom?: string }) => unknown
type Prepare = (params: Obj) => { params: Obj; injected: boolean }

// ─── policy (model routes / blocks) ──────────────────────────────────────────

interface PolicyGate {
  /** Route / block `params.model`. Throws TokenFinPolicyError for a blocked model (enforcePolicy only). */
  apply(params: Obj): { params: Obj; routedFrom?: string }
  /** The first policy fetch is still running and the caller allows a short wait. */
  shouldWait(): boolean
  wait(): Promise<void>
}

function policyGate(tf: TokenFinClient, opts: WrapOptions): PolicyGate | undefined {
  const route = opts.routeModels !== false
  const enforce = opts.enforcePolicy === true
  if (!route && !enforce) return undefined
  const waitMs = opts.policyWaitMs ?? 200
  let pm: ReturnType<TokenFinClient['policy']>
  try { pm = tf.policy(); pm.refresh() } catch { return undefined }   // prefetch in the background
  return {
    apply(params) {
      const model = params?.model
      if (typeof model !== 'string' || !model) return { params }
      let policy = null
      try { pm.refresh(); policy = pm.current() } catch { return { params } }   // stale → background refresh
      if (!policy) return { params }
      let out = params
      let routedFrom: string | undefined
      if (route) {
        const r = findRoute(policy, model)
        if (r && r.to && r.to !== model) { out = { ...params, model: r.to }; routedFrom = model }
      }
      if (enforce && isModelBlocked(policy, out.model)) throw new TokenFinPolicyError(out.model)
      return { params: out, routedFrom }
    },
    shouldWait: () => waitMs > 0 && !pm.settled,
    wait: () => pm.ready(waitMs),
  }
}

/**
 * Run `invoke` after `gate` settles, returning a promise that ALSO exposes the
 * SDK promise helpers (`withResponse`, `asResponse`) so code such as
 * Anthropic's `messages.stream()` keeps working during the short first wait.
 */
function deferred(gate: Promise<void>, invoke: () => unknown): unknown {
  let inner: Obj | undefined
  const created = gate.then(() => { inner = invoke() as Obj })
  const out = created.then(() => inner) as Promise<unknown> & Obj
  for (const m of ['withResponse', 'asResponse']) {
    out[m] = (...a: unknown[]) => created.then(() => {
      const fn = inner?.[m]
      if (typeof fn !== 'function') throw new TypeError(`${m} is not available on this result`)
      return fn.apply(inner, a)
    })
  }
  return out
}

function patchMethod(target: Obj | undefined, name: string, observer: Observer, prepare?: Prepare, gate?: PolicyGate): void {
  if (!target || typeof target[name] !== 'function') return
  const original: AnyFn = target[name]
  if ((original as Obj)[WRAPPED]) return
  const wrapped = function (this: unknown, params: Obj, ...rest: unknown[]) {
    const self = this ?? target
    const invoke = () => {
      let routed = params
      let routedFrom: string | undefined
      if (gate) {
        try { ({ params: routed, routedFrom } = gate.apply(params)) }
        catch (e) { if (e instanceof TokenFinPolicyError) throw e; routed = params; routedFrom = undefined }
      }
      let callParams = routed
      let injected = false
      try {
        if (prepare) ({ params: callParams, injected } = prepare(routed))
      } catch { callParams = routed; injected = false }
      const started = Date.now()
      const result = original.call(self, callParams, ...rest) // SDK errors propagate untouched
      try {
        return observer(routed ?? {}, result, started, { injected, routedFrom }) as unknown
      } catch {
        return result
      }
    }
    let waiting = false
    try { waiting = !!gate?.shouldWait() } catch { waiting = false }
    return waiting ? deferred(gate!.wait(), invoke) : invoke()
  }
  ;(wrapped as Obj)[WRAPPED] = true
  target[name] = wrapped
}

/**
 * Observe a call result without replacing it. For promises we attach a side
 * `.then` BEFORE handing the promise back, so our handler runs before the
 * caller's continuation — which lets us patch a stream's async iterator in
 * place while keeping the exact object the SDK returned.
 */
function observe(result: unknown, started: number, tf: TokenFinClient, opts: WrapOptions,
  provider: string, params: Obj, collector: Collector, routedFrom?: string): unknown {
  const base: Record<string, unknown> = routedFrom ? { routed_from: routedFrom } : {}
  const handle = (value: unknown) => {
    try {
      if (isAsyncIterable(value)) instrumentStream(value as Obj, started, tf, opts, provider, params, collector, base)
      else if (value && typeof value === 'object') {
        collector.final(value as Obj)
        emit(tf, opts, provider, params, collector, started, base)
      }
    } catch { /* ignore */ }
  }
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    ;(result as PromiseLike<unknown>).then(handle, () => { /* SDK error: caller handles it */ })
    return result
  }
  handle(result)
  return result
}

function instrumentStream(stream: Obj, started: number, tf: TokenFinClient, opts: WrapOptions,
  provider: string, params: Obj, collector: Collector, base: Record<string, unknown> = {}): void {
  const origIter = stream[Symbol.asyncIterator]
  if (typeof origIter !== 'function' || origIter[WRAPPED]) return
  let done = false
  let firstTokenAt: number | null = null
  const finish = (status: string) => {
    if (done) return
    done = true
    emit(tf, opts, provider, params, collector, started,
      { ...base, stream: true, ...(firstTokenAt ? { ttft_ms: firstTokenAt - started } : {}), ...(status !== 'complete' ? { stream_status: status } : {}) })
  }
  const iterFn = function (this: unknown) {
    const it = origIter.call(stream) as AsyncIterator<unknown>
    const wrappedIt: AsyncIterator<unknown> = {
      async next(...a: [] | [unknown]) {
        for (;;) {
          let r: IteratorResult<unknown>
          try { r = await it.next(...a) } catch (e) { safe(() => finish('error')); throw e }
          if (r.done) { safe(() => finish('complete')); return r }
          let show = true
          safe(() => { if (firstTokenAt === null) firstTokenAt = Date.now(); show = collector.chunk(r.value as Obj) })
          if (show) return r
        }
      },
      async return(v?: unknown) {
        safe(() => finish('aborted'))
        return it.return ? it.return(v) : { done: true, value: v }
      },
      async throw(e?: unknown) {
        safe(() => finish('error'))
        if (it.throw) return it.throw(e)
        throw e
      },
    }
    return wrappedIt
  }
  ;(iterFn as Obj)[WRAPPED] = true
  stream[Symbol.asyncIterator] = iterFn
}

function emit(tf: TokenFinClient, opts: WrapOptions, provider: string, params: Obj,
  collector: Collector, started: number, extraMeta: Record<string, unknown>): void {
  safe(() => {
    const r = collector.result()
    if (!r) return
    const { usage } = r
    if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite <= 0) return
    const ev: TrackEvent = {
      model: r.model || params.model || 'unknown',
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead || undefined,
      cacheWriteTokens: usage.cacheWrite || undefined,
      latencyMs: Date.now() - started,
      provider,
      source: opts.source ?? 'sdk',
      tool: `${provider}-sdk`,
      projectId: opts.projectId,
      userEmail: opts.userEmail,
      sessionId: opts.sessionId,
      tags: opts.tags,
      metadata: Object.keys(extraMeta).length || opts.metadata ? { ...(opts.metadata ?? {}), ...extraMeta } : undefined,
    }
    if (opts.capturePrompts) {
      const text = lastUserText(params)
      if (text) ev.promptText = opts.maxPromptChars && opts.maxPromptChars > 0 ? text.slice(0, opts.maxPromptChars) : text
    }
    tf.track(ev)
  })
}

/** Text of the last user message (Anthropic/OpenAI chat) or Responses `input`. */
export function lastUserText(params: Obj): string | null {
  const content = (c: unknown): string => {
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map(b => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
    return ''
  }
  const msgs = Array.isArray(params?.messages) ? params.messages : Array.isArray(params?.input) ? params.input : null
  if (msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?.role === 'user') { const t = content(msgs[i].content); if (t) return t }
    }
    return null
  }
  if (typeof params?.input === 'string') return params.input
  return null
}

function isAsyncIterable(v: unknown): boolean {
  return !!v && typeof (v as Obj)[Symbol.asyncIterator] === 'function'
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function safe(fn: () => void): void {
  try { fn() } catch { /* never throw into the host */ }
}
