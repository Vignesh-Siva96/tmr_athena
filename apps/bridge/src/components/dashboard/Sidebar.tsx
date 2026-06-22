'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LifeBuoy, Settings, LogOut, BarChart2, Activity, Users, Inbox, Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useBackfillStatus } from '@/lib/useBackfillStatus'
import { NotificationsPanel } from './NotificationsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'tickets' | 'customers' | 'analytics' | 'settings'

interface Stats { byStatus: Record<string, number>; byCategory: Record<string, number>; unassigned: number; newCount?: number }

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function DashboardSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { agent, token, signOut } = useAuth()

  const [stats, setStats] = useState<Stats | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeSection, setActiveSection] = useState<Section>('tickets')
  const [showFullNotifs, setShowFullNotifs] = useState(false)
  const [appName, setAppName] = useState('TMR Support')
  const [appLogo, setAppLogo] = useState<string | null>(null)

  const { backfill } = useBackfillStatus(token)

  // Auto-detect section from pathname
  useEffect(() => {
    if (pathname.startsWith('/analytics')) setActiveSection('analytics')
    else if (pathname.startsWith('/customers')) setActiveSection('customers')
    else if (pathname.startsWith('/settings')) setActiveSection('settings')
    else setActiveSection('tickets')
  }, [pathname])

  useEffect(() => {
    if (!token) return
    const loadStats = () => api.get<Stats>('/tickets/stats', token).then(setStats).catch(() => {})
    loadStats()
    api.get<{ appName: string; logoUrl: string | null }>('/config', token)
      .then((r) => { setAppName(r.appName || 'TMR Support'); setAppLogo(r.logoUrl) })
      .catch(() => {})

    // Poll ticket counts so the sidebar reflects new inbound mail without a reload
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void loadStats()
    }, 15000)
    return () => clearInterval(interval)
  }, [token])

  // Live-update when settings are saved without a page reload
  useEffect(() => {
    const handler = (e: Event) => {
      const { appName: name, logoUrl } = (e as CustomEvent<{ appName: string; logoUrl: string | null }>).detail
      if (name) setAppName(name)
      setAppLogo(logoUrl)
    }
    window.addEventListener('app-config-updated', handler)
    return () => window.removeEventListener('app-config-updated', handler)
  }, [])

  const fetchUnread = useCallback(() => {
    if (!token) return
    api.get<number>('/notifications/unread-count', token).then(setUnreadCount).catch(() => {})
  }, [token])

  useEffect(() => {
    fetchUnread()
    const interval = setInterval(fetchUnread, 30000)
    return () => clearInterval(interval)
  }, [fetchUnread])

  const newBadge = stats ? (stats.newCount ?? 0) : 0

  // ─── Rail button ───────────────────────────────────────────────────────────

  const RailBtn = ({ section, icon, badge, navigateTo }: { section: Section; icon: React.ReactNode; badge?: number; navigateTo?: string }) => {
    const active = activeSection === section
    return (
      <button
        type="button"
        title={section.charAt(0).toUpperCase() + section.slice(1)}
        onClick={() => { setActiveSection(section); if (navigateTo) router.push(navigateTo) }}
        style={{
          width: 40, height: 40, borderRadius: 'var(--r-md)', margin: '2px 4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? 'var(--d-rail-pill)' : 'transparent',
          border: 'none', cursor: 'pointer', position: 'relative',
          color: active ? 'var(--d-rail-icon-active)' : 'var(--d-rail-icon-muted)',
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--d-rail-hover)' }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
      >
        {icon}
        {!!badge && badge > 0 && (
          <span style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: '#EF4444', border: '1.5px solid var(--d-bg)' }} />
        )}
      </button>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`@keyframes bfPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
      <aside style={{ width: (activeSection === 'tickets' || activeSection === 'customers') ? 48 : 220, flexShrink: 0, height: '100vh', display: 'flex', background: 'var(--d-bg)', borderRight: '1px solid var(--d-border)', position: 'sticky', top: 0 }}>

        {/* ── Rail ── */}
        <div style={{ width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', borderRight: '1px solid var(--d-rail-border)', paddingTop: 8, background: 'var(--d-rail)' }}>
          {/* Logo */}
          <div style={{ width: 40, height: 40, margin: '2px 4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
            {appLogo
              ? <img src={appLogo} alt="logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
              : <LifeBuoy size={20} style={{ color: 'var(--d-accent)' }} />
            }
          </div>

          {/* Section buttons */}
          <div style={{ position: 'relative' }}>
            <RailBtn section="tickets" icon={<Inbox size={17} />} badge={newBadge} navigateTo="/inbox" />
            {backfill?.archiveStatus === 'RUNNING' && (
              <span
                title={`Importing email history: ${backfill.archiveTotalSeen?.toLocaleString() ?? 0} emails`}
                style={{
                  position: 'absolute', bottom: 4, right: 4,
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--d-accent)', border: '1.5px solid var(--d-bg)',
                  animation: 'bfPulse 1.5s ease-in-out infinite',
                }}
              />
            )}
          </div>
          <RailBtn section="customers" icon={<Users size={17} />} navigateTo="/customers" />
          <RailBtn section="analytics" icon={<BarChart2 size={17} />} navigateTo="/analytics/operations" />

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Notifications bell */}
          <button
            type="button"
            title="Notifications"
            onClick={() => setShowFullNotifs(true)}
            style={{
              width: 40, height: 40, borderRadius: 'var(--r-md)', margin: '2px 4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative',
              color: 'var(--d-rail-icon-muted)', transition: 'background 120ms, color 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--d-rail-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: 'var(--d-accent)', border: '1.5px solid var(--d-bg)' }} />
            )}
          </button>

          {/* Agent avatar */}
          <div title={`${agent?.name ?? 'Agent'} · ${agent?.role === 'ADMIN' ? 'Admin' : 'Agent'}`}
            style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, margin: '4px', cursor: 'default', flexShrink: 0 }}>
            {agent?.name?.slice(0, 2).toUpperCase() ?? 'AG'}
          </div>
          <Link href="/settings" title="Settings"
            style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: activeSection === 'settings' ? 'var(--d-rail-pill)' : 'transparent', color: activeSection === 'settings' ? 'var(--d-rail-icon-active)' : 'var(--d-rail-icon-muted)', margin: '2px 4px' }}>
            <Settings size={15} />
          </Link>
          <button type="button" title="Sign out" onClick={() => { signOut(); router.push('/auth') }}
            style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-rail-icon-muted)', background: 'none', border: 'none', cursor: 'pointer', margin: '2px 4px 8px' }}>
            <LogOut size={15} />
          </button>
        </div>

        {/* ── Panel — hidden when tickets or customers section active (rail-only mode) ── */}
        {activeSection !== 'tickets' && activeSection !== 'customers' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* App name */}
          <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--d-border-2)', flexShrink: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 1px', lineHeight: 1.2 }}>{appName}</p>
            <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{agent?.name ?? 'Agent'} · {agent?.role === 'ADMIN' ? 'Admin' : 'Agent'}</p>
          </div>

          {/* ANALYTICS PANEL */}
          {activeSection === 'analytics' && (
            <div style={{ padding: '8px 8px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', padding: '4px 4px 8px', margin: 0 }}>Analytics</p>
              {[
                { href: '/analytics/operations', label: 'Operations', icon: <Activity size={13} /> },
                { href: '/analytics/customers', label: 'Customer insights', icon: <Users size={13} /> },
              ].map(({ href, label, icon }) => {
                const active = pathname === href
                return (
                  <Link key={href} href={href}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', borderRadius: 'var(--r-sm)', marginBottom: 1, textDecoration: 'none', background: active ? 'var(--d-accent-bg)' : 'transparent', borderLeft: active ? '2px solid var(--d-accent)' : '2px solid transparent', marginLeft: -2 }}>
                    <span style={{ color: active ? 'var(--d-accent)' : 'var(--d-text-3)', display: 'flex' }}>{icon}</span>
                    <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--d-text)' : 'var(--d-text-2)' }}>{label}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
        )}
      </aside>

      {showFullNotifs && <NotificationsPanel onClose={() => { setShowFullNotifs(false); fetchUnread() }} />}
    </>
  )
}
