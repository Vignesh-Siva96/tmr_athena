'use client'
import { useEffect, useState, useCallback } from 'react'
import { X, ArrowUpRight } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import Link from 'next/link'

interface GithubNotification {
  id: string
  type: 'GITHUB_FIX_DEPLOYED'
  title: string
  body: string | null
  isRead: boolean
  createdAt: string
  ticket: {
    id: string
    number: number
    title: string
    user: { id: string; name: string | null; email: string }
  } | null
  githubIssueNumber: number | null
  githubRepo: string | null
  githubIssueTitle: string | null
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
  const [notifications, setNotifications] = useState<GithubNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(() => {
    if (!token) return
    api.get<GithubNotification[]>('/notifications', token)
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
        position: 'fixed', left: 220, top: 0, bottom: 0, width: 400,
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
            <svg height="18" width="18" viewBox="0 0 16 16" fill="var(--d-text)">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>GitHub Notifications</span>
            {unread.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 7px',
                borderRadius: 999,
                background: 'rgba(239,68,68,0.15)', color: '#FCA5A5',
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
              <svg height="36" width="36" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.3 }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>No GitHub notifications</p>
              <p style={{ fontSize: 13, color: 'var(--d-text-4)', margin: 0 }}>Label issues fix-deployed to get notified</p>
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--d-border-2)',
                    background: n.isRead ? 'transparent' : 'rgba(59,130,246,0.06)',
                    borderLeft: n.isRead ? '3px solid transparent' : '3px solid var(--d-accent)',
                    opacity: n.isRead ? 0.5 : 1,
                  }}
                >
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 7px',
                          borderRadius: 999,
                          background: 'var(--d-success-bg)', color: 'var(--d-success)',
                          border: '1px solid var(--d-success)',
                        }}>
                          fix-deployed
                        </span>
                        {!n.isRead && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />
                        )}
                      </div>
                      {n.githubIssueTitle && (
                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.4 }}>
                          {n.githubRepo}#{n.githubIssueNumber} — {n.githubIssueTitle}
                        </p>
                      )}
                      {n.ticket && (
                        <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0 }}>
                          Linked to{' '}
                          <span className="mono" style={{ color: 'var(--d-accent)' }}>TMR-{n.ticket.number}</span>
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
                        onClick={() => { void markRead(n.id) }}
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
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
