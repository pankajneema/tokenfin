import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        coral:    { DEFAULT: '#E8533A', hover: '#D4432B', light: '#FDF0EE' },
        teal:     { DEFAULT: '#00C48C', hover: '#00AE7C', light: '#E6FAF4' },
        midnight: { DEFAULT: '#1A1A2E', light: '#2E2E4A' },
        bg:       { DEFAULT: 'var(--bg)', secondary: 'var(--bg-secondary)', tertiary: 'var(--bg-tertiary)' },
        fg:       { DEFAULT: 'var(--fg)', secondary: 'var(--fg-secondary)' },
        border:   { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        accent:   { DEFAULT: 'var(--accent)' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      boxShadow: {
        soft:      '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)',
        card:      '0 1px 4px 0 rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
        'card-lg': '0 4px 16px 0 rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
        glow:      '0 0 20px rgba(232,83,58,0.15)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-in':   'slideIn 0.2s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'ping-slow':  'pingSlow 2.5s cubic-bezier(0,0,0.2,1) infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' },                   to: { opacity: '1' } },
        slideIn:   { from: { transform: 'translateX(-8px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        slideUp:   { from: { transform: 'translateY(8px)',  opacity: '0' }, to: { transform: 'translateY(0)',  opacity: '1' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.6' } },
        pingSlow:  { '75%,100%': { transform: 'scale(1.8)', opacity: '0' } },
      },
    },
  },
  plugins: [],
}
export default config
