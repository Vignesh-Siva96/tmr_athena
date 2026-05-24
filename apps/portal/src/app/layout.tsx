import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import '../globals.css'
import { AuthProvider } from '@/lib/auth'
import { AppConfigProvider } from '@/lib/brand'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Support Portal',
  description: 'Submit and track your support tickets',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <AppConfigProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </AppConfigProvider>
      </body>
    </html>
  )
}
