/**
 * Single source of truth for the dashboard information architecture:
 * the sidebar sections, the topbar title, and the ⌘K palette destinations.
 */
import {
  LayoutDashboard, Gauge, Compass, BarChart3, Cpu, Layers, Receipt, MessageSquareText, History,
  Waypoints, PiggyBank, Lightbulb, FlaskConical, Scale, Code2, Terminal, Shield, Bell, Boxes, Key,
  Users, UserPlus, Plug, Puzzle, GitBranch, Settings, User, BellRing, Database, Building2, ScrollText,
  Split, Plus, Rocket, FolderPlus, Moon,
} from 'lucide-react'

export interface NavLink {
  label:     string
  href:      string
  icon:      React.ElementType
  /** Extra words the palette matches on. */
  keywords?: string
  /** One-line description (palette + topbar subtitle). */
  desc?:     string
}

export interface NavSection {
  id:    string
  label: string
  items: NavLink[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview', label: 'Overview',
    items: [
      { label: 'Overview', href: '/dashboard',          icon: LayoutDashboard, desc: 'All projects · last 30 days', keywords: 'home dashboard kpi' },
      { label: 'My usage', href: '/dashboard/my-usage', icon: Gauge,           desc: 'Your personal spend',         keywords: 'me personal mine' },
      { label: 'Explore',  href: '/dashboard/explore',  icon: Compass,         desc: 'Slice spend by any dimension', keywords: 'query pivot filter drill' },
    ],
  },
  {
    id: 'analyze', label: 'Analyze',
    items: [
      { label: 'Usage',        href: '/dashboard/analytics',                icon: BarChart3,         desc: 'Usage, costs & trends',          keywords: 'analytics chart tokens' },
      { label: 'By model',     href: '/dashboard/analytics/models',         icon: Cpu,               desc: 'Cost and tokens per model',      keywords: 'llm claude gpt' },
      { label: 'By project',   href: '/dashboard/analytics/projects',       icon: Layers,            desc: 'Cost and budgets per project' },
      { label: 'Cost reports', href: '/dashboard/analytics/costs',          icon: Receipt,           desc: 'Daily cost report',              keywords: 'spend daily chargeback' },
      { label: 'Prompts',      href: '/dashboard/analytics/prompts',        icon: MessageSquareText, desc: 'Most expensive prompts' },
      { label: 'Sessions',     href: '/dashboard/sessions',                 icon: History,           desc: 'Agent sessions',                 keywords: 'claude code runs' },
      { label: 'Traces',       href: '/dashboard/traces',                   icon: Waypoints,         desc: 'Spans and traces',               keywords: 'otel span latency' },
      { label: 'Savings',      href: '/dashboard/analytics/savings',        icon: PiggyBank,         desc: 'Measured & estimated savings',   keywords: 'cache compress' },
      { label: 'Insights',     href: '/dashboard/insights',                 icon: Lightbulb,         desc: 'Recommendations',                keywords: 'recommendations anomalies tips' },
      { label: 'What-if',      href: '/dashboard/analytics/what-if',        icon: FlaskConical,      desc: 'Model-switch simulator',         keywords: 'simulate scenario whatif' },
      { label: 'Bill check',   href: '/dashboard/analytics/reconciliation', icon: Scale,             desc: 'Metered vs provider bill',       keywords: 'reconcile invoice reconciliation' },
    ],
  },
  {
    id: 'engineering', label: 'Engineering',
    items: [
      { label: 'Productivity', href: '/dashboard/productivity', icon: Code2,    desc: 'Cost per PR, commit & line', keywords: 'commits pull requests lines' },
      { label: 'Coding tools', href: '/dashboard/coding-tools', icon: Terminal, desc: 'Cursor, Copilot & CLI seats', keywords: 'cursor copilot github' },
    ],
  },
  {
    id: 'govern', label: 'Govern',
    items: [
      { label: 'Limits',   href: '/dashboard/limits', icon: Shield, desc: 'Budgets & spend controls', keywords: 'budget cap quota' },
      { label: 'Alerts',   href: '/dashboard/alerts', icon: Bell,   desc: 'Notification rules',       keywords: 'notify slack email webhook' },
      { label: 'Models',   href: '/dashboard/models', icon: Boxes,  desc: 'Model registry & custom prices', keywords: 'pricing registry' },
      { label: 'API keys', href: '/dashboard/keys',   icon: Key,    desc: 'Ingest & read keys',       keywords: 'tokens credentials' },
    ],
  },
  {
    id: 'team', label: 'Team',
    items: [
      { label: 'Teams',     href: '/dashboard/teams',     icon: Users,    desc: 'Members & permissions', keywords: 'people members roles projects' },
      { label: 'Provision', href: '/dashboard/provision', icon: UserPlus, desc: 'Bulk onboard members',  keywords: 'invite onboard' },
    ],
  },
  {
    id: 'connect', label: 'Connect',
    items: [
      { label: 'Connections',  href: '/dashboard/setup',        icon: Plug,      desc: 'Connect your coding agents', keywords: 'setup otel claude code codex gemini' },
      { label: 'Platforms',    href: '/dashboard/mcp',          icon: Puzzle,    desc: 'Connected platforms & MCP',  keywords: 'mcp' },
      { label: 'Integrations', href: '/dashboard/integrations', icon: GitBranch, desc: 'Alert channels & billing',   keywords: 'slack webhook email anthropic openai' },
    ],
  },
  {
    id: 'settings', label: 'Settings',
    items: [
      { label: 'Settings', href: '/dashboard/settings', icon: Settings, desc: 'Workspace configuration', keywords: 'preferences config' },
    ],
  },
]

/** Pages that exist but are not in the sidebar (still searchable + titled). */
export const EXTRA_PAGES: NavLink[] = [
  { label: 'Projects',          href: '/dashboard/projects',               icon: Layers,     desc: 'Manage projects' },
  { label: 'Member',            href: '/dashboard/members',                icon: User,       desc: 'Spend for one member (open from Explore or Teams)', keywords: 'person engineer' },
  { label: 'Quality × cost',    href: '/dashboard/analytics/quality-cost', icon: Scale,      desc: 'Eval quality against cost',       keywords: 'eval quality' },
  { label: 'Profile',           href: '/dashboard/settings/profile',       icon: User,       desc: 'Settings · your account',          keywords: 'settings account name password' },
  { label: 'Notifications',     href: '/dashboard/settings/notifications', icon: BellRing,   desc: 'Settings · notification preferences', keywords: 'settings quiet hours email opt out' },
  { label: 'Data & retention',  href: '/dashboard/settings/data',          icon: Database,   desc: 'Settings · retention & deletion',  keywords: 'settings delete retention' },
  { label: 'Workspace',         href: '/dashboard/settings/workspace',     icon: Building2,  desc: 'Settings · name, time zone, SSO',  keywords: 'settings timezone org organization sso' },
  { label: 'Audit log',         href: '/dashboard/settings/audit',         icon: ScrollText, desc: 'Settings · who changed what',      keywords: 'settings audit history' },
  { label: 'Cost allocation',   href: '/dashboard/settings/allocation',    icon: Split,      desc: 'Settings · allocation rules',      keywords: 'settings chargeback showback allocation' },
]

export interface PaletteAction {
  id:        string
  label:     string
  desc:      string
  icon:      React.ElementType
  keywords?: string
  href?:     string
  run?:      'toggle-theme'
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'new-key',     label: 'Create API key',   desc: 'Ingest or read-only key',            icon: Plus,       href: '/dashboard/keys?new=1',     keywords: 'new key token' },
  { id: 'run-setup',   label: 'Run setup',        desc: 'npx tokenfin setup · connect agents', icon: Rocket,     href: '/dashboard/setup',          keywords: 'connect claude code install onboarding' },
  { id: 'new-alert',   label: 'New alert rule',   desc: 'Spend, anomaly or budget alert',     icon: Bell,       href: '/dashboard/alerts?new=1',   keywords: 'create alert notify' },
  { id: 'new-limit',   label: 'New budget limit', desc: 'Cap spend for org, project or team', icon: Shield,     href: '/dashboard/limits?new=1',   keywords: 'create budget limit' },
  { id: 'new-project', label: 'New project',      desc: 'Create a project',                   icon: FolderPlus, href: '/dashboard/projects',       keywords: 'create project' },
  { id: 'invite',      label: 'Invite members',   desc: 'Add people to your org',             icon: UserPlus,   href: '/dashboard/provision',      keywords: 'invite add member onboard' },
  { id: 'theme',       label: 'Toggle dark mode', desc: 'Switch light / dark theme',          icon: Moon,       run: 'toggle-theme',               keywords: 'theme dark light appearance' },
]

export const ALL_NAV_LINKS: NavLink[] = [...NAV_SECTIONS.flatMap(s => s.items), ...EXTRA_PAGES]
export const ALL_HREFS: string[] = ALL_NAV_LINKS.map(l => l.href)
export const SIDEBAR_HREFS: string[] = NAV_SECTIONS.flatMap(s => s.items.map(i => i.href))

export function sectionOf(href: string): string | undefined {
  return NAV_SECTIONS.find(s => s.items.some(i => i.href === href))?.label
}
