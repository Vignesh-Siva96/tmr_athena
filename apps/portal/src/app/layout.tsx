import type { Metadata } from 'next'
import '../globals.css'
import { AuthProvider } from '@/lib/auth'
import { AppConfigProvider } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'Support Portal',
  description: 'Submit and track your support tickets',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
