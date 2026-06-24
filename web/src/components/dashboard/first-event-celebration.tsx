'use client'
/**
 * FirstEventCelebration
 *
 * Shows a confetti burst + modal the first time a usage event is detected.
 * Uses CSS animations only — no external deps.
 * "Seen" state is persisted in localStorage so the celebration fires only once.
 */
import { useEffect, useState, useRef } from 'react'
import { Zap, X, ArrowRight } from 'lucide-react'
import Link from 'next/link'

/* ── Confetti config ──────────────────────────────────────────────────────── */
const COLORS = [
  '#14B8A6', // teal
  '#F87171', // coral
  '#60A5FA', // blue
  '#FBBF24', // amber
  '#A78BFA', // purple
  '#34D399', // green
  '#FB923C', // orange
]

interface Particle {
  id:       number
  x:        number
  color:    string
  delay:    number
  size:     number
  duration: number
  shape:    'rect' | 'circle'
  rotation: number
  drift:    number
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id:       i,
    x:        5 + Math.random() * 90,                          // % from left
    color:    COLORS[Math.floor(Math.random() * COLORS.length)],
    delay:    Math.random() * 0.8,                             // s
    size:     6 + Math.random() * 8,                           // px
    duration: 2.5 + Math.random() * 1.5,                      // s
    shape:    Math.random() > 0.4 ? 'rect' : 'circle',
    rotation: Math.random() * 720 - 360,
    drift:    (Math.random() - 0.5) * 80,                      // px horizontal drift
  }))
}

/* ── Inline keyframes injected once ─────────────────────────────────────── */
const STYLE_ID = 'tf-confetti-keyframes'
function injectKeyframes() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
    @keyframes tf-fall {
      0%   { transform: translateY(-20px) translateX(0) rotate(0deg);   opacity: 1; }
      80%  { opacity: 1; }
      100% { transform: translateY(100vh) translateX(var(--drift)) rotate(var(--rot)); opacity: 0; }
    }
    @keyframes tf-modal-in {
      0%   { opacity: 0; transform: scale(0.92) translateY(8px); }
      100% { opacity: 1; transform: scale(1)    translateY(0);    }
    }
    @keyframes tf-zap-pop {
      0%   { transform: scale(0); opacity: 0; }
      60%  { transform: scale(1.2); }
      100% { transform: scale(1); opacity: 1; }
    }
  `
  document.head.appendChild(el)
}

/* ── Storage key ──────────────────────────────────────────────────────────── */
const STORAGE_KEY = 'tf_first_event_celebrated_v1'

/* ─────────────────────────────────────────────────────────────────────────── */

interface Props {
  /** Pass true when the org has at least 1 usage event */
  enabled: boolean
}

export function FirstEventCelebration({ enabled }: Props) {
  const [visible,    setVisible]    = useState(false)
  const [particles,  setParticles]  = useState<Particle[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    try {
      if (localStorage.getItem(STORAGE_KEY)) return   // already celebrated
    } catch {}

    injectKeyframes()
    setParticles(makeParticles(70))
    setVisible(true)

    // Auto-dismiss after 8s
    timerRef.current = setTimeout(() => dismiss(), 8000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [enabled])

  function dismiss() {
    setVisible(false)
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={dismiss}
    >
      {/* Confetti layer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div
            key={p.id}
            style={{
              position:        'absolute',
              top:             '-10px',
              left:            `${p.x}%`,
              width:           p.shape === 'rect' ? p.size * 0.6 : p.size,
              height:          p.shape === 'rect' ? p.size        : p.size,
              borderRadius:    p.shape === 'circle' ? '50%' : '2px',
              backgroundColor: p.color,
              '--drift':       `${p.drift}px`,
              '--rot':         `${p.rotation}deg`,
              animation:       `tf-fall ${p.duration}s ease-in ${p.delay}s both`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Modal card */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ animation: 'tf-modal-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}
        className="relative bg-white dark:bg-[#141428] border border-[var(--border)] rounded-3xl
                   shadow-2xl w-full max-w-md mx-4 p-8 text-center"
      >
        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 p-2 rounded-xl hover:bg-[var(--bg-secondary)]
                     transition-colors text-[var(--fg-tertiary)]"
        >
          <X size={15} />
        </button>

        {/* Zap icon */}
        <div
          style={{ animation: 'tf-zap-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.15s both' }}
          className="w-16 h-16 rounded-2xl bg-[var(--green-bg)] border border-[var(--green)]/20
                     flex items-center justify-center mx-auto mb-5"
        >
          <Zap size={28} className="text-[var(--green)]" />
        </div>

        {/* Heading */}
        <h2 className="text-[22px] font-bold text-[var(--fg)] tracking-tight">
          🎉 First event received!
        </h2>
        <p className="text-[14px] text-[var(--fg-secondary)] mt-2 leading-relaxed">
          Your first usage event just landed in TokenFin.
          Cost attribution, model breakdowns, and analytics are now live.
        </p>

        {/* Stats hint */}
        <div className="flex items-center justify-center gap-3 mt-5 p-4 bg-[var(--bg-secondary)] rounded-2xl">
          <div className="text-center">
            <p className="text-[18px] font-bold text-[var(--fg)]">✓</p>
            <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">Ingest active</p>
          </div>
          <div className="h-8 w-px bg-[var(--border)]" />
          <div className="text-center">
            <p className="text-[18px] font-bold text-[var(--fg)]">✓</p>
            <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">Cost tracking</p>
          </div>
          <div className="h-8 w-px bg-[var(--border)]" />
          <div className="text-center">
            <p className="text-[18px] font-bold text-[var(--fg)]">✓</p>
            <p className="text-[11px] text-[var(--fg-tertiary)] mt-0.5">Analytics on</p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-2.5 mt-5">
          <Link
            href="/dashboard/analytics"
            onClick={dismiss}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 text-[13.5px]"
          >
            View analytics
            <ArrowRight size={14} />
          </Link>
          <button
            onClick={dismiss}
            className="btn-secondary flex-1 text-[13.5px]"
          >
            Stay on overview
          </button>
        </div>

        <p className="text-[11px] text-[var(--fg-tertiary)] mt-4">
          This message won&apos;t appear again &mdash; it&apos;s your one-time milestone notification.
        </p>
      </div>
    </div>
  )
}
