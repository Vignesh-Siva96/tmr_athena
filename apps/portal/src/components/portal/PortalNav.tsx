'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { useAppConfig } from '@/lib/brand'
import { LifeBuoy, LogOut } from 'lucide-react'

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ')
    return parts.length >= 2
      ? `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
      : parts[0]!.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export function PortalNav() {
  const { user, signOut } = useAuth()
  const config = useAppConfig()
  const pathname = usePathname()

  return (
    <header
      style={{
        height: 56,
        padding: '0 24px',
        borderBottom: '1px solid var(--p-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.9)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <Link href="/submit" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
        {config.logoUrl ? (
          <img src={config.logoUrl} alt={config.appName} style={{ width: 26, height: 26, borderRadius: 4 }} />
        ) : (
          <LifeBuoy size={22} style={{ color: 'var(--p-accent)' }} />
        )}
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--p-text)', letterSpacing: '-0.01em' }}>
          {config.appName}{' '}
          <span style={{ color: 'var(--p-text-3)', fontWeight: 500 }}>Support</span>
        </span>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <Link
          href="/tickets"
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: pathname.startsWith('/tickets') ? 'var(--p-accent)' : 'var(--p-text-2)',
            textDecoration: 'none',
          }}
        >
          My Tickets
        </Link>
        <Link
          href="/submit"
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: pathname === '/submit' ? 'var(--p-accent)' : 'var(--p-text-2)',
            textDecoration: 'none',
          }}
        >
          Submit a Ticket
        </Link>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--p-accent)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
              }}
              title={user.name ?? user.email}
            >
              {getInitials(user.name, user.email)}
            </div>
            <button
              onClick={signOut}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                color: 'var(--p-text-3)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 'var(--r-sm)',
              }}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <Link
            href="/auth"
            style={{
              height: 34,
              padding: '0 14px',
              background: 'var(--p-accent)',
              color: '#fff',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  )
}
