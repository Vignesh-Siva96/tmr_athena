'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useEmailConfig } from '@/lib/useEmailConfig'

interface NavItem {
  href: string
  label: string
  badge?: string | null
  badgeColor?: string
  disabled?: boolean
}

const STATIC_NAV_ITEMS: { section: string; items: NavItem[] }[] = [
  { section: 'Workspace', items: [
    { href: '/settings/general',          label: 'General' },
    { href: '/settings/branding',         label: 'Branding' },
    { href: '/settings/agents',           label: 'Agents' },
    { href: '/settings/tags',             label: 'Tags' },
    { href: '/settings/canned-responses', label: 'Canned Responses' },
  ]},
  { section: 'Integrations', items: [
    { href: '/settings/github', label: 'GitHub', badge: null, badgeColor: 'var(--d-success)' },
    { href: '/settings/email', label: 'Email', badge: null, badgeColor: 'var(--d-success)' },
    { href: '/settings/sso', label: 'Embedded Portal' },
  ]},
  { section: 'AI', items: [
    { href: '/settings/ai-assistant', label: 'AI Assistant' },
    { href: '/settings/ai-usage', label: 'AI Usage & Cost' },
  ]},
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { token } = useAuth()
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const { isConnected: emailConnected } = useEmailConfig(token)

  useEffect(() => {
    if (!token) return
    api.get<{ connected: boolean }>('/github/status', token)
      .then((res) => setGithubConnected(res.connected))
      .catch(() => setGithubConnected(false))
  }, [token])

  // Build nav items with live integration status
  const navItems = STATIC_NAV_ITEMS.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.href === '/settings/github' && githubConnected !== null) {
        return { ...item, badge: githubConnected ? 'Connected' : null, badgeColor: 'var(--d-success)' }
      }
      if (item.href === '/settings/email') {
        return { ...item, badge: emailConnected ? 'Connected' : null, badgeColor: 'var(--d-success)' }
      }
      return item
    }),
  }))

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Settings nav */}
        <nav style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--d-border)', padding: '20px 12px', overflowY: 'auto' }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>Settings</h2>
            <Link href="/inbox" style={{ fontSize: 12, color: 'var(--d-text-4)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              ← Back to workspace
            </Link>
          </div>
          {navItems.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 10px', margin: '0 0 4px' }}>
                {section}
              </p>
              {items.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={'disabled' in item && item.disabled ? '#' : item.href}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      height: 32, padding: '0 10px', borderRadius: 'var(--r-sm)', marginBottom: 2,
                      textDecoration: 'none',
                      background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--d-accent)' : '2px solid transparent',
                      marginLeft: -2,
                      opacity: 'disabled' in item && item.disabled ? 0.5 : 1,
                      pointerEvents: 'disabled' in item && item.disabled ? 'none' : 'auto',
                    }}
                  >
                    <span style={{ fontSize: 13, color: isActive ? 'var(--d-text)' : 'var(--d-text-3)', fontWeight: isActive ? 500 : 400 }}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999,
                        color: item.badgeColor, background: 'transparent',
                        border: `1px solid ${item.badgeColor}33`,
                      }}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        {/* Content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>{children}</main>
    </div>
  )
}
