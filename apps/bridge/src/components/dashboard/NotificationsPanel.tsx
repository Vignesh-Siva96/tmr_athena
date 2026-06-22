'use client'
import { useEffect, useState, useCallback } from 'react'
import { X, ArrowUpRight, Github, TrendingDown, Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import Link from 'next/link'

type NotificationType = 'GITHUB_ISSUE_UPDATED' | 'CHURN_RISK_DETECTED'

interface Notification {
  id: string
  type: NotificationType
  title: string
  body: string | null
  isRead: boolean
  createdAt: string
  ticket: {
    id: string
    ref: string
    title: string
    user: { id: string; name: string | null; email: string }
  } | null
  githubIssueNumber: number | null
  githubRepo: string | null
  githubIssueTitle: string | null
}

// Type-driven presentation so the panel renders any notification kind from one map.
const TYPE_META: Record<NotificationType, { label: string; color: string; bg: string; icon: typeof Github }> = {
  GITHUB_ISSUE_UPDATED: { label: 'GitHub', color: 'var(--d-warning)', bg: 'var(--d-warning-bg)', icon: Github },
  CHURN_RISK_DETECTED: { label: 'Churn risk', color: 'var(--d-danger)', bg: 'var(--d-danger-bg)', icon: TrendingDown },
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props { onClose: () => void }

export function NotificationsPanel({ onClose }: Props) {
  const { token } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(() => {
    if (!token) return
    api.get<Notification[]>('/notifications', token)
      .then(setNotifications)
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const markRead = async (id: string) => {
    if (!token) return
    await api.patch(`/notifications/${id}/read`, {}, token)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
  }

  const markAllRead = async () => {
    if (!token) return
    await api.patch('/notifications/read-all', {}, token)
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
  }

  const unread = notifications.filter((n) => !n.isRead)

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60 }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', left: 48, top: 0, bottom: 0, width: 400,
        background: 'var(--d-surface)', borderRight: '1px solid var(--d-border)',
        zIndex: 61, display: 'flex', flexDirection: 'column',
        boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--d-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={18} style={{ color: 'var(--d-text)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Notifications</span>
            {unread.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 7px',
                borderRadius: 999,
                background: 'var(--d-accent-bg)', color: 'var(--d-accent)',
              }}>
                {unread.length} new
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {unread.length > 0 && (
              <button
                type="button"
                onClick={() => { void markAllRead() }}
                style={{ fontSize: 12, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 28, height: 28, borderRadius: 'var(--r-sm)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--d-text-3)', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="shimmer" style={{ height: 88, margin: '8px 12px', borderRadius: 8 }} />
            ))
          ) : notifications.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              height: '60%', gap: 12, color: 'var(--d-text-4)',
            }}>
              <Bell size={36} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No notifications</p>
              <p style={{ fontSize: 13, color: 'var(--d-text-4)', margin: 0 }}>You&apos;re all caught up</p>
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {notifications.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.GITHUB_ISSUE_UPDATED
                const Icon = meta.icon
                return (
                <div
                  key={n.id}
                  style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--d-border-2)',
                    background: n.isRead ? 'transparent' : 'rgba(255,103,0,0.05)',
                    borderLeft: n.isRead ? '3px solid transparent' : '3px solid var(--d-accent)',
                    opacity: n.isRead ? 0.5 : 1,
                  }}
                >
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 11, fontWeight: 600, padding: '2px 7px',
                          borderRadius: 999,
                          background: meta.bg, color: meta.color,
                          border: `1px solid ${meta.color}`,
                        }}>
                          <Icon size={11} /> {meta.label}
                        </span>
                        {!n.isRead && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />
                        )}
                      </div>
                      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.4 }}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p style={{ fontSize: 12, color: 'var(--d-text-2)', margin: '0 0 4px', lineHeight: 1.4 }}>
                          {n.body}
                        </p>
                      )}
                      {n.ticket && (
                        <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0 }}>
                          <span className="mono" style={{ color: 'var(--d-accent)' }}>TMR-{n.ticket.ref}</span>
                          {' '}· {n.ticket.user.name ?? n.ticket.user.email}
                        </p>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: n.isRead ? 'var(--d-text-4)' : 'var(--d-text-3)', flexShrink: 0, marginTop: 2 }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>

                  {/* Actions */}
                  {n.ticket && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Link
                        href={`/tickets/${n.ticket.id}`}
                        onClick={() => { void markRead(n.id); onClose() }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          height: 28, padding: '0 12px',
                          background: 'var(--d-accent)', color: '#fff',
                          borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        Open ticket <ArrowUpRight size={11} />
                      </Link>
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
