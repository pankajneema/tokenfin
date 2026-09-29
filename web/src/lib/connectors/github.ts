/**
 * GitHub merged pull requests (fine-grained token, "Pull requests: read" +
 * "Contents: read" on the selected repos; classic `repo` also works).
 *   GET /user/repos?per_page=100                         — repos the token can see (when config.repos is empty)
 *   GET /repos/{owner}/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100
 *       → [{number, title, user.login, head.ref, head.sha, created_at, updated_at, merged_at}]
 *       (Link rel="next" pagination; the list omits additions/deletions)
 *   GET /repos/{owner}/{repo}/pulls/{number}             — additions, deletions
 *   GET /repos/{owner}/{repo}/commits/{sha}              — head-commit author email (noreply addresses ignored)
 * Docs (verified 2026-09-29): https://docs.github.com/en/rest/pulls/pulls
 * UNVERIFIED: /user/repos returns exactly the fine-grained token's selected repos.
 *
 * Only PRs not yet stored with line counts are fetched in detail (≤ MAX_DETAILS per run),
 * so a daily sync stays cheap and later runs back-fill the rest.
 */
import { request, nextLink } from './http'
import { githubBaseUrl, githubHeaders } from './copilot'

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const MAX_REPOS = 100
const MAX_LIST_PAGES = 20
export const MAX_DETAILS = 150

export interface MergedPrRow {
  repo: string; number: number; author_login: string; author_email: string | null
  opened_at: string | null; merged_at: string; additions: number | null; deletions: number | null
  head_ref: string; title: string
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {})
const s = (v: unknown) => (typeof v === 'string' ? v : '')

export function isNoreply(email: string): boolean {
  return /@users\.noreply\.github\.com$/i.test(email) || /^noreply@github\.com$/i.test(email)
}

/** Merged PRs from one list page (closed-but-unmerged and pre-window PRs dropped). */
export function parsePullList(json: unknown, repo: string, sinceIso: string): MergedPrRow[] {
  const out: MergedPrRow[] = []
  for (const p of Array.isArray(json) ? json : []) {
    const pr = obj(p)
    const merged = s(pr.merged_at)
    if (!merged || merged < sinceIso) continue
    out.push({
      repo, number: Number(pr.number) || 0,
      author_login: s(obj(pr.user).login), author_email: null,
      opened_at: s(pr.created_at) || null, merged_at: merged,
      additions: null, deletions: null,
      head_ref: s(obj(pr.head).ref), title: s(pr.title).slice(0, 500),
    })
  }
  return out.filter(r => r.number > 0)
}

async function listRepos(token: string): Promise<string[]> {
  const repos: string[] = []
  let url: string | null = `${githubBaseUrl()}/user/repos?per_page=100&sort=pushed`
  for (let i = 0; url && i < 5 && repos.length < MAX_REPOS; i++) {
    const r = await request('github', url, { headers: githubHeaders(token), secret: token })
    for (const x of Array.isArray(r.body) ? r.body : []) { const n = s(obj(x).full_name); if (REPO_RE.test(n)) repos.push(n) }
    url = nextLink(r.headers.get('link'))
  }
  return repos.slice(0, MAX_REPOS)
}

async function listMerged(token: string, repo: string, sinceIso: string): Promise<{ prs: MergedPrRow[]; heads: Map<number, string> }> {
  const prs: MergedPrRow[] = []
  const heads = new Map<number, string>()
  let url: string | null = `${githubBaseUrl()}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`
  for (let i = 0; url && i < MAX_LIST_PAGES; i++) {
    const r = await request('github', url, { headers: githubHeaders(token), secret: token })
    const page = Array.isArray(r.body) ? r.body : []
    prs.push(...parsePullList(page, repo, sinceIso))
    for (const p of page) { const pr = obj(p); const sha = s(obj(pr.head).sha); if (sha) heads.set(Number(pr.number), sha) }
    // Sorted by updated desc: once a page ends before the window, older pages can't hold new merges.
    const last = obj(page[page.length - 1])
    if (page.length === 0 || (s(last.updated_at) && s(last.updated_at) < sinceIso)) break
    url = nextLink(r.headers.get('link'))
  }
  return { prs, heads }
}

/**
 * Pull merged PRs since `since` for the configured repos (or all visible repos).
 * `known` = "repo#number" keys already stored WITH line counts (skipped for detail calls).
 */
export async function fetchMergedPrs(token: string, repos: string[], since: Date, known: Set<string> = new Set()): Promise<{ rows: MergedPrRow[]; warnings: string[] }> {
  const sinceIso = since.toISOString()
  const warnings: string[] = []
  const targets = repos.length ? repos.filter(r => REPO_RE.test(r)).slice(0, MAX_REPOS) : await listRepos(token)
  if (targets.length === 0) warnings.push('No repositories visible to this token — grant it access to at least one repo.')
  const rows: MergedPrRow[] = []
  let details = 0
  for (const repo of targets) {
    const { prs, heads } = await listMerged(token, repo, sinceIso)
    for (const pr of prs) {
      if (known.has(`${repo}#${pr.number}`)) { rows.push(pr); continue }
      if (details >= MAX_DETAILS) { rows.push(pr); continue }
      details++
      const d = await request('github', `${githubBaseUrl()}/repos/${repo}/pulls/${pr.number}`, { headers: githubHeaders(token), secret: token })
      pr.additions = Number(obj(d.body).additions ?? 0) || 0
      pr.deletions = Number(obj(d.body).deletions ?? 0) || 0
      const sha = heads.get(pr.number)
      if (sha) {
        try {
          const c = await request('github', `${githubBaseUrl()}/repos/${repo}/commits/${sha}`, { headers: githubHeaders(token), secret: token })
          const email = s(obj(obj(obj(c.body).commit).author).email).trim().toLowerCase()
          if (email && !isNoreply(email)) pr.author_email = email
        } catch { /* head commit gone (force-push / deleted fork) — email stays null */ }
      }
      rows.push(pr)
    }
  }
  if (details >= MAX_DETAILS) warnings.push(`Fetched line counts for ${MAX_DETAILS} PRs; the rest fill in on the next sync.`)
  return { rows, warnings }
}

export async function verifyGithubToken(token: string, repos: string[]): Promise<void> {
  if (repos.length) await request('github', `${githubBaseUrl()}/repos/${repos[0]}`, { headers: githubHeaders(token), secret: token })
  else await request('github', `${githubBaseUrl()}/user/repos?per_page=1`, { headers: githubHeaders(token), secret: token })
}
