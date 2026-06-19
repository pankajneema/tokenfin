'use client'
import { useState, useMemo } from 'react'
import {
  Users, Plus, Search, MoreHorizontal, X,
  TrendingUp, TrendingDown, ShieldCheck,
  UserCog, Trash2, Mail, ChevronDown,
  AlertTriangle, Zap, DollarSign, BarChart3,
  Crown, Code2, Eye, UserPlus,
} from 'lucide-react'
import { cn, formatCost, formatTokens, formatNumber } from '@/lib/utils'
import type { TeamRow, MemberRow, ProjectRow } from './page'

/* ══════════════════════════════════════════════════════════════
   DEMO DATA — rich, realistic, CEO-relevant
   Each team + member has per-project cost breakdown
══════════════════════════════════════════════════════════════ */

const PROJECT_FILTER_ALL = '__all__'

interface DemoMember {
  id: string; name: string; email: string; avatar: string
  teamId: string; role: 'owner' | 'admin' | 'developer' | 'viewer'
  costs:    Record<string, number>  // projectId → cost
  tokens:   Record<string, number>
  reqs:     Record<string, number>
  lastActive: string
}

interface DemoTeam {
  id: string; name: string; projectId: string | null
  costs:   Record<string, number>
  tokens:  Record<string, number>
  reqs:    Record<string, number>
  budget:  number; warnAt: number; throttleAt: number
  trend:   number
}

const DEMO_PROJECTS: ProjectRow[] = [
  { id: 'p1', name: 'Backend API',    slug: 'backend-api'    },
  { id: 'p2', name: 'ML Pipeline',    slug: 'ml-pipeline'    },
  { id: 'p3', name: 'Customer Bot',   slug: 'customer-bot'   },
  { id: 'p4', name: 'Dev Playground', slug: 'dev-playground' },
]

const DEMO_TEAMS: DemoTeam[] = [
  {
    id: 't1', name: 'Backend Team', projectId: 'p1',
    costs:  { __all__: 1420.50, p1: 980.40, p2: 294.10, p3: 146.00 },
    tokens: { __all__: 128_000_000, p1: 88_000_000, p2: 26_000_000, p3: 14_000_000 },
    reqs:   { __all__: 8340, p1: 5740, p2: 1720, p3: 880 },
    budget: 1800, warnAt: 70, throttleAt: 90, trend: +8.2,
  },
  {
    id: 't2', name: 'ML Research', projectId: 'p2',
    costs:  { __all__: 840.30, p2: 672.24, p1: 126.05, p4: 42.01 },
    tokens: { __all__: 64_000_000, p2: 51_200_000, p1: 9_600_000, p4: 3_200_000 },
    reqs:   { __all__: 4820, p2: 3856, p1: 724, p4: 240 },
    budget: 1000, warnAt: 70, throttleAt: 90, trend: +14.1,
  },
  {
    id: 't3', name: 'Frontend', projectId: 'p3',
    costs:  { __all__: 450.10, p3: 382.59, p4: 67.51 },
    tokens: { __all__: 38_000_000, p3: 32_300_000, p4: 5_700_000 },
    reqs:   { __all__: 2910, p3: 2474, p4: 436 },
    budget: 600, warnAt: 70, throttleAt: 90, trend: -3.2,
  },
  {
    id: 't4', name: 'DevOps', projectId: null,
    costs:  { __all__: 136.70, p1: 90.22, p4: 46.48 },
    tokens: { __all__: 12_000_000, p1: 7_920_000, p4: 4_080_000 },
    reqs:   { __all__: 820, p1: 541, p4: 279 },
    budget: 300, warnAt: 70, throttleAt: 90, trend: +2.1,
  },
]

const DEMO_MEMBERS: DemoMember[] = [
  { id: 'm1', name: 'Alex Chen',    email: 'alex@corp.io',    avatar: 'AC', teamId: 't1', role: 'admin',
    costs:  { __all__: 842.30, p1: 580.80, p2: 174.70, p3: 86.80 },
    tokens: { __all__: 75_600_000, p1: 52_200_000, p2: 15_600_000, p3: 7_800_000 },
    reqs:   { __all__: 4920, p1: 3390, p2: 1020, p3: 510 },
    lastActive: new Date(Date.now() - 120_000).toISOString() },
  { id: 'm2', name: 'Sam Rivera',   email: 'sam@corp.io',     avatar: 'SR', teamId: 't1', role: 'developer',
    costs:  { __all__: 578.20, p1: 399.60, p2: 119.30, p3: 59.30 },
    tokens: { __all__: 52_400_000, p1: 35_800_000, p2: 10_400_000, p3: 6_200_000 },
    reqs:   { __all__: 3420, p1: 2350, p2: 700, p3: 370 },
    lastActive: new Date(Date.now() - 540_000).toISOString() },
  { id: 'm3', name: 'Priya Patel',  email: 'priya@corp.io',   avatar: 'PP', teamId: 't2', role: 'admin',
    costs:  { __all__: 504.18, p2: 403.34, p1: 75.63, p4: 25.21 },
    tokens: { __all__: 38_400_000, p2: 30_720_000, p1: 5_760_000, p4: 1_920_000 },
    reqs:   { __all__: 2892, p2: 2314, p1: 434, p4: 144 },
    lastActive: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'm4', name: 'Jordan Kim',   email: 'jordan@corp.io',  avatar: 'JK', teamId: 't2', role: 'developer',
    costs:  { __all__: 336.12, p2: 268.90, p1: 50.42, p4: 16.80 },
    tokens: { __all__: 25_600_000, p2: 20_480_000, p1: 3_840_000, p4: 1_280_000 },
    reqs:   { __all__: 1928, p2: 1542, p1: 290, p4: 96 },
    lastActive: new Date(Date.now() - 7_200_000).toISOString() },
  { id: 'm5', name: 'Morgan Lee',   email: 'morgan@corp.io',  avatar: 'ML', teamId: 't3', role: 'developer',
    costs:  { __all__: 270.06, p3: 229.55, p4: 40.51 },
    tokens: { __all__: 22_800_000, p3: 19_380_000, p4: 3_420_000 },
    reqs:   { __all__: 1746, p3: 1484, p4: 262 },
    lastActive: new Date(Date.now() - 1_200_000).toISOString() },
  { id: 'm6', name: 'Casey Wong',   email: 'casey@corp.io',   avatar: 'CW', teamId: 't3', role: 'developer',
    costs:  { __all__: 180.04, p3: 153.04, p4: 27.00 },
    tokens: { __all__: 15_200_000, p3: 12_920_000, p4: 2_280_000 },
    reqs:   { __all__: 1164, p3: 990, p4: 174 },
    lastActive: new Date(Date.now() - 86_400_000).toISOString() },
  { id: 'm7', name: 'Taylor Singh', email: 'taylor@corp.io',  avatar: 'TS', teamId: 't4', role: 'developer',
    costs:  { __all__: 82.02, p1: 54.13, p4: 27.89 },
    tokens: { __all__: 7_200_000, p1: 4_752_000, p4: 2_448_000 },
    reqs:   { __all__: 492, p1: 325, p4: 167 },
    lastActive: new Date(Date.now() - 10_800_000).toISOString() },
  { id: 'm8', name: 'Dana Park',    email: 'dana@corp.io',    avatar: 'DP', teamId: 't4', role: 'viewer',
    costs:  { __all__: 54.68, p1: 36.09, p4: 18.59 },
    tokens: { __all__: 4_800_000, p1: 3_168_000, p4: 1_632_000 },
    reqs:   { __all__: 328, p1: 216, p4: 112 },
    lastActive: new Date(Date.now() - 43_200_000).toISOString() },
]

/* ── Helpers ────────────────────────────────────────────────── */
const TEAM_COLORS = [
  { accent: '#E8533A', bg: '#FDECEA', ring: 'ring-coral/20'       },
  { accent: '#00C48C', bg: '#E6FAF4', ring: 'ring-teal/20'        },
  { accent: '#8B5CF6', bg: '#F5F3FF', ring: 'ring-purple-200'     },
  { accent: '#60A5FA', bg: '#EFF6FF', ring: 'ring-blue-200'       },
]

const ROLE_META: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  owner:     { label: 'Owner',     icon: Crown,      cls: 'bg-[var(--amber-bg)] text-[var(--amber)]'  },
  admin:     { label: 'Admin',     icon: ShieldCheck, cls: 'bg-[var(--blue-bg)] text-[var(--blue)]'   },
  developer: { label: 'Developer', icon: Code2,       cls: 'bg-[var(--green-bg)] text-[var(--green)]' },
  viewer:    { label: 'Viewer',    icon: Eye,         cls: 'bg-[var(--bg-tertiary)] text-[var(--fg-secondary)]' },
}

const AVATAR_COLORS = [
  'bg-[#FDECEA] text-coral border-coral/25',
  'bg-[#E6FAF4] text-teal border-teal/25',
  'bg-purple-50 text-purple-500 dark:bg-purple-900/20 border-purple-200',
  'bg-[var(--blue-bg)] text-[var(--blue)] border-[var(--blue)]/20',
  'bg-[var(--amber-bg)] text-[var(--amber)] border-[var(--amber)]/20',
]

function reltime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60)    return `${Math.round(s)}s ago`
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function budgetStatus(pct: number, warnAt: number, throttleAt: number) {
  if (pct >= throttleAt) return { color: '#E8533A', bg: 'bg-[var(--red-bg)]',   text: 'text-[var(--red)]',   label: 'Over limit' }
  if (pct >= warnAt)     return { color: '#F59E0B', bg: 'bg-[var(--amber-bg)]', text: 'text-[var(--amber)]', label: 'Warning'    }
  return                        { color: '#00C48C', bg: 'bg-[var(--green-bg)]', text: 'text-[var(--green)]', label: 'On track'   }
}

/* ── Mini sparkline ─────────────────────────────────────────── */
const SPARKS = [[4,7,5,9,6,11,8],[3,5,8,6,9,7,11],[6,4,7,5,8,6,9],[2,5,3,7,5,8,6]]
function Sparkline({ idx, color }: { idx: number; color: string }) {
  const d = SPARKS[idx % SPARKS.length]
  const max = Math.max(...d), min = Math.min(...d), range = max - min || 1
  const W = 56, H = 20, p = 2
  const pts = d.map((v, i) => `${((i/(d.length-1))*W).toFixed(1)},${(H-p-((v-min)/range)*(H-p*2)).toFixed(1)}`).join(' ')
  const id = `st${idx}${color.slice(1)}`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.25}/><stop offset="100%" stopColor={color} stopOpacity={0}/>
      </linearGradient></defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${id})`}/>
      <polyline points={pts} stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" fill="none"/>
    </svg>
  )
}

/* ── Budget bar ─────────────────────────────────────────────── */
function BudgetBar({ spent, budget, warnAt, throttleAt }: { spent: number; budget: number; warnAt: number; throttleAt: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const st  = budgetStatus(pct, warnAt, throttleAt)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={cn('text-[10.5px] font-semibold', st.text)}>{st.label}</span>
        <span className="text-[10.5px] text-[var(--fg-tertiary)] tabular-nums">{pct.toFixed(0)}% of {formatCost(budget)}</span>
      </div>
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: st.color }} />
      </div>
    </div>
  )
}

/* ── Team card ──────────────────────────────────────────────── */
function TeamCard({
  team, idx, project, members,
}: {
  team: DemoTeam; idx: number; project: string; members: DemoMember[]
}) {
  const pal       = TEAM_COLORS[idx % TEAM_COLORS.length]
  const cost      = team.costs[project]    ?? 0
  const tokens    = team.tokens[project]   ?? 0
  const reqs      = team.reqs[project]     ?? 0
  const totalCost = team.costs[PROJECT_FILTER_ALL] ?? 0
  const pct       = team.budget > 0 ? (cost / team.budget) * 100 : 0
  const st        = budgetStatus(pct, team.warnAt, team.throttleAt)

  // Top 2 members for this project
  const topMembers = members
    .filter(m => m.teamId === team.id && (m.costs[project] ?? 0) > 0)
    .sort((a, b) => (b.costs[project] ?? 0) - (a.costs[project] ?? 0))
    .slice(0, 2)

  const efficiency = tokens > 0 ? (cost / tokens * 1000).toFixed(4) : '—'

  return (
    <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden hover:shadow-lg hover:border-[var(--border-strong)] transition-all duration-200 flex flex-col">
      {/* Accent bar */}
      <div className="h-1.5" style={{ backgroundColor: pal.accent }} />

      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: pal.bg }}>
              <Users size={16} style={{ color: pal.accent }} strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-[13.5px] font-bold text-[var(--fg)]">{team.name}</h3>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{members.filter(m => m.teamId === team.id).length} members</p>
            </div>
          </div>
          {/* Budget status chip */}
          <div className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0', st.bg, st.text)}>
            {pct >= team.throttleAt && <AlertTriangle size={9} />}
            {st.label}
          </div>
        </div>

        {/* Cost + trend */}
        <div>
          <div className="flex items-end justify-between gap-1">
            <p className="text-[24px] font-bold text-[var(--fg)] tabular-nums leading-none tracking-tight">
              {formatCost(cost)}
            </p>
            <div className={cn('flex items-center gap-0.5 text-[11px] font-semibold mb-0.5', team.trend >= 0 ? 'text-[var(--red)]' : 'text-[var(--green)]')}>
              {team.trend >= 0 ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}
              {team.trend >= 0 ? '+' : ''}{team.trend}%
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-0.5">this month vs last</p>
        </div>

        {/* Budget bar */}
        {team.budget > 0 && <BudgetBar spent={cost} budget={team.budget} warnAt={team.warnAt} throttleAt={team.throttleAt} />}

        {/* Metrics row */}
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--fg-secondary)]">
              <Zap size={10} style={{ color: pal.accent }} />
              <span className="tabular-nums font-medium">{formatTokens(tokens)}</span>
              <span className="text-[var(--fg-tertiary)]">tokens</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--fg-secondary)]">
              <BarChart3 size={10} style={{ color: pal.accent }} />
              <span className="tabular-nums font-medium">{formatNumber(reqs)}</span>
              <span className="text-[var(--fg-tertiary)]">requests</span>
            </div>
          </div>
          <Sparkline idx={idx} color={pal.accent} />
        </div>

        {/* Top members */}
        {topMembers.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3 space-y-2">
            <p className="text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider">Top spenders</p>
            {topMembers.map((m, mi) => {
              const mCost = m.costs[project] ?? 0
              return (
                <div key={m.id} className="flex items-center gap-2">
                  <div className={cn('w-6 h-6 rounded-full border flex items-center justify-center text-[9px] font-bold flex-shrink-0', AVATAR_COLORS[(DEMO_MEMBERS.indexOf(m)) % AVATAR_COLORS.length])}>
                    {m.avatar}
                  </div>
                  <span className="text-[11.5px] text-[var(--fg)] font-medium flex-1 truncate">{m.name}</span>
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color: pal.accent }}>{formatCost(mCost)}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer: efficiency */}
        <div className="mt-auto pt-3 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-[10.5px] text-[var(--fg-tertiary)]">
            Efficiency: <span className="font-semibold text-[var(--fg)]">${efficiency}</span>/1K tokens
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: pal.accent }}>
            <DollarSign size={11} />
            {totalCost > 0 ? ((cost / totalCost) * 100).toFixed(0) : 0}% of org
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Role badge ─────────────────────────────────────────────── */
function RoleBadge({ role }: { role: string }) {
  const m = ROLE_META[role] ?? ROLE_META.viewer
  const Icon = m.icon
  return (
    <div className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold', m.cls)}>
      <Icon size={9} strokeWidth={2.5} /> {m.label}
    </div>
  )
}

/* ── Invite modal ───────────────────────────────────────────── */
function InviteModal({ teams, onClose }: { teams: DemoTeam[]; onClose: () => void }) {
  const [emails,   setEmails]   = useState<string[]>([])
  const [input,    setInput]    = useState('')
  const [role,     setRole]     = useState<'admin' | 'developer' | 'viewer'>('developer')
  const [teamId,   setTeamId]   = useState<string>('')
  const [loading,  setLoading]  = useState(false)
  const [sent,     setSent]     = useState(false)

  function addEmail(val: string) {
    const trimmed = val.trim().replace(/,+$/, '')
    if (trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && !emails.includes(trimmed)) {
      setEmails(e => [...e, trimmed])
    }
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key)) { e.preventDefault(); addEmail(input) }
    if (e.key === 'Backspace' && !input && emails.length) setEmails(e => e.slice(0, -1))
  }

  async function handleSend() {
    if (!emails.length) return
    setLoading(true)
    await new Promise(r => setTimeout(r, 900))
    setSent(true)
    setLoading(false)
  }

  if (sent) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[400px] p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[var(--green-bg)] flex items-center justify-center mx-auto mb-4">
          <Mail size={24} className="text-teal" />
        </div>
        <h3 className="text-[16px] font-bold text-[var(--fg)] mb-2">Invitations sent!</h3>
        <p className="text-[13px] text-[var(--fg-secondary)] mb-5">
          {emails.length} invitation{emails.length > 1 ? 's' : ''} sent. They'll receive an email to join the workspace.
        </p>
        <button onClick={onClose} className="btn-primary w-full justify-center">Done</button>
      </div>
    </div>
  )

  const ROLES: { value: 'admin' | 'developer' | 'viewer'; label: string; desc: string }[] = [
    { value: 'admin',     label: 'Admin',     desc: 'Manage team, keys & budgets'    },
    { value: 'developer', label: 'Developer', desc: 'Use API keys, view own usage'   },
    { value: 'viewer',    label: 'Viewer',    desc: 'Read-only access to dashboards' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-[460px] overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--fg)]">Invite members</h2>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">Add engineers to your workspace</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Email input */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Email addresses
            </label>
            <div className="flex flex-wrap gap-1.5 p-2.5 border border-[var(--border)] rounded-xl focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/20 min-h-[48px] transition-all">
              {emails.map(e => (
                <div key={e} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#FDECEA] text-coral text-[11.5px] font-medium">
                  <span>{e}</span>
                  <button onClick={() => setEmails(prev => prev.filter(x => x !== e))} className="hover:opacity-70 transition-opacity">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => addEmail(input)}
                placeholder={emails.length ? '' : 'alex@company.com, sam@company.com'}
                className="flex-1 min-w-[160px] text-[12.5px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] bg-transparent focus:outline-none"
              />
            </div>
            <p className="text-[10.5px] text-[var(--fg-tertiary)] mt-1.5">Press Enter or comma to add multiple emails</p>
          </div>

          {/* Role selector */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-2">
              Role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 p-3 rounded-xl border text-left transition-all duration-150',
                    role === r.value
                      ? 'border-coral bg-[#FDECEA] dark:bg-coral/10'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span className="text-[12px] font-bold text-[var(--fg)]">{r.label}</span>
                  <span className="text-[10px] text-[var(--fg-tertiary)] leading-snug">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Team assignment */}
          <div>
            <label className="text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider block mb-1.5">
              Assign to team <span className="normal-case font-normal text-[var(--fg-tertiary)]">(optional)</span>
            </label>
            <div className="relative">
              <select
                value={teamId}
                onChange={e => setTeamId(e.target.value)}
                className="input appearance-none pr-8 text-[13px]"
              >
                <option value="">No team (org member)</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <button onClick={onClose} className="btn-secondary text-[13px] py-2">Cancel</button>
          <button
            onClick={handleSend}
            disabled={!emails.length || loading}
            className="btn-primary text-[13px] py-2 min-w-[140px] justify-center"
          >
            {loading
              ? <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              : <><Mail size={13} /> Send {emails.length > 0 ? `${emails.length} ` : ''}invite{emails.length !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Props ──────────────────────────────────────────────────── */
interface Props {
  teams:    TeamRow[]
  members:  MemberRow[]
  projects: ProjectRow[]
  orgId:    string
}

/* ═══════════════════════════════════════════════════════════════
   MAIN CLIENT COMPONENT
══════════════════════════════════════════════════════════════ */
export function TeamsClient({ teams: rawTeams, members: rawMembers, projects: rawProjects, orgId }: Props) {
  const [project,    setProject]    = useState(PROJECT_FILTER_ALL)
  const [search,     setSearch]     = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [memberMenu, setMemberMenu] = useState<string | null>(null)

  // Use demo data when DB is empty
  const useDemo    = rawTeams.length === 0
  const allTeams   = useDemo ? DEMO_TEAMS   : (rawTeams   as unknown as DemoTeam[])
  const allMembers = useDemo ? DEMO_MEMBERS : (rawMembers as unknown as DemoMember[])
  const allProjects= (useDemo || rawProjects.length === 0) ? DEMO_PROJECTS : rawProjects

  // Members visible for selected project
  const visibleMembers = useMemo(() => {
    let ms = allMembers as DemoMember[]
    if (project !== PROJECT_FILTER_ALL) ms = ms.filter(m => (m.costs?.[project] ?? 0) > 0)
    if (search.trim()) {
      const q = search.toLowerCase()
      ms = ms.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    }
    return ms.sort((a, b) => (b.costs?.[project] ?? b.costs?.[PROJECT_FILTER_ALL] ?? 0) - (a.costs?.[project] ?? a.costs?.[PROJECT_FILTER_ALL] ?? 0))
  }, [allMembers, project, search])

  // Teams visible for selected project
  const visibleTeams = useMemo(() => {
    const ts = allTeams as DemoTeam[]
    if (project === PROJECT_FILTER_ALL) return ts
    return ts.filter(t => (t.costs?.[project] ?? 0) > 0)
  }, [allTeams, project])

  // Summary stats
  const totalSpend   = visibleTeams.reduce((s, t) => s + ((t as DemoTeam).costs?.[project] ?? 0), 0)
  const totalMembers = visibleMembers.length
  const avgBudgetPct = visibleTeams.length
    ? visibleTeams.reduce((s, t) => {
        const dt = t as DemoTeam
        const spent = dt.costs?.[project] ?? 0
        return s + (dt.budget > 0 ? (spent / dt.budget) * 100 : 0)
      }, 0) / visibleTeams.length
    : 0

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Teams</h1>
          <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
            Budget tracking & member attribution · Last 30 days
          </p>
        </div>
        <button onClick={() => setShowInvite(true)} className="btn-primary text-[13px]">
          <UserPlus size={14} /> Invite member
        </button>
      </div>

      {/* ── PROJECT FILTER (CEO's power move) ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider flex-shrink-0">
          <BarChart3 size={12} />
          Filter by project
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* All */}
          <button
            onClick={() => setProject(PROJECT_FILTER_ALL)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150',
              project === PROJECT_FILTER_ALL
                ? 'bg-[var(--fg)] text-[var(--bg)]'
                : 'bg-[var(--bg-secondary)] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--bg-tertiary)]',
            )}
          >
            All projects
            <span className={cn('text-[10px] tabular-nums', project === PROJECT_FILTER_ALL ? 'opacity-70' : 'text-[var(--fg-tertiary)]')}>
              {formatCost(allTeams.reduce((s, t) => s + ((t as DemoTeam).costs?.[PROJECT_FILTER_ALL] ?? 0), 0))}
            </span>
          </button>

          {/* Per project */}
          {allProjects.map((proj, pi) => {
            const projCost = allTeams.reduce((s, t) => s + ((t as DemoTeam).costs?.[proj.id] ?? 0), 0)
            const projTrend = [+8.2, +14.1, -3.2, +2.1][pi % 4]
            const isSelected = project === proj.id
            const dotColor = ['#E8533A','#00C48C','#8B5CF6','#60A5FA'][pi % 4]
            return (
              <button
                key={proj.id}
                onClick={() => setProject(proj.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 border',
                  isSelected
                    ? 'border-coral bg-[#FDECEA] dark:bg-coral/10 text-coral'
                    : 'border-transparent bg-[var(--bg-secondary)] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
                {proj.name}
                <span className={cn('text-[10px] tabular-nums', isSelected ? 'text-coral/70' : 'text-[var(--fg-tertiary)]')}>
                  {formatCost(projCost)}
                </span>
                <span className={cn('text-[9.5px] font-semibold', projTrend >= 0 ? 'text-[var(--red)]' : 'text-[var(--green)]')}>
                  {projTrend >= 0 ? '↑' : '↓'}{Math.abs(projTrend)}%
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Teams',         value: String(visibleTeams.length),    icon: Users,       color: 'text-coral'           },
          { label: 'Members',       value: String(totalMembers),           icon: UserCog,     color: 'text-teal'            },
          { label: 'Total spend',   value: formatCost(totalSpend),         icon: DollarSign,  color: 'text-[var(--blue)]'   },
          { label: 'Avg budget used', value: `${avgBudgetPct.toFixed(0)}%`, icon: BarChart3, color: avgBudgetPct >= 90 ? 'text-[var(--red)]' : avgBudgetPct >= 70 ? 'text-[var(--amber)]' : 'text-[var(--green)]' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-secondary)] flex items-center justify-center flex-shrink-0">
              <s.icon size={15} className={s.color} />
            </div>
            <div>
              <p className={cn('text-[16px] font-bold tabular-nums', s.color)}>{s.value}</p>
              <p className="text-[10.5px] text-[var(--fg-tertiary)]">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Team cards ── */}
      {visibleTeams.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {visibleTeams.map((t, i) => (
            <TeamCard
              key={(t as DemoTeam).id}
              team={t as DemoTeam}
              idx={i}
              project={project}
              members={allMembers as DemoMember[]}
            />
          ))}
        </div>
      )}

      {/* ── Members table ── */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--fg)]">All Members</h2>
            <p className="text-[11.5px] text-[var(--fg-secondary)] mt-0.5">
              {visibleMembers.length} {project !== PROJECT_FILTER_ALL ? 'engineers on this project' : 'engineers total'}
            </p>
          </div>
          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search members…"
              className="input pl-7 text-[12px] py-1.5 w-48"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50">
                {['Member', 'Team', 'Role', 'Cost', 'Tokens', 'Requests', 'Efficiency', 'Last active', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-[var(--fg-tertiary)] uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((m, mi) => {
                const dm     = m as DemoMember
                const cost   = dm.costs?.[project]  ?? 0
                const tokens = dm.tokens?.[project] ?? 0
                const reqs   = dm.reqs?.[project]   ?? 0
                const eff    = tokens > 0 ? `$${(cost / tokens * 1000).toFixed(4)}/1K` : '—'
                const team   = allTeams.find(t => (t as DemoTeam).id === dm.teamId) as DemoTeam | undefined
                const ti     = allTeams.indexOf(team as any)
                const pal    = TEAM_COLORS[ti % TEAM_COLORS.length] ?? TEAM_COLORS[0]
                const ai     = DEMO_MEMBERS.indexOf(dm)

                return (
                  <tr key={dm.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors group">
                    {/* Member */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className={cn('w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-bold flex-shrink-0', AVATAR_COLORS[ai % AVATAR_COLORS.length])}>
                          {dm.avatar}
                        </div>
                        <div>
                          <p className="text-[12.5px] font-semibold text-[var(--fg)]">{dm.name}</p>
                          <p className="text-[10.5px] text-[var(--fg-tertiary)]">{dm.email}</p>
                        </div>
                      </div>
                    </td>
                    {/* Team */}
                    <td className="px-4 py-3.5">
                      {team ? (
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: pal.accent }} />
                          <span className="text-[12px] text-[var(--fg-secondary)]">{team.name}</span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--fg-tertiary)]">—</span>
                      )}
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3.5"><RoleBadge role={dm.role} /></td>
                    {/* Cost */}
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] font-bold text-[var(--fg)] tabular-nums">{formatCost(cost)}</span>
                    </td>
                    {/* Tokens */}
                    <td className="px-4 py-3.5 text-[12px] text-[var(--fg-secondary)] tabular-nums">{formatTokens(tokens)}</td>
                    {/* Requests */}
                    <td className="px-4 py-3.5 text-[12px] text-[var(--fg-secondary)] tabular-nums">{formatNumber(reqs)}</td>
                    {/* Efficiency */}
                    <td className="px-4 py-3.5">
                      <span className="text-[11.5px] font-mono text-[var(--fg-secondary)]">{eff}</span>
                    </td>
                    {/* Last active */}
                    <td className="px-4 py-3.5 text-[11.5px] text-[var(--fg-tertiary)] whitespace-nowrap">
                      {reltime(dm.lastActive)}
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="relative">
                        <button
                          onClick={() => setMemberMenu(memberMenu === dm.id ? null : dm.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--fg-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--fg)] transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                        {memberMenu === dm.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMemberMenu(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-lg py-1.5 min-w-[150px]">
                              <button className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors" onClick={() => setMemberMenu(null)}>
                                <UserCog size={12} /> Change role
                              </button>
                              <button className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] transition-colors" onClick={() => setMemberMenu(null)}>
                                <Users size={12} /> Move team
                              </button>
                              <div className="my-1 border-t border-[var(--border)]" />
                              <button className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--red)] hover:bg-[var(--red-bg)] transition-colors" onClick={() => setMemberMenu(null)}>
                                <Trash2 size={12} /> Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}

              {visibleMembers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center">
                    <p className="text-[13px] text-[var(--fg-secondary)]">No members found{search ? ` for "${search}"` : ''}</p>
                    {search && <button onClick={() => setSearch('')} className="text-[12px] text-coral hover:underline mt-1">Clear search</button>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && <InviteModal teams={allTeams as DemoTeam[]} onClose={() => setShowInvite(false)} />}
    </div>
  )
}
