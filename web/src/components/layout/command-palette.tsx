'use client'
/**
 * ⌘K command palette — fuzzy search over every nav destination and a few
 * actions, plus "Ask your spend" (POST /api/v1/ask) for anything that reads
 * like a question. ARIA combobox + listbox; ↑/↓, Home/End, Enter, Esc.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Search, X, CornerDownLeft, Sparkles, ArrowUpRight, Loader2, Compass } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusTrap, useBodyScrollLock } from '@/components/ui/dialog'
import { looksLikeQuestion } from '@/lib/ask/intents'
import { NAV_SECTIONS, EXTRA_PAGES, PALETTE_ACTIONS, type PaletteAction } from './nav-config'
import { fuzzyFilter } from './nav-match'

type Item =
  | { kind: 'page'; id: string; label: string; desc?: string; href: string; icon: React.ElementType; section: string; keywords?: string }
  | { kind: 'action'; id: string; label: string; desc?: string; icon: React.ElementType; action: PaletteAction; section: string; keywords?: string }
  | { kind: 'ask'; id: string; label: string; desc?: string; icon: React.ElementType; section: string; keywords?: string }

const PAGE_ITEMS: Item[] = [
  ...NAV_SECTIONS.flatMap(s => s.items.map(i => ({ kind: 'page' as const, id: 'p:' + i.href, label: i.label, desc: i.desc, href: i.href, icon: i.icon, section: s.label, keywords: i.keywords }))),
  ...EXTRA_PAGES.map(i => ({ kind: 'page' as const, id: 'p:' + i.href, label: i.label, desc: i.desc, href: i.href, icon: i.icon, section: 'Settings', keywords: i.keywords })),
]
const ACTION_ITEMS: Item[] = PALETTE_ACTIONS.map(a => ({ kind: 'action' as const, id: 'a:' + a.id, label: a.label, desc: a.desc, icon: a.icon, action: a, section: 'Actions', keywords: a.keywords }))

const RECENT_KEY = 'tf.palette.recent'
function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 5) : [] } catch { return [] }
}
function pushRecent(href: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([href, ...readRecent().filter(h => h !== href)].slice(0, 5))) } catch { /* ignore */ }
}

interface AskOk {
  intent: Record<string, unknown>
  answer: string
  table: { columns: string[]; rows: (string | number)[][] } | null
  link: string
  source: 'rules' | 'llm'
}
interface AskNone { intent: null; answer: string; examples: string[] }
type AskState = { status: 'idle' } | { status: 'loading'; q: string } | { status: 'done'; q: string; res: AskOk | AskNone } | { status: 'error'; q: string; message: string }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose)
  useBodyScrollLock(open)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)
  const listId   = useId()
  const [query, setQuery]   = useState('')
  const [cursor, setCursor] = useState(0)
  const [ask, setAsk]       = useState<AskState>({ status: 'idle' })
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); setAsk({ status: 'idle' }); setRecent(readRecent()) }
  }, [open])

  const groups = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const rec = recent.map(h => PAGE_ITEMS.find(p => p.kind === 'page' && p.href === h)).filter(Boolean) as Item[]
      const out: { label: string; items: Item[] }[] = []
      if (rec.length) out.push({ label: 'Recent', items: rec })
      out.push({ label: 'Actions', items: ACTION_ITEMS.slice(0, 4) })
      out.push({ label: 'Go to', items: PAGE_ITEMS.filter(p => !rec.includes(p)).slice(0, 8) })
      return out
    }
    const pages   = fuzzyFilter(q, PAGE_ITEMS, 8)
    const actions = fuzzyFilter(q, ACTION_ITEMS, 4)
    const askItem: Item = { kind: 'ask', id: 'ask', label: `Ask: “${q}”`, desc: 'Answer from your spend data', icon: Sparkles, section: 'Ask' }
    const question = looksLikeQuestion(q) || (pages.length === 0 && actions.length === 0)
    const out: { label: string; items: Item[] }[] = []
    if (question) out.push({ label: 'Ask your spend', items: [askItem] })
    if (pages.length)   out.push({ label: 'Pages', items: pages })
    if (actions.length) out.push({ label: 'Actions', items: actions })
    if (!question && q.length >= 3) out.push({ label: 'Ask your spend', items: [askItem] })
    return out
  }, [query, recent])

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])
  useEffect(() => { setCursor(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const runAsk = useCallback(async (q: string) => {
    setAsk({ status: 'loading', q })
    try {
      const res = await fetch('/api/v1/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error(body?.error ?? `Request failed (${res.status})`)
      setAsk({ status: 'done', q, res: body })
    } catch (e) {
      setAsk({ status: 'error', q, message: e instanceof Error ? e.message : 'Something went wrong' })
    }
  }, [])

  function choose(item: Item | undefined) {
    if (!item) return
    if (item.kind === 'ask') { void runAsk(query.trim()); return }
    if (item.kind === 'action' && item.action.run === 'toggle-theme') {
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); onClose(); return
    }
    const href = item.kind === 'page' ? item.href : item.action.href
    if (!href) return
    if (item.kind === 'page') pushRecent(href)
    onClose()
    router.push(href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (ask.status === 'done' || ask.status === 'error') {
      if (e.key === 'Enter' && ask.status === 'done' && ask.res.intent) { e.preventDefault(); onClose(); router.push(ask.res.link) }
      return
    }
    const n = flat.length
    if (!n) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0) }
    else if (e.key === 'End') { e.preventDefault(); setCursor(n - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[cursor]) }
  }

  if (!open) return null
  const showAnswer = ask.status !== 'idle'
  const activeId = !showAnswer && flat[cursor] ? `${listId}-opt-${cursor}` : undefined

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[8vh] sm:pt-[12vh] px-3 sm:px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-[600px] bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--fg-tertiary)] flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            data-autofocus
            role="combobox"
            aria-expanded={!showAnswer && flat.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search pages and actions, or ask about your spend"
            value={query}
            onChange={e => { setQuery(e.target.value); if (ask.status !== 'loading') setAsk({ status: 'idle' }) }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, actions — or ask “spend by model last week”"
            className="flex-1 min-w-0 bg-transparent text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); setAsk({ status: 'idle' }); inputRef.current?.focus() }}
              aria-label="Clear search" className="text-[var(--fg-tertiary)] hover:text-[var(--fg)] transition-colors rounded">
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close command palette"
            className="hidden sm:flex items-center px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[10px] font-mono text-[var(--fg-tertiary)] border border-[var(--border)] flex-shrink-0">
            Esc
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1" aria-live="polite">
          {showAnswer ? (
            <AskPanel state={ask} onExample={q => { setQuery(q); void runAsk(q) }} onBack={() => { setAsk({ status: 'idle' }); inputRef.current?.focus() }} onNavigate={onClose} />
          ) : (
            <div id={listId} role="listbox" aria-label="Results" ref={listRef} className="py-1.5">
              {groups.map(g => (
                <div key={g.label} role="group" aria-label={g.label}>
                  <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider" aria-hidden="true">{g.label}</div>
                  {g.items.map(item => {
                    const i = flat.indexOf(item)
                    const Icon = item.icon
                    const sel = cursor === i
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-opt-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={sel}
                        onMouseMove={() => { if (!sel) setCursor(i) }}
                        onClick={() => choose(item)}
                        className={cn('mx-1.5 flex items-center gap-3 px-2.5 py-2 rounded-xl cursor-pointer', sel ? 'bg-[var(--bg-secondary)]' : '')}
                      >
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                          item.kind === 'page' ? 'bg-[var(--bg-tertiary)]' : 'bg-coral/10')} aria-hidden="true">
                          <Icon size={15} className={item.kind === 'page' ? 'text-[var(--fg-secondary)]' : 'text-coral'} strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[var(--fg)] leading-tight truncate">{item.label}</p>
                          {item.desc && <p className="text-[11.5px] text-[var(--fg-tertiary)] leading-tight mt-0.5 truncate">{item.kind === 'page' ? `${item.section} · ${item.desc}` : item.desc}</p>}
                        </div>
                        {sel && <CornerDownLeft size={12} className="text-[var(--fg-tertiary)] flex-shrink-0" aria-hidden="true" />}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="hidden sm:flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-secondary)]/60 text-[10.5px] text-[var(--fg-tertiary)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-1">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-1">↵</kbd> open</span>
            <span className="flex items-center gap-1"><kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border)] rounded px-1">esc</kbd> close</span>
          </div>
          <span>⌘K / Ctrl K</span>
        </div>
      </div>
    </div>
  )
}

function AskPanel({ state, onExample, onBack, onNavigate }: {
  state: AskState; onExample: (q: string) => void; onBack: () => void; onNavigate: () => void
}) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') {
    return (
      <div className="px-5 py-8 flex items-center gap-2.5 text-[13px] text-[var(--fg-secondary)]" role="status">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Looking at your spend…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="px-5 py-6 space-y-3">
        <p className="text-[13px] text-[var(--red)]" role="alert">{state.message}</p>
        <button type="button" onClick={onBack} className="btn-secondary text-[12px] py-1.5">Back to results</button>
      </div>
    )
  }
  const res = state.res
  if (res.intent === null) {
    return (
      <div className="px-5 py-5 space-y-3">
        <p className="text-[13px] text-[var(--fg-secondary)]">{res.answer}</p>
        <ul className="flex flex-wrap gap-1.5">
          {res.examples.map(ex => (
            <li key={ex}>
              <button type="button" onClick={() => onExample(ex)}
                className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[12px] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:border-[var(--border-strong)]">
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="px-5 py-4 space-y-3">
      <div className="flex items-start gap-2.5">
        <Sparkles size={15} className="text-coral mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="text-[13.5px] text-[var(--fg)] leading-snug">{res.answer}</p>
      </div>
      {res.table && res.table.rows.length > 0 && (
        <div className="overflow-x-auto border border-[var(--border)] rounded-xl">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>{res.table.columns.map((c, i) => <th key={i} scope="col" className={cn('px-3 py-2 font-semibold text-[var(--fg-secondary)] whitespace-nowrap', i === 0 ? 'text-left' : 'text-right')}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {res.table.rows.map((r, ri) => (
                <tr key={ri} className="border-t border-[var(--border)]">
                  {r.map((v, ci) => <td key={ci} className={cn('px-3 py-1.5 whitespace-nowrap', ci === 0 ? 'text-left text-[var(--fg)] max-w-[220px] truncate' : 'text-right tabular-nums text-[var(--fg-secondary)]')}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[11px] text-[var(--fg-tertiary)]">
          {res.source === 'llm' ? 'Question interpreted by Claude (only your question was sent) · ' : ''}Metered = billed API usage · notional = subscription usage at API rates
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="btn-ghost text-[12px] py-1">Back</button>
          <Link href={res.link} onClick={onNavigate} className="btn-primary text-[12px] py-1.5">
            <Compass size={12} aria-hidden="true" /> Open in Explore <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  )
}
