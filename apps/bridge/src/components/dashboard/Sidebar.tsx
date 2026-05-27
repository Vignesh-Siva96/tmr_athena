'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LifeBuoy, Settings, LogOut, BarChart2, Activity, Users, Inbox } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useBackfillStatus } from '@/lib/useBackfillStatus'
import { NotificationsPanel } from './NotificationsPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'tickets' | 'github' | 'analytics'

interface Stats { byStatus: Record<string, number>; byCategory: Record<string, number>; unassigned: number }

interface GithubNotif {
  id: string; isRead: boolean; createdAt: string; githubRepo: string | null
  githubIssueNumber: number | null; githubIssueTitle: string | null
  ticket: { id: string; number: number } | null
}

// ─── Config ───────────────────────────────────────────────────────────────────

const OCTOCAT = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function DashboardSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { agent, token, signOut } = useAuth()

  const [stats, setStats] = useState<Stats | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<GithubNotif[]>([])
  const [notifsLoaded, setNotifsLoaded] = useState(false)
  const [githubConnected, setGithubConnected] = useState(false)
  const [activeSection, setActiveSection] = useState<Section>('tickets')
  const [showFullNotifs, setShowFullNotifs] = useState(false)
  const [appName, setAppName] = useState('TMR Support')
  const [appLogo, setAppLogo] = useState<string | null>(null)

  const { backfill } = useBackfillStatus(token)

  // Auto-detect section from pathname
  useEffect(() => {
    if (pathname.startsWith('/analytics')) setActiveSection('analytics')
    else if (pathname.startsWith('/github')) setActiveSection('github')
    else if (!pathname.startsWith('/settings')) setActiveSection('tickets')
  }, [pathname])

  useEffect(() => {
    if (!token) return
    const loadStats = () => api.get<Stats>('/tickets/stats', token).then(setStats).catch(() => {})
    loadStats()
    api.get<{ connected: boolean }>('/github/status', token)
      .then((r) => setGithubConnected(r.connected)).catch(() => {})
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

  // Load notifications when GitHub section opens
  useEffect(() => {
    if (activeSection !== 'github' || notifsLoaded || !token) return
    api.get<GithubNotif[]>('/notifications', token)
      .then((n) => { setNotifications(n); setNotifsLoaded(true) })
      .catch(() => {})
  }, [activeSection, notifsLoaded, token])

  const totalOpen = stats ? (stats.byStatus['OPEN'] ?? 0) + (stats.byStatus['IN_PROGRESS'] ?? 0) + (stats.byStatus['WAITING'] ?? 0) : undefined
  const totalAll = stats ? Object.values(stats.byStatus).reduce((a, b) => a + b, 0) : undefined

  const markRead = async (id: string) => {
    if (!token) return
    await api.patch(`/notifications/${id}/read`, {}, token)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  const markAllRead = async () => {
    if (!token) return
    await api.patch('/notifications/read-all', {}, token)
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnreadCount(0)
  }

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
          background: active ? 'rgba(59,130,246,0.14)' : 'transparent',
          border: 'none', cursor: 'pointer', position: 'relative',
          color: active ? 'var(--d-accent)' : 'var(--d-text-2)',
          transition: 'background 120ms, color 120ms',
        }}
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--d-raised)' }}
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
      <aside style={{ width: activeSection === 'tickets' ? 48 : 220, flexShrink: 0, height: '100vh', display: 'flex', background: 'var(--d-bg)', borderRight: '1px solid var(--d-border)', position: 'sticky', top: 0 }}>

        {/* ── Rail ── */}
        <div style={{ width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', borderRight: '1px solid var(--d-border-2)', paddingTop: 8 }}>
          {/* Logo */}
          <div style={{ width: 40, height: 40, margin: '2px 4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
            {appLogo
              ? <img src={appLogo} alt="logo" style={{ width: 32, height: 32, objectFit: 'contain' }} />
              : <LifeBuoy size={20} style={{ color: 'var(--d-accent)' }} />
            }
          </div>

          {/* Section buttons */}
          <div style={{ position: 'relative' }}>
            <RailBtn section="tickets" icon={<Inbox size={17} />} navigateTo="/inbox" />
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
          <RailBtn section="github" icon={<svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor"><path d={OCTOCAT} /></svg>} badge={unreadCount} navigateTo="/github" />
          <RailBtn section="analytics" icon={<BarChart2 size={17} />} navigateTo="/analytics" />

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Agent avatar */}
          <div title={`${agent?.name ?? 'Agent'} · ${agent?.role === 'ADMIN' ? 'Admin' : 'Agent'}`}
            style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, margin: '4px', cursor: 'default', flexShrink: 0 }}>
            {agent?.name?.slice(0, 2).toUpperCase() ?? 'AG'}
          </div>
          <Link href="/settings" title="Settings"
            style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-2)', margin: '2px 4px' }}>
            <Settings size={15} />
          </Link>
          <button type="button" title="Sign out" onClick={() => { signOut(); router.push('/auth') }}
            style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-2)', background: 'none', border: 'none', cursor: 'pointer', margin: '2px 4px 8px' }}>
            <LogOut size={15} />
          </button>
        </div>

        {/* ── Panel — hidden when tickets section active (rail-only mode) ── */}
        {activeSection !== 'tickets' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* App name */}
          <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--d-border-2)', flexShrink: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 1px', lineHeight: 1.2 }}>{appName}</p>
            <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{agent?.name ?? 'Agent'} · {agent?.role === 'ADMIN' ? 'Admin' : 'Agent'}</p>
          </div>

          {/* GITHUB PANEL */}
          {activeSection === 'github' && (
            <div style={{ padding: '8px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: 0 }}>GitHub</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: githubConnected ? 'var(--d-success)' : 'var(--d-text-4)' }} />
                  <Link href="/settings/github" title="Settings" style={{ color: 'var(--d-text-4)', display: 'flex' }}><Settings size={11} /></Link>
                </div>
              </div>

              {[
                { href: '/github', label: 'Action needed', icon: '⚡', badge: unreadCount > 0 ? unreadCount : undefined },
                { href: '/github/dashboard', label: 'Dashboard', icon: '📊', soon: true },
              ].map(({ href, label, icon, badge, soon }) => {
                const active = pathname === href
                return (
                  <Link key={href} href={soon ? '#' : href}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 32, padding: '0 8px', borderRadius: 'var(--r-sm)', marginBottom: 1, textDecoration: 'none', background: active ? 'rgba(59,130,246,0.1)' : 'transparent', borderLeft: active ? '2px solid var(--d-accent)' : '2px solid transparent', marginLeft: -2, pointerEvents: soon ? 'none' : 'auto', opacity: soon ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12 }}>{icon}</span>
                      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--d-text)' : 'var(--d-text-2)' }}>{label}</span>
                    </div>
                    {badge !== undefined && badge > 0
                      ? <span style={{ minWidth: 18, height: 18, borderRadius: 999, padding: '0 4px', background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>
                      : soon
                        ? <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 999, background: 'var(--d-raised-2)', color: 'var(--d-text-4)', border: '1px solid var(--d-border)' }}>Soon</span>
                        : null
                    }
                  </Link>
                )
              })}
            </div>
          )}

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
                    style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 8px', borderRadius: 'var(--r-sm)', marginBottom: 1, textDecoration: 'none', background: active ? 'rgba(59,130,246,0.1)' : 'transparent', borderLeft: active ? '2px solid var(--d-accent)' : '2px solid transparent', marginLeft: -2 }}>
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

      {showFullNotifs && <NotificationsPanel onClose={() => setShowFullNotifs(false)} />}
    </>
  )
}
