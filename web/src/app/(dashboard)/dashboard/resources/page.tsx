'use client'
import { useState } from 'react'
import {
  BookOpen, Code, Terminal, Globe, Zap, CheckCircle2, ArrowRight,
  ExternalLink, Copy, Check, ChevronDown, ChevronUp,
  MessageCircle, Mail, FileText, PlayCircle, Star,
  AlertCircle, Package, Clock, Rocket, Layers, Key,
  Shield, Bell, GitBranch, BarChart3, RefreshCw,
  Monitor, Code2, Plug, Plug2, SquareTerminal, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ══════════════════════════════════════════════════════════════
   TYPES
══════════════════════════════════════════════════════════════ */
type TabId = 'start' | 'tools' | 'api' | 'changelog' | 'support'

/* ══════════════════════════════════════════════════════════════
   TOOL GUIDES — friendly, non-developer language
══════════════════════════════════════════════════════════════ */
interface ToolStep {
  n:       number
  title:   string
  desc:    string
  code?:   string
  tip?:    string
}

interface ToolGuide {
  id:            string
  name:          string
  tagline:       string
  method:        string
  methodColor:   string
  methodBg:      string
  difficulty:    'Easy' | 'Medium'
  Icon:          React.ElementType
  iconColor:     string
  iconBg:        string
  steps:         ToolStep[]
  tracks:        string[]
  verify:        string
}

const TOOL_GUIDES: ToolGuide[] = [
  {
    id:          'codex',
    name:        'Codex (OpenAI CLI)',
    tagline:     'AI coding assistant you run in your terminal',
    method:      'Auto-tracked via proxy',
    methodColor: 'text-teal',
    methodBg:    'bg-[var(--green-bg)]',
    difficulty:  'Easy',
    Icon:        SquareTerminal,
    iconColor:   'text-teal',
    iconBg:      'bg-[var(--green-bg)]',
    steps: [
      {
        n:    1,
        title: 'Install the TokenFin Tracker (one-time setup)',
        desc:  'Find the file called `install.command` inside your TokenFin folder. Double-click it. A window pops up — click "Install". The tracker is now a tiny background app that starts automatically when you log in.',
        tip:   'You only need to do this once. After that, the tracker runs silently in the background.',
      },
      {
        n:    2,
        title: 'Open your Codex config file',
        desc:  'Open a Terminal window and paste this command, then press Enter:',
        code:  'open ~/.codex/config.toml',
        tip:   'This opens your Codex settings file in TextEdit (or your default text editor).',
      },
      {
        n:    3,
        title: 'Tell Codex to use the TokenFin address',
        desc:  'Look for a section like `[model_providers.something]` — it might say "tokenfin", "openai", or another name. That is just the name of the AI service Codex is talking to. Inside that section, find the line that says `base_url` and change it to the address below, then save the file (Cmd+S):',
        code:  'base_url = "http://127.0.0.1:7070/v1"',
        tip:   'Port 7070 is where the TokenFin tracker runs on your computer. All Codex AI calls will pass through it before reaching the AI provider — that\'s how usage gets captured.',
      },
      {
        n:    4,
        title: 'Restart Codex',
        desc:  'Close your terminal and open a new one. Use Codex exactly as you normally would — everything is tracked automatically from now on!',
      },
    ],
    tracks: [
      'Every Codex session and command',
      'Number of input tokens (your prompts)',
      'Number of output tokens (AI responses)',
      'Cost per session',
      'Which AI model was used',
    ],
    verify: 'Run a Codex command like `codex "explain this code"`, then open the TokenFin Overview page. A new event should appear within 30 seconds.',
  },

  {
    id:          'cursor',
    name:        'Cursor',
    tagline:     'AI-powered code editor — type less, code more',
    method:      'Auto-tracked via proxy',
    methodColor: 'text-teal',
    methodBg:    'bg-[var(--green-bg)]',
    difficulty:  'Easy',
    Icon:        Code2,
    iconColor:   'text-[var(--blue)]',
    iconBg:      'bg-[var(--blue-bg)]',
    steps: [
      {
        n:    1,
        title: 'Install the TokenFin Tracker (one-time)',
        desc:  'If you have not done this yet: find `install.command` in your TokenFin folder and double-click it. Click "Install" in the window that opens.',
        tip:   'Already done this for Codex? The tracker is already running — skip to Step 2.',
      },
      {
        n:    2,
        title: 'Open Cursor Settings',
        desc:  'Inside Cursor, press Cmd+, (Mac) or Ctrl+, (Windows). The Settings panel opens on the right side of the screen.',
      },
      {
        n:    3,
        title: 'Find the OpenAI URL setting',
        desc:  'In the search box at the top of Settings, type "openai base". You will see an option called "Override OpenAI Base URL" or "OpenAI API Base URL".',
      },
      {
        n:    4,
        title: 'Enter the TokenFin tracker address',
        desc:  'Click on that setting and change the value to the address below, then press Enter to save:',
        code:  'http://127.0.0.1:7070/v1',
        tip:   'This tells Cursor to route its AI calls through the TokenFin tracker before they reach OpenAI.',
      },
      {
        n:    5,
        title: 'Use Cursor as usual',
        desc:  'Select some code, press Cmd+K to edit it with AI, or use Cursor Chat — all of these are now tracked automatically!',
      },
    ],
    tracks: [
      'Inline AI edits (Cmd+K)',
      'Cursor Chat conversations',
      'Code generation and autocomplete',
      'Tokens and cost per session',
    ],
    verify: 'Ask Cursor AI to explain or edit a piece of code. Then open TokenFin Overview — the event should show up within 30 seconds.',
  },

  {
    id:          'cowork',
    name:        'Cowork (Claude Desktop)',
    tagline:     'Anthropic\'s desktop AI assistant — the app you\'re using right now',
    method:      'MCP server',
    methodColor: 'text-[#8B5CF6]',
    methodBg:    'bg-[#8B5CF6]/10',
    difficulty:  'Easy',
    Icon:        Monitor,
    iconColor:   'text-[#8B5CF6]',
    iconBg:      'bg-[#8B5CF6]/10',
    steps: [
      {
        n:    1,
        title: 'Get a TokenFin API key',
        desc:  'Go to Connected Platforms (left sidebar) → click "Connect platform" → name it "Cowork" → click "Generate API key" → copy the key. Keep this tab open, you\'ll need the key in step 3.',
      },
      {
        n:    2,
        title: 'Open the Claude Desktop config file',
        desc:  'Open a Terminal window and paste this command, then press Enter:',
        code:  'open "~/Library/Application Support/Claude/"',
        tip:   'This opens the Claude Desktop folder. Look for a file called `claude_desktop_config.json`. If it does not exist, create a new text file with that name.',
      },
      {
        n:    3,
        title: 'Add the TokenFin MCP server',
        desc:  'Open `claude_desktop_config.json` in TextEdit. Add the block below (paste it inside the outer curly braces). Replace YOUR-API-KEY-HERE with the key you copied:',
        code:  `{
  "mcpServers": {
    "tokenfin": {
      "command": "node",
      "args": ["/Users/mac/tokenfin/mcp/dist/index.js"],
      "env": {
        "TOKENFIN_API_KEY": "YOUR-API-KEY-HERE",
        "TOKENFIN_BASE_URL": "https://tokenfin.curiousdevs.com"
      }
    }
  }
}`,
        tip:   'If the file already has other mcpServers entries, just add the "tokenfin" block inside the existing "mcpServers" object — do not replace the whole file.',
      },
      {
        n:    4,
        title: 'Restart Cowork',
        desc:  'Press Cmd+Q to fully quit Cowork, then reopen it. When you\'re back in a chat, ask "What is my LLM spending this month?" — TokenFin will answer directly in the chat!',
      },
    ],
    tracks: [
      'Questions about your spending and usage',
      'All queries you make through Cowork\'s AI',
      'Token counts and costs per conversation',
    ],
    verify: 'In a Cowork chat, type "What is my token usage today?" — you should get a real answer from TokenFin. Then check the Overview dashboard to see the event.',
  },

  {
    id:          'claude-cli',
    name:        'Claude CLI (Claude Code)',
    tagline:     'Anthropic\'s AI coding tool you run in your terminal',
    method:      'Proxy (env variable)',
    methodColor: 'text-coral',
    methodBg:    'bg-coral/10',
    difficulty:  'Easy',
    Icon:        SquareTerminal,
    iconColor:   'text-coral',
    iconBg:      'bg-coral/10',
    steps: [
      {
        n:    1,
        title: 'Install the TokenFin Tracker (one-time)',
        desc:  'Find `install.command` in your TokenFin folder and double-click it, then click "Install".',
        tip:   'Already done for Codex or Cursor? Skip this step.',
      },
      {
        n:    2,
        title: 'Run Claude with tracking (quick way)',
        desc:  'Instead of just typing `claude`, type the following in your terminal and press Enter:',
        code:  'ANTHROPIC_BASE_URL=http://127.0.0.1:7070 claude',
        tip:   'This tells Claude CLI to route through the TokenFin tracker. You\'ll need to add this prefix each time unless you do Step 3.',
      },
      {
        n:    3,
        title: 'Make it permanent (recommended)',
        desc:  'So you never have to remember the prefix, paste this into your Terminal and press Enter:',
        code:  "echo 'export ANTHROPIC_BASE_URL=http://127.0.0.1:7070' >> ~/.zshrc && source ~/.zshrc",
        tip:   'After this, just typing `claude` automatically routes through TokenFin. Works for the current session and all future ones.',
      },
    ],
    tracks: [
      'All Claude CLI / Claude Code sessions',
      'Input and output tokens',
      'Cost per conversation',
      'Which model version was used',
    ],
    verify: 'Run `claude "write hello world in Python"`, then check TokenFin Overview for a new event.',
  },

  {
    id:          'opencode',
    name:        'OpenCode',
    tagline:     'Open-source AI coding assistant for your terminal',
    method:      'Auto-tracked via proxy',
    methodColor: 'text-teal',
    methodBg:    'bg-[var(--green-bg)]',
    difficulty:  'Medium',
    Icon:        Code,
    iconColor:   'text-[var(--amber)]',
    iconBg:      'bg-[var(--amber-bg)]',
    steps: [
      {
        n:    1,
        title: 'Install the TokenFin Tracker (one-time)',
        desc:  'Find `install.command` in your TokenFin folder and double-click it, then click "Install".',
      },
      {
        n:    2,
        title: 'Find your OpenCode config file',
        desc:  'Open a Terminal window and paste this command to look for the config folder:',
        code:  'ls ~/.config/opencode/ 2>/dev/null || ls ~/.opencode/ 2>/dev/null',
        tip:   'The config file is usually called `config.json` or `config.toml`. If nothing shows up, OpenCode may not be installed or the config may be elsewhere.',
      },
      {
        n:    3,
        title: 'Add the proxy URL to the config',
        desc:  'Open the config file in a text editor. Add or change the OpenAI base URL setting to:',
        code:  `# If config.toml:
openai_base_url = "http://127.0.0.1:7070/v1"

# If config.json:
{
  "openai_base_url": "http://127.0.0.1:7070/v1"
}`,
        tip:   'OpenCode uses OpenAI-compatible APIs, so pointing it at the TokenFin proxy (port 7070) works the same way as Codex or Cursor.',
      },
      {
        n:    4,
        title: 'Restart OpenCode',
        desc:  'Close and reopen OpenCode. All your AI coding sessions will now be tracked!',
      },
    ],
    tracks: [
      'All OpenCode sessions',
      'Tokens and cost per session',
      'Which AI model was used',
    ],
    verify: 'Use OpenCode to do something with AI, then check TokenFin Overview for the event within 30 seconds.',
  },
]

/* ══════════════════════════════════════════════════════════════
   CHANGELOG DATA
══════════════════════════════════════════════════════════════ */
interface ChangelogEntry {
  version:  string
  date:     string
  tag:      'new' | 'improved' | 'fix' | 'breaking'
  title:    string
  items:    string[]
}

/* No public releases yet — product is in early access */
const CHANGELOG: ChangelogEntry[] = []

/* ══════════════════════════════════════════════════════════════
   GUIDES
══════════════════════════════════════════════════════════════ */
/* Real in-app quick links — no dead href="#" */
const QUICK_LINKS = [
  { icon: Rocket,    title: 'Connect your AI tools',   desc: 'Step-by-step guides for Codex, Cursor, Claude CLI, Cowork, OpenCode',  href: null, tab: 'tools' as TabId, color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
  { icon: Shield,    title: 'Set a budget limit',       desc: 'Create Warn / Throttle / Block thresholds at project or team level',    href: '/dashboard/limits',        tab: null, color: 'text-coral',           bg: 'bg-coral/10'          },
  { icon: Bell,      title: 'Configure alert rules',    desc: 'Route email + Slack alerts for spend spikes and limit breaches',        href: '/dashboard/alerts',        tab: null, color: 'text-[var(--amber)]',  bg: 'bg-[var(--amber-bg)]'  },
  { icon: GitBranch, title: 'Connect Datadog / Grafana',desc: 'Push TokenFin metrics to your observability stack',                    href: '/dashboard/integrations',  tab: null, color: 'text-[var(--blue)]',   bg: 'bg-[var(--blue-bg)]'   },
  { icon: Key,       title: 'Manage API keys',          desc: 'Rotate, revoke, and scope your ingest keys by environment',             href: '/dashboard/keys',          tab: null, color: 'text-teal',            bg: 'bg-[var(--green-bg)]'  },
  { icon: BarChart3, title: 'View cost analytics',      desc: 'Drill into per-model and per-project spend for the last 30 days',       href: '/dashboard/analytics',     tab: null, color: 'text-coral',           bg: 'bg-coral/10'           },
]

/* ══════════════════════════════════════════════════════════════
   API REFERENCE — public ingest endpoint only
   Other /api/v1/* routes are internal (admin-auth, not public)
══════════════════════════════════════════════════════════════ */

/* ── Ingest payload fields ── */
const INGEST_FIELDS = [
  { field: 'model',         type: 'string',  req: true,  desc: 'Model name, e.g. "claude-sonnet-4-6" or "gpt-4o". Used to auto-compute cost if cost_usd is omitted.' },
  { field: 'input_tokens',  type: 'number',  req: false, desc: 'Number of prompt / input tokens for this call.' },
  { field: 'output_tokens', type: 'number',  req: false, desc: 'Number of completion / output tokens for this call.' },
  { field: 'total_tokens',  type: 'number',  req: false, desc: 'Total tokens (fallback when input/output split is unavailable). At least one token field must be > 0.' },
  { field: 'cost_usd',      type: 'number',  req: false, desc: 'Actual cost in USD. If omitted, auto-computed from model pricing table.' },
  { field: 'project_id',    type: 'string',  req: false, desc: 'Project UUID to attribute this event to. Falls back to the API key\'s project, then the org\'s first project.' },
  { field: 'tags',          type: 'object',  req: false, desc: 'Flat string→string map for filtering, e.g. { "env": "prod", "team": "backend" }.' },
  { field: 'metadata',      type: 'object',  req: false, desc: 'Any extra data you want to attach — session IDs, user IDs, feature flags, etc.' },
]

/* ── Code examples (verified against route.ts) ── */
const INGEST_CURL = `curl -X POST https://tokenfin.curiousdevs.com/api/v1/ingest \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model":         "claude-sonnet-4-6",
    "input_tokens":  1240,
    "output_tokens":  380,
    "project_id":    "YOUR_PROJECT_ID",
    "tags":          { "env": "prod" },
    "metadata":      { "session_id": "abc123" }
  }'

# Response
# {
#   "ok": true,
#   "model": "claude-sonnet-4-6",
#   "total_tokens": 1620,
#   "cost_usd": 0.009420,
#   "bucket": "2026-06-24",
#   "source": "direct"
# }`

const INGEST_PYTHON = `import requests

response = requests.post(
    "https://tokenfin.curiousdevs.com/api/v1/ingest",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type":  "application/json",
    },
    json={
        "model":         "claude-sonnet-4-6",
        "input_tokens":  1240,
        "output_tokens":  380,
        "project_id":    "YOUR_PROJECT_ID",
        "tags":          { "env": "prod" },
        "metadata":      { "session_id": "abc123" },
    },
)

data = response.json()
print(data)
# {'ok': True, 'model': 'claude-sonnet-4-6',
#  'total_tokens': 1620, 'cost_usd': 0.00942,
#  'bucket': '2026-06-24', 'source': 'direct'}`

const INGEST_NODE = `// Works with Node.js 18+ (native fetch) and any browser environment
const response = await fetch("https://tokenfin.curiousdevs.com/api/v1/ingest", {
  method:  "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type":  "application/json",
  },
  body: JSON.stringify({
    model:         "claude-sonnet-4-6",
    input_tokens:  1240,
    output_tokens:  380,
    project_id:    "YOUR_PROJECT_ID",
    tags:          { env: "prod" },
    metadata:      { session_id: "abc123" },
  }),
})

const data = await response.json()
console.log(data)
// { ok: true, model: 'claude-sonnet-4-6',
//   total_tokens: 1620, cost_usd: 0.00942,
//   bucket: '2026-06-24', source: 'direct' }`


/* ══════════════════════════════════════════════════════════════
   SETUP STEPS
══════════════════════════════════════════════════════════════ */
// Dead-simple, copy-paste setup. No keys to copy, no config files, no base URLs.
// Works on Mac, Windows, and Linux (Node ships with most AI dev tools).
const SETUP_STEPS: { n: number; title: string; desc: string; code?: string; href?: string; cta?: string }[] = [
  {
    n: 1,
    title: 'Sign in from your terminal',
    desc:  'Open your Terminal, paste this line, and press Enter. Your browser opens — click “Authorize”. That creates your key automatically, so there is nothing to copy.',
    code:  'npx tokenfin@latest login',
  },
  {
    n: 2,
    title: 'Connect your AI tool',
    desc:  'Paste this and pick your tool from the list (Claude Code, Cursor, Windsurf, VS Code, Codex, Claude Desktop…). It sets everything up for you.',
    code:  'npx tokenfin@latest setup',
  },
  {
    n: 3,
    title: 'Use your AI as usual',
    desc:  'That’s it. Your usage and cost show up here automatically — no config files to edit, no URLs to change.',
    href:  '/dashboard',
    cta:   'Open dashboard',
  },
]

/* ══════════════════════════════════════════════════════════════
   COMPONENTS
══════════════════════════════════════════════════════════════ */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group">
      <pre className="text-[11.5px] font-mono text-[#C9D1D9] bg-[#0D1117] rounded-xl p-4 overflow-x-auto leading-relaxed border border-[#30363D]">
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 text-[11px] font-semibold text-white hover:bg-white/20"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function TagPill({ tag }: { tag: ChangelogEntry['tag'] }) {
  const map = {
    new:      { label: 'New',      class: 'bg-[var(--green-bg)] text-teal'            },
    improved: { label: 'Improved', class: 'bg-[var(--blue-bg)] text-[var(--blue)]'   },
    fix:      { label: 'Fix',      class: 'bg-[var(--amber-bg)] text-[var(--amber)]' },
    breaking: { label: 'Breaking', class: 'bg-[var(--red-bg)] text-[var(--red)]'     },
  }
  const m = map[tag]
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide', m.class)}>
      {m.label}
    </span>
  )
}

function ChangelogCard({ entry }: { entry: ChangelogEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--border)] rounded-2xl bg-white dark:bg-[#141428] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <div className="flex-1 flex items-center gap-3 flex-wrap min-w-0">
          <span className="text-[11px] font-mono font-bold text-[var(--fg-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--border)]">
            v{entry.version}
          </span>
          <TagPill tag={entry.tag} />
          <span className="text-[13px] font-semibold text-[var(--fg)]">{entry.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-[11px] text-[var(--fg-tertiary)] hidden sm:block">{entry.date}</span>
          {open ? <ChevronUp size={14} className="text-[var(--fg-tertiary)]" /> : <ChevronDown size={14} className="text-[var(--fg-tertiary)]" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-5 py-4 bg-[var(--bg-secondary)]/40 space-y-2">
          {entry.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <CheckCircle2 size={13} className="text-teal mt-0.5 flex-shrink-0" />
              <p className="text-[12.5px] text-[var(--fg-secondary)] leading-relaxed">{item}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Tool Guide Card ── */
function ToolCard({ tool }: { tool: ToolGuide }) {
  const [open, setOpen] = useState(false)
  const Icon = tool.Icon
  const diffColor = tool.difficulty === 'Easy'
    ? 'bg-[var(--green-bg)] text-teal'
    : 'bg-[var(--amber-bg)] text-[var(--amber)]'

  return (
    <div className="border border-[var(--border)] rounded-2xl bg-white dark:bg-[#141428] overflow-hidden transition-all">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0', tool.iconBg)}>
          <Icon size={20} className={tool.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold text-[var(--fg)] leading-snug">{tool.name}</p>
          <p className="text-[11.5px] text-[var(--fg-tertiary)] mt-0.5">{tool.tagline}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-full', tool.methodBg, tool.methodColor)}>
            {tool.method}
          </span>
          <span className={cn('text-[10.5px] font-semibold px-2 py-0.5 rounded-full', diffColor)}>
            {tool.difficulty}
          </span>
          {open
            ? <ChevronUp size={14} className="text-[var(--fg-tertiary)]" />
            : <ChevronDown size={14} className="text-[var(--fg-tertiary)]" />
          }
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)]/30">

          {/* Steps */}
          <div className="p-5 space-y-5">
            <p className="text-[12px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">Step-by-step setup</p>

            {tool.steps.map(step => (
              <div key={step.n} className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-7 h-7 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center">
                    <span className="text-[12px] font-bold text-coral">{step.n}</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-2.5 pb-1">
                  <p className="text-[13px] font-semibold text-[var(--fg)] leading-snug">{step.title}</p>
                  <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">{step.desc}</p>
                  {step.code && <CodeBlock code={step.code} />}
                  {step.tip && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--blue-bg)] border border-[var(--blue)]/20">
                      <Info size={12} className="text-[var(--blue)] flex-shrink-0 mt-0.5" />
                      <p className="text-[11.5px] text-[var(--blue)] leading-relaxed">{step.tip}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* What gets tracked */}
          <div className="px-5 pb-4 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--fg-secondary)] uppercase tracking-wider">What gets tracked automatically</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {tool.tracks.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-teal flex-shrink-0" />
                  <span className="text-[12px] text-[var(--fg-secondary)]">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Verification */}
          <div className="mx-5 mb-5 flex items-start gap-3 px-4 py-3 bg-[var(--green-bg)] border border-teal/20 rounded-xl">
            <CheckCircle2 size={14} className="text-teal flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] font-semibold text-teal">How to confirm it&apos;s working</p>
              <p className="text-[11.5px] text-teal/80 mt-0.5 leading-relaxed">{tool.verify}</p>
            </div>
          </div>

          {/* Connect button */}
          <div className="px-5 pb-5">
            <a
              href="/dashboard/mcp"
              className="btn-primary w-full justify-center"
            >
              <Plug2 size={13} /> Connect {tool.name} — get your API key
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════ */
export default function ResourcesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('start')
  const [copiedCmd, setCopiedCmd] = useState<number | null>(null)

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'start',     label: 'Get started',   icon: Rocket        },
    { id: 'tools',     label: 'Connect tools',  icon: Plug         },
    { id: 'api',       label: 'API reference',  icon: Code         },
    { id: 'changelog', label: 'Changelog',      icon: Clock        },
    { id: 'support',   label: 'Support',        icon: MessageCircle},
  ]

  return (
    <div className="space-y-6 max-w-[900px]">

      {/* ── Header ── */}
      <div>
        <h1 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Resources</h1>
        <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">
          Guides, SDK docs, API reference, and changelog — everything to get the most out of TokenFin
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl w-fit flex-wrap">
        {tabs.map(t => {
          const Icon = t.icon
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-semibold transition-all',
                active
                  ? 'bg-[var(--fg)] text-[var(--bg)] shadow-sm'
                  : 'text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════ GET STARTED */}
      {activeTab === 'start' && (
        <div className="space-y-6">

          {/* Steps */}
          <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <p className="text-[13.5px] font-bold text-[var(--fg)]">Set up in under a minute</p>
              <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5">Copy-paste two commands. No keys to copy, no config files, no code.</p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {SETUP_STEPS.map(s => (
                <div key={s.n} className="flex items-start gap-4 px-5 py-4">
                  <div className="w-7 h-7 rounded-full bg-coral/15 border border-coral/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-[12px] font-bold text-coral">{s.n}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--fg)]">{s.title}</p>
                    <p className="text-[12px] text-[var(--fg-secondary)] mt-0.5 leading-relaxed">{s.desc}</p>
                    {s.code && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(s.code!); setCopiedCmd(s.n); setTimeout(() => setCopiedCmd(null), 1500) }}
                        className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12.5px] text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <span className="truncate">{s.code}</span>
                        {copiedCmd === s.n
                          ? <span className="flex items-center gap-1 text-[11px] font-sans font-semibold text-teal flex-shrink-0"><Check size={12} /> Copied</span>
                          : <span className="flex items-center gap-1 text-[11px] font-sans font-medium text-[var(--fg-tertiary)] flex-shrink-0"><Copy size={12} /> Copy</span>}
                      </button>
                    )}
                    {s.href && (
                      <a href={s.href} className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-coral hover:opacity-80">
                        {s.cta} <ArrowRight size={12} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fallback for tools that need manual config */}
          <div className="flex items-center gap-4 px-5 py-4 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-2xl">
            <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0">
              <Plug size={16} className="text-[#8B5CF6]" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-[#8B5CF6]">Tool not in the list, or prefer manual setup?</p>
              <p className="text-[12px] text-[#8B5CF6]/80 mt-0.5">Paste-ready config for every client on the MCP Setup page.</p>
            </div>
            <a href="/dashboard/mcp/connect" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8B5CF6] hover:opacity-80 flex-shrink-0">
              MCP Setup <ArrowRight size={12} />
            </a>
          </div>

          {/* Quick links — all real, in-app navigation */}
          <div>
            <p className="text-[13px] font-bold text-[var(--fg)] mb-3">Quick links</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {QUICK_LINKS.map(g => {
                const Icon = g.icon
                const inner = (
                  <>
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors', g.bg)}>
                      <Icon size={16} className={g.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[12.5px] font-semibold leading-snug', g.color)}>{g.title}</p>
                      <p className="text-[11px] text-[var(--fg-tertiary)] mt-1 leading-relaxed">{g.desc}</p>
                    </div>
                    <ArrowRight size={13} className={cn(g.color, 'flex-shrink-0 opacity-60')} />
                  </>
                )
                return g.href ? (
                  <a key={g.title} href={g.href}
                    className="flex items-start gap-3 p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl hover:border-coral/40 hover:bg-coral/5 transition-all">
                    {inner}
                  </a>
                ) : (
                  <button key={g.title} onClick={() => setActiveTab(g.tab!)}
                    className="flex items-start gap-3 p-4 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl hover:border-[#8B5CF6]/40 hover:bg-[#8B5CF6]/5 transition-all text-left">
                    {inner}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ CONNECT TOOLS */}
      {activeTab === 'tools' && (
        <div className="space-y-4">

          {/* Intro */}
          <div className="px-5 py-4 bg-[var(--blue-bg)] border border-[var(--blue)]/20 rounded-2xl">
            <p className="text-[13px] font-semibold text-[var(--blue)] mb-1">How to use these guides</p>
            <p className="text-[12px] text-[var(--blue)]/80 leading-relaxed">
              Click on any tool below to see the exact steps to connect it to TokenFin. No coding required — just copy-paste commands.
              Most tools connect in under 5 minutes.
            </p>
          </div>

          {/* How tracking works — simple explanation */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Zap,    title: 'Proxy (auto)',  desc: 'TokenFin intercepts calls silently in the background. Zero changes to your workflow.', color: 'text-teal', bg: 'bg-[var(--green-bg)]' },
              { icon: Plug,   title: 'MCP server',    desc: 'Adds TokenFin as a tool inside Claude-based apps so you can query your spending in chat.', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/10' },
              { icon: Shield, title: 'Env variable',  desc: 'Set one environment variable and every terminal session is tracked automatically.', color: 'text-coral', bg: 'bg-coral/10' },
            ].map(m => {
              const Icon = m.icon
              return (
                <div key={m.title} className="p-3.5 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl space-y-2">
                  <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center', m.bg)}>
                    <Icon size={15} className={m.color} />
                  </div>
                  <p className="text-[12px] font-bold text-[var(--fg)]">{m.title}</p>
                  <p className="text-[11px] text-[var(--fg-tertiary)] leading-relaxed">{m.desc}</p>
                </div>
              )
            })}
          </div>

          {/* Tool cards */}
          <div className="space-y-3">
            {TOOL_GUIDES.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>

          {/* Footer note */}
          <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl">
            <Info size={13} className="text-[var(--fg-tertiary)] flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">
              Don&apos;t see your tool here? Any app that calls OpenAI or Anthropic APIs can be connected by pointing its base URL to{' '}
              <code className="font-mono font-semibold text-[var(--fg)]">http://127.0.0.1:7070/v1</code>.
              Contact us at <span className="text-coral">hello@curiousdevs.com</span> for help.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ API REFERENCE */}
      {activeTab === 'api' && (
        <ApiTab />
      )}

      {/* ═══════════════════════════════════════════════════ CHANGELOG */}
      {activeTab === 'changelog' && (
        <div className="space-y-4">
          {CHANGELOG.length === 0 ? (
            <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl py-16 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-secondary)] flex items-center justify-center mx-auto">
                <Clock size={22} className="text-[var(--fg-tertiary)]" />
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--fg)]">No public releases yet</p>
                <p className="text-[12.5px] text-[var(--fg-secondary)] mt-1.5 max-w-[360px] mx-auto leading-relaxed">
                  TokenFin is currently in early access. Release notes will appear here once we launch publicly.
                </p>
              </div>
              <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--fg-tertiary)]">
                <Mail size={11} />
                Questions? Email us at{' '}
                <a href="mailto:hello@curiousdevs.com" className="text-coral underline underline-offset-2">hello@curiousdevs.com</a>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-[var(--fg-secondary)]">{CHANGELOG.length} releases — click any entry to expand</p>
              {CHANGELOG.map(e => <ChangelogCard key={e.version} entry={e} />)}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ SUPPORT */}
      {activeTab === 'support' && (
        <div className="space-y-5">


          {/* Email contact */}
          <div className="flex items-start gap-4 p-5 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-coral/10 flex-shrink-0">
              <Mail size={18} className="text-coral" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-bold text-[var(--fg)]">Email support</p>
              <p className="text-[11.5px] text-[var(--fg-secondary)] mt-1 leading-relaxed">
                Questions, bugs, or feature requests? Email us at{' '}
                <a href="mailto:hello@curiousdevs.com" className="text-coral underline underline-offset-2">hello@curiousdevs.com</a>
                {' '}— we reply within 24 hours on business days.
              </p>
            </div>
            <a href="mailto:hello@curiousdevs.com" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-coral hover:opacity-80 flex-shrink-0">
              Send email <ArrowRight size={12} />
            </a>
          </div>

          {/* FAQ — sectioned */}
          <div className="space-y-6">
            <p className="text-[13px] font-bold text-[var(--fg)]">Frequently asked questions</p>

            {[
              {
                section: 'Getting started',
                Icon: Rocket,
                color: 'text-coral',
                bg: 'bg-coral/10',
                items: [
                  {
                    q: 'Do I need to be a developer to use TokenFin?',
                    a: 'Not at all. Most setup involves changing a single URL in your AI tool\'s settings — no code required. The "Connect tools" tab has step-by-step instructions written in plain language for Codex, Cursor, Claude CLI, Cowork, and OpenCode. The longest part (installing the tracker) takes about 2 minutes.',
                  },
                  {
                    q: 'What AI tools can I track?',
                    a: 'Any tool that calls OpenAI or Anthropic APIs. We have built-in guides for Codex, Cursor, Claude CLI, Cowork (Claude Desktop), and OpenCode. You can also connect any custom application by pointing it to the TokenFin proxy at http://127.0.0.1:7070/v1 — if it uses OpenAI-compatible APIs, it works.',
                  },
                  {
                    q: 'How long does initial setup take?',
                    a: '5–10 minutes total. Step 1 is running install.command once (about 2 minutes). After that, connecting each tool takes around 1 minute — just change one URL in that tool\'s settings. The dashboard shows data as soon as the first tracked AI call goes through.',
                  },
                  {
                    q: 'Can multiple people share one TokenFin workspace?',
                    a: 'Yes. Invite teammates from the Teams page. Each person connects their own AI tools, and all usage flows into the shared dashboard. You can see spending broken down by project, team, or individual member — useful for understanding who is using what.',
                  },
                ],
              },
              {
                section: 'How tracking works',
                Icon: Zap,
                color: 'text-teal',
                bg: 'bg-[var(--green-bg)]',
                items: [
                  {
                    q: 'How does TokenFin capture my AI usage without me changing my code?',
                    a: 'TokenFin installs a lightweight local proxy — a tiny background app running on port 7070 on your computer. When you point your AI tool to this address instead of the provider\'s server directly, every API call passes through the proxy. It reads the model, token counts, and cost from the response, logs it to your dashboard, then forwards the call to the provider normally. Your AI tool works exactly as before — tracking adds less than 1ms of overhead.',
                  },
                  {
                    q: 'What is the "proxy" and is it safe?',
                    a: 'The proxy is a small local server that runs only on your computer. It does not share data with any third party — it only forwards calls to your AI provider and sends metadata (model, tokens, cost) to your local TokenFin dashboard. Your AI provider API keys are never stored by the proxy; they pass through to the provider unchanged. It is installed as a macOS LaunchAgent so it starts automatically when you log in.',
                  },
                  {
                    q: 'What\'s the difference between the "proxy" approach and the "MCP server" approach?',
                    a: 'The proxy captures every AI call automatically with no ongoing effort — set it once and forget it. The MCP server adds TokenFin as a tool your AI assistant can actively use, so you can ask questions like "What\'s my spending this month?" and get a real answer directly in the chat. For most users, the proxy handles tracking and the MCP server handles querying — they complement each other perfectly.',
                  },
                  {
                    q: 'Why is my usage not appearing in the dashboard after setup?',
                    a: 'Work through this checklist: (1) Confirm the TokenFin tracker is running — try running install.command again to check its status. (2) Open your AI tool\'s settings and verify the base URL is exactly http://127.0.0.1:7070/v1 — no trailing slash, no typo. (3) Make sure the TokenFin dashboard (localhost:3001) is running. (4) Restart your AI tool after changing its URL. After fixing these, make one AI call and wait 30 seconds — events usually appear immediately.',
                  },
                ],
              },
              {
                section: 'Your data & privacy',
                Icon: Shield,
                color: 'text-[#8B5CF6]',
                bg: 'bg-[#8B5CF6]/10',
                items: [
                  {
                    q: 'Does TokenFin store my prompts or AI responses?',
                    a: 'No. TokenFin never sees or stores the content of your conversations. The proxy only captures metadata: which model was used, how many tokens were consumed (input and output separately), the calculated cost, the timestamp, and which project it belongs to. Your actual questions and AI responses go directly to your provider — TokenFin never touches them.',
                  },
                  {
                    q: 'Are my AI provider API keys stored anywhere by TokenFin?',
                    a: 'No. Your API keys (Anthropic key, OpenAI key, etc.) live in your AI tool\'s own config files — exactly where they always were. The proxy reads your provider\'s response to extract token counts and cost. It never logs, stores, or transmits your provider keys anywhere.',
                  },
                  {
                    q: 'Where is my usage data stored? Can I delete it?',
                    a: 'All your usage data is stored in your own Supabase database — either running locally on your machine or in your own Supabase project. TokenFin does not store any of your data on external servers we control. You can delete any data directly from your Supabase dashboard, or by clearing the relevant tables (usage_events, usage_agg).',
                  },
                ],
              },
              {
                section: 'Cost calculation',
                Icon: BarChart3,
                color: 'text-[var(--blue)]',
                bg: 'bg-[var(--blue-bg)]',
                items: [
                  {
                    q: 'How does TokenFin calculate the cost of each AI call?',
                    a: 'When your AI provider responds to a call, it includes the exact number of input and output tokens used. TokenFin multiplies these by the per-token price for that model (maintained in the Models page) to calculate cost. This is the same formula your provider uses on their invoice — we just surface it per-call instead of per-month.',
                  },
                  {
                    q: 'What if a model\'s pricing changes?',
                    a: 'Pricing is managed in the Models section. If Anthropic or OpenAI changes their pricing, future events will use the old price until you update the Models page. Historical events keep their originally calculated cost (which is correct for when they occurred). We recommend checking Models whenever a provider announces a pricing change.',
                  },
                  {
                    q: 'Why might my TokenFin total differ slightly from my actual provider invoice?',
                    a: 'Provider invoices often include taxes, minimum monthly charges, rounding at the billing level, and sometimes different rates for committed-use tiers. TokenFin shows the raw per-call cost based on token counts and per-token pricing — it\'s very accurate for per-call attribution but does not replicate invoice-level adjustments. Treat it as a precise breakdown, not an exact invoice replica.',
                  },
                ],
              },
              {
                section: 'Limits & alerts',
                Icon: Bell,
                color: 'text-[var(--amber)]',
                bg: 'bg-[var(--amber-bg)]',
                items: [
                  {
                    q: 'What\'s the difference between Warn, Throttle, and Block?',
                    a: 'Warn: sends you an alert (email, Slack) when spending reaches the threshold — AI calls continue normally. Good for awareness. Throttle: sends an alert and deliberately slows down new requests — useful for rate-limiting heavy usage without fully stopping it. Block: sends an alert and starts rejecting new AI requests — use this as a hard spending cap. You can set all three at different percentages, for example Warn at 70%, Throttle at 90%, Block at 100%.',
                  },
                  {
                    q: 'What happens to AI calls when a Block limit is hit?',
                    a: 'New calls from that project receive an error response instead of completing. Calls already in-flight finish normally. The block lifts automatically at the start of the next billing period, or you can raise the limit manually from the Limits page at any time. We recommend setting a Warn alert well below the Block threshold so you get advance notice before anything gets cut off.',
                  },
                  {
                    q: 'Can I set limits per person, per project, or per team?',
                    a: 'Yes — all three scopes are supported. Go to Limits → New limit and choose whether it applies to a specific project, a team, or the whole org. You can layer multiple limits too — for example, a per-team limit and an org-wide backstop that catches everything else.',
                  },
                ],
              },
              {
                section: 'Troubleshooting',
                Icon: AlertCircle,
                color: 'text-[var(--red)]',
                bg: 'bg-[var(--red-bg)]',
                items: [
                  {
                    q: 'I installed the tracker and changed the URL but still see no data. What should I do?',
                    a: 'Try these steps in order: (1) Check the tracker is actually running — open Activity Monitor on Mac and search for "tokenfin", or run ps aux | grep 7070 in Terminal. (2) Verify your AI tool\'s base URL is exactly http://127.0.0.1:7070/v1 — no trailing slash. (3) Confirm the TokenFin dashboard is running at http://localhost:3001. (4) Restart your AI tool after changing its URL setting. (5) Make one test AI call and check the Overview page after 30 seconds. If still nothing, email us at hello@curiousdevs.com with your setup details.',
                  },
                  {
                    q: 'I see "Never used" on a Connected Platform card. Why?',
                    a: 'This just means the API key was generated but has not received any tracked calls yet — it is not an error. It usually means either the proxy is not running, the base URL in your tool points somewhere else, or you have not made an AI call since connecting. Follow the troubleshooting steps in the previous question, then try using your AI tool and refreshing the dashboard.',
                  },
                  {
                    q: 'My Codex works fine but usage is not being tracked.',
                    a: 'The most common cause is the base_url in ~/.codex/config.toml still pointing to the old provider address. Open that file in a text editor and confirm the relevant line reads: base_url = "http://127.0.0.1:7070/v1". The section name above it (like [model_providers.tokenfin]) does not matter — just the URL value inside it. If the URL looks correct, try running install.command again to verify the tracker is running, then restart your terminal.',
                  },
                  {
                    q: 'Can I track API calls from a custom application I am building?',
                    a: 'Yes — send a POST to http://localhost:3001/api/v1/ingest with your API key and the event fields (model, input_tokens, output_tokens, cost_usd, project). See the "API reference" tab for the exact payload. This works for any custom code in any language, no proxy needed — just a plain HTTP request after each LLM call.',
                  },
                ],
              },
            ].map(section => {
              const Icon = section.Icon
              return (
                <div key={section.section} className="space-y-2">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', section.bg)}>
                      <Icon size={13} className={section.color} />
                    </div>
                    <p className="text-[12.5px] font-bold text-[var(--fg-secondary)] uppercase tracking-wider">{section.section}</p>
                  </div>
                  <div className="space-y-2">
                    {section.items.map((f, i) => (
                      <FaqItem key={i} q={f.q} a={f.a} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}

/* ── API Tab ── */
type LangTab = 'curl' | 'python' | 'node'
function ApiTab() {
  const [lang, setLang] = useState<LangTab>('curl')
  const EXAMPLES: Record<LangTab, string> = { curl: INGEST_CURL, python: INGEST_PYTHON, node: INGEST_NODE }
  const LANG_LABELS: { id: LangTab; label: string }[] = [
    { id: 'curl',   label: 'cURL'      },
    { id: 'python', label: 'Python'    },
    { id: 'node',   label: 'Node / JS' },
  ]
  return (
    <div className="space-y-4">

      {/* Endpoint header */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-bold px-2 py-1 rounded-md font-mono bg-[var(--blue-bg)] text-[var(--blue)]">POST</span>
            <code className="text-[13px] font-mono font-semibold text-[var(--fg)]">/api/v1/ingest</code>
            <span className="text-[11.5px] text-[var(--fg-secondary)]">— Track an LLM call (tokens, cost, model, project)</span>
          </div>
          <p className="text-[12px] text-[var(--fg-tertiary)] mt-2">
            Auth: <code className="font-mono text-[var(--fg)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">Authorization: Bearer YOUR_API_KEY</code>
            {' '}— get your key from <a href="/dashboard/mcp" className="text-coral underline underline-offset-2">Connected Platforms</a>
          </p>
        </div>

        {/* Request fields */}
        <div className="divide-y divide-[var(--border)]">
          {INGEST_FIELDS.map(f => (
            <div key={f.field} className="flex items-start gap-3 px-5 py-3 hover:bg-[var(--bg-hover)] transition-colors">
              <div className="flex items-center gap-2 flex-shrink-0 w-44">
                <code className="text-[12px] font-mono font-semibold text-[var(--fg)]">{f.field}</code>
                {f.req && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-coral/10 text-coral">required</span>
                )}
              </div>
              <span className="text-[10.5px] font-mono text-[var(--fg-tertiary)] flex-shrink-0 w-14">{f.type}</span>
              <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed flex-1">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Code examples with language tabs */}
      <div className="bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center gap-1 px-5 py-3.5 border-b border-[var(--border)]">
          <p className="text-[13px] font-semibold text-[var(--fg)] flex-1">Try it</p>
          <div className="flex items-center gap-1 bg-[var(--bg-secondary)] rounded-lg p-1">
            {LANG_LABELS.map(l => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={cn(
                  'text-[11.5px] font-semibold px-3 py-1 rounded-md transition-all',
                  lang === l.id
                    ? 'bg-white dark:bg-[#141428] text-[var(--fg)] shadow-sm'
                    : 'text-[var(--fg-tertiary)] hover:text-[var(--fg)]',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          <CodeBlock code={EXAMPLES[lang]} />
        </div>
      </div>

      {/* Quick tip */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-[var(--green-bg)] border border-teal/20 rounded-xl">
        <CheckCircle2 size={13} className="text-teal flex-shrink-0 mt-0.5" />
        <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">
          <span className="font-semibold text-[var(--fg)]">cost_usd is optional.</span>{' '}
          If you leave it out, TokenFin auto-computes it from the model pricing table.
          Pass it only if your provider charges a different rate or you have exact pricing.
        </p>
      </div>
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--border)] rounded-xl bg-white dark:bg-[#141428] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <p className="text-[12.5px] font-semibold text-[var(--fg)]">{q}</p>
        {open ? <ChevronUp size={13} className="text-[var(--fg-tertiary)] flex-shrink-0" /> : <ChevronDown size={13} className="text-[var(--fg-tertiary)] flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3.5 bg-[var(--bg-secondary)]/40">
          <p className="text-[12px] text-[var(--fg-secondary)] leading-relaxed">{a}</p>
        </div>
      )}
    </div>
  )
}
