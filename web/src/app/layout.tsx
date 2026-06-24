import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'TokenFin',
    template: '%s · TokenFin',
  },
  description: 'LLM Cost Attribution & FinOps Engineering Teams',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://tokenfin.curiousdevs.com'),
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'TokenFin',
    description: 'Track, attribute, control your AI spend.',
    type: 'website',
    images: ['/favicon.svg'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
