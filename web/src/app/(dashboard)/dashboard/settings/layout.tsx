'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Database, Bell, Building2, ScrollText, Split } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/dashboard/settings/profile',        icon: User,       label: 'Profile',       desc: 'Account & personal info'     },
  { href: '/dashboard/settings/workspace',      icon: Building2,  label: 'Workspace',     desc: 'Name, time zone & sign-in'   },
  { href: '/dashboard/settings/notifications',  icon: Bell,       label: 'Notifications', desc: 'Alerts & communication prefs'},
  { href: '/dashboard/settings/allocation',     icon: Split,      label: 'Allocation',    desc: 'Team & cost-center rules'    },
  { href: '/dashboard/settings/data',           icon: Database,   label: 'Data',          desc: 'Retention & data deletion'   },
  { href: '/dashboard/settings/audit',          icon: ScrollText, label: 'Audit log',     desc: 'Who changed what, and when'  },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="max-w-[1000px] mx-auto space-y-6">

      {/* Page header */}
      <div>
        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">Settings</h2>
        <p className="text-[13px] text-[var(--fg-secondary)] mt-0.5">Manage your account, notifications and data</p>
      </div>

      <div className="flex gap-6 items-start">

        {/* ── Sidebar nav ── */}
        <div className="w-[200px] flex-shrink-0 bg-white dark:bg-[#141428] border border-[var(--border)] rounded-2xl p-2 sticky top-0">
          {TABS.map(t => {
            const Icon    = t.icon
            const active  = pathname === t.href
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group',
                  active
                    ? 'bg-[var(--bg-active)] text-coral'
                    : 'text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
                )}
              >
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                  active ? 'bg-coral/15' : 'bg-[var(--bg-secondary)] group-hover:bg-[var(--bg-tertiary)]',
                )}>
                  <Icon size={14} strokeWidth={active ? 2.25 : 1.75} />
                </div>
                <div>
                  <p className={cn('text-[12.5px] font-semibold leading-tight', active ? 'text-coral' : 'text-[var(--fg)]')}>
                    {t.label}
                  </p>
                  <p className="text-[10px] text-[var(--fg-tertiary)] leading-snug mt-0.5">{t.desc}</p>
                </div>
              </Link>
            )
          })}
        </div>

        {/* ── Page content ── */}
        <div className="flex-1 min-w-0 space-y-5">
          {children}
        </div>
      </div>
    </div>
  )
}
