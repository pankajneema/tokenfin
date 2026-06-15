'use client'

import { useState } from 'react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/page'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function StepProject({
  data, onNext, saving,
}: { data: OnboardingData; onNext: (name: string, slug: string, desc: string) => void; saving: boolean }) {
  const [name, setName] = useState(data.projectName)
  const [slug, setSlug] = useState(data.projectName ? slugify(data.projectName) : '')
  const [slugTouched, setSlugTouched] = useState(false)
  const [desc, setDesc] = useState(data.projectDesc)

  function handleName(v: string) {
    setName(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  function handleSlug(v: string) {
    setSlugTouched(true)
    setSlug(slugify(v))
  }

  const valid = name.trim().length >= 2 && slug.length >= 2

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--fg)' }}>
        Create your first project
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--fg-muted)' }}>
        A project groups your LLM usage by product area, feature, or service. You can create more later.
      </p>

      {/* Project type examples */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {[
          { icon: '🤖', label: 'Chatbot' },
          { icon: '✍️', label: 'Content Gen' },
          { icon: '🔍', label: 'Search / RAG' },
          { icon: '📊', label: 'Analytics' },
          { icon: '🛠️', label: 'Code Assist' },
          { icon: '🌐', label: 'Translation' },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => { if (!name) handleName(item.label) }}
            className="flex items-center gap-2 p-2 rounded-lg border text-xs transition-colors hover:border-[var(--accent)]"
            style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)', background: 'var(--bg)' }}
          >
            <span>{item.icon}</span> {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <label className="label">Project name</label>
          <input
            className="input w-full"
            placeholder="My Chatbot"
            value={name}
            onChange={e => handleName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">URL slug</label>
          <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)', background: 'var(--input-bg)' }}>
            <span className="px-3 py-2 text-sm select-none" style={{ color: 'var(--fg-muted)', borderRight: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
              projects/
            </span>
            <input
              className="flex-1 px-3 py-2 text-sm bg-transparent outline-none"
              style={{ color: 'var(--fg)' }}
              placeholder="my-chatbot"
              value={slug}
              onChange={e => handleSlug(e.target.value)}
            />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
            Only lowercase letters, numbers, and hyphens.
          </p>
        </div>
        <div>
          <label className="label">Description <span style={{ color: 'var(--fg-muted)' }}>(optional)</span></label>
          <textarea
            className="input w-full resize-none"
            rows={3}
            placeholder="Briefly describe what this project does…"
            value={desc}
            onChange={e => setDesc(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end mt-8">
        <button className="btn-primary" disabled={!valid || saving} onClick={() => onNext(name.trim(), slug, desc.trim())}>
          {saving ? 'Creating…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
