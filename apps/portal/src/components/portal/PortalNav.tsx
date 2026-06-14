'use client'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { useAppConfig } from '@/lib/brand'
import { LifeBuoy, LogOut } from 'lucide-react'
import { VerificationBanner } from './VerificationBanner'

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

  return (
    <>
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
      <style>{`
        .portal-signout-btn {
          transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
        }
        .portal-signout-btn:hover {
          background: var(--p-surface) !important;
          border-color: var(--p-text-3) !important;
          color: var(--p-text) !important;
        }
        .portal-nav-link:hover {
          background: var(--p-surface) !important;
          color: var(--p-text) !important;
        }
      `}</style>
      <Link href="/submit" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
        {config.logoUrl ? (
          <img src={config.logoUrl} alt={config.appName} style={{ width: 26, height: 26, borderRadius: 4 }} />
        ) : (
          <LifeBuoy size={22} style={{ color: 'var(--p-accent)' }} />
        )}
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--p-text)', letterSpacing: '-0.01em' }}>
          {config.appName}
        </span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--p-text-4)',
          background: 'var(--p-surface)',
          border: '1px solid var(--p-border)',
          borderRadius: 4,
          padding: '2px 6px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Support
        </span>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link
              href="/tickets"
              style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text-2)', textDecoration: 'none', padding: '5px 10px', borderRadius: 'var(--r-sm)' }}
              className="portal-nav-link"
            >
              My tickets
            </Link>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--p-accent)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
              title={user.name ?? user.email}
            >
              {getInitials(user.name, user.email)}
            </div>
            <span style={{ fontSize: 13, color: 'var(--p-text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name ?? user.email}
            </span>
            <button
              onClick={signOut}
              className="portal-signout-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--p-text-3)',
                background: 'none',
                border: '1px solid var(--p-border)',
                cursor: 'pointer',
                padding: '5px 10px',
                borderRadius: 'var(--r-sm)',
                fontFamily: 'inherit',
              }}
            >
              <LogOut size={13} />
              Sign out
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
    <VerificationBanner />
    </>
  )
}
