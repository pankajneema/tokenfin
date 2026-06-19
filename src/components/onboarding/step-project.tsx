'use client'
import { useState } from 'react'
import { ArrowRight, Layers, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 50)
}

const TEMPLATES = [
  { id: 'api',      label: 'API Backend',      emoji: '⚡' },
  { id: 'chatbot',  label: 'Chatbot / Agent',   emoji: '🤖' },
  { id: 'data',     label: 'Data Pipeline',     emoji: '🔁' },
  { id: 'custom',   label: 'Custom',            emoji: '✨' },
]

export function StepProject({
  saving,
  onNext,
}: {
  saving: boolean
  onNext: (name: string, slug: string, desc: string) => void
}) {
  const [name,     setName]     = useState('')
  const [slug,     setSlug]     = useState('')
  const [desc,     setDesc]     = useState('')
  const [template, setTemplate] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)

  function handleNameChange(v: string) {
    setName(v)
    if (!slugEdited) setSlug(slugify(v))
  }

  function handleSlugChange(v: string) {
    setSlug(slugify(v))
    setSlugEdited(true)
  }

  const canSubmit = name.trim().length >= 2 && slug.length >= 2

  return (
    <div className="p-7">

      {/* Template picker */}
      <div className="mb-7">
        <p className="text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase mb-3">
          Project type
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplate(t.id)}
              className={cn(
                'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-all duration-150',
                template === t.id
                  ? 'border-coral bg-coral/5 shadow-[0_0_0_1px_#E8533A]'
                  : 'border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--border-strong)]'
              )}
            >
              <span className="text-[18px]">{t.emoji}</span>
              <span className="text-[12.5px] font-medium text-[var(--fg)]">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-4">

        {/* Project name */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            Project name <span className="text-coral">*</span>
          </label>
          <div className="relative">
            <Layers size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-tertiary)] pointer-events-none" />
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="My AI Project"
              autoFocus
              className="w-full pl-9 pr-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] outline-none focus:border-coral focus:ring-2 focus:ring-coral/10 transition-all"
            />
          </div>
        </div>

        {/* Slug */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            Project slug
          </label>
          <div className="flex rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/10 transition-all overflow-hidden">
            <span className="flex items-center px-3 text-[12px] text-[var(--fg-tertiary)] bg-[var(--bg-tertiary)] border-r border-[var(--border)] select-none whitespace-nowrap">
              tokenfin /
            </span>
            <input
              type="text"
              value={slug}
              onChange={e => handleSlugChange(e.target.value)}
              placeholder="my-ai-project"
              className="flex-1 px-3 py-3 bg-transparent text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] outline-none"
            />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold tracking-widest text-[var(--fg-tertiary)] uppercase">
            Description <span className="text-[var(--fg-tertiary)] normal-case font-normal tracking-normal">(optional)</span>
          </label>
          <div className="relative">
            <FileText size={14} className="absolute left-3.5 top-3.5 text-[var(--fg-tertiary)] pointer-events-none" />
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What does this project do?"
              rows={3}
              className="w-full pl-9 pr-3.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[13px] text-[var(--fg)] placeholder:text-[var(--fg-tertiary)] outline-none focus:border-coral focus:ring-2 focus:ring-coral/10 transition-all resize-none"
            />
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="mt-7">
        <button
          type="button"
          onClick={() => onNext(name.trim(), slug, desc.trim())}
          disabled={!canSubmit || saving}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[13.5px] font-semibold transition-all duration-150',
            canSubmit && !saving
              ? 'bg-coral text-white hover:bg-[#D4432B] shadow-[0_2px_8px_rgba(232,83,58,0.3)] hover:shadow-[0_4px_14px_rgba(232,83,58,0.38)] active:scale-[0.985]'
              : 'bg-[var(--bg-tertiary)] text-[var(--fg-tertiary)] cursor-not-allowed'
          )}
        >
          {saving
            ? <span className="w-4 h-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
            : <><span>Create project</span><ArrowRight size={14} strokeWidth={2.5} /></>}
        </button>
      </div>
    </div>
  )
}
