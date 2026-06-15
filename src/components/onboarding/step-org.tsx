'use client'

import { useState } from 'react'
import type { OnboardingData } from '@/app/(onboarding)/onboarding/page'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function StepOrg({
  data, onNext, saving,
}: { data: OnboardingData; onNext: (name: string, slug: string) => void; saving: boolean }) {
  const [name, setName] = useState(data.orgName)
  const [slug, setSlug] = useState(data.orgSlug)
  const [slugTouched, setSlugTouched] = useState(false)

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
        Create your organization
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--fg-muted)' }}>
        An organization is the top-level container for all your projects and teams.
      </p>

      <div className="space-y-4">
        <div>
          <label className="label">Organization name</label>
          <input
            className="input w-full"
            placeholder="Acme Corp"
            value={name}
            onChange={e => handleName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">URL slug</label>
          <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)', background: 'var(--input-bg)' }}>
            <span className="px-3 py-2 text-sm select-none" style={{ color: 'var(--fg-muted)', borderRight: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
              tokenfin.com/
            </span>
            <input
              className="flex-1 px-3 py-2 text-sm bg-transparent outline-none"
              style={{ color: 'var(--fg)' }}
              placeholder="acme-corp"
              value={slug}
              onChange={e => handleSlug(e.target.value)}
            />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>
            Only lowercase letters, numbers, and hyphens.
          </p>
        </div>
      </div>

      <div className="flex justify-end mt-8">
        <button
          className="btn-primary"
          disabled={!valid || saving}
          onClick={() => onNext(name.trim(), slug)}
        >
          {saving ? 'Creating…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}
