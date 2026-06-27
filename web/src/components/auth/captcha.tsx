'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Provider-agnostic CAPTCHA widget for Supabase Auth (hCaptcha or Cloudflare
 * Turnstile). Driven entirely by env so there are no hardcoded keys:
 *
 *   NEXT_PUBLIC_CAPTCHA_PROVIDER = "hcaptcha" | "turnstile"
 *   NEXT_PUBLIC_CAPTCHA_SITE_KEY = <site key from the Supabase captcha setting>
 *
 * When no site key is set this renders nothing and `captchaEnabled` is false,
 * so the login/signup forms work unchanged with CAPTCHA disabled.
 */
const PROVIDER = (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER || 'hcaptcha') as 'hcaptcha' | 'turnstile'
const SITE_KEY = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || ''

export const captchaEnabled = !!SITE_KEY

const SCRIPT: Record<string, string> = {
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
}

export interface CaptchaHandle { reset: () => void }

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('captcha script failed to load'))
    document.head.appendChild(s)
  })
}

export const Captcha = forwardRef<CaptchaHandle, { onToken: (t: string | null) => void }>(
  function Captcha({ onToken }, ref) {
    const el = useRef<HTMLDivElement>(null)
    const widgetId = useRef<string | number | null>(null)
    const [err, setErr] = useState(false)

    useImperativeHandle(ref, () => ({
      reset() {
        const api = (window as any)[PROVIDER]
        if (api && widgetId.current != null) { try { api.reset(widgetId.current) } catch {} }
        onToken(null)
      },
    }))

    useEffect(() => {
      if (!captchaEnabled) return
      let cancelled = false
      loadScript(SCRIPT[PROVIDER]).then(() => {
        const tryRender = () => {
          const api = (window as any)[PROVIDER]
          if (!api || !el.current || cancelled) { setTimeout(tryRender, 150); return }
          if (widgetId.current != null) return
          widgetId.current = api.render(el.current, {
            sitekey: SITE_KEY,
            callback: (token: string) => onToken(token),
            'expired-callback': () => onToken(null),
            'error-callback': () => onToken(null),
          })
        }
        tryRender()
      }).catch(() => setErr(true))
      return () => { cancelled = true }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (!captchaEnabled) return null
    return (
      <div className="my-2">
        <div ref={el} />
        {err && <p className="text-[12px] text-red-500">Couldn’t load the captcha. Check your connection.</p>}
      </div>
    )
  }
)
