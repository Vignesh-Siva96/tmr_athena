'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Bell, Ticket, CheckCircle, ArrowUpRight, Send, Github } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CategoryPill, PriorityBadge, STATUS_CLS, STATUS_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GithubNotification {
  id: string; isRead: boolean; createdAt: string
  ticket: { id: string; ref: string; title: string; user: { name: string | null; email: string } } | null
  githubIssueNumber: number | null; githubRepo: string | null; githubIssueTitle: string | null
}

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

interface FullTicket {
  id: string; ref: string; displayId: string; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  connector?: string | null; product?: string | null; source: string
  createdAt: string; updatedAt: string
  assignee?: { id: string; name: string } | null
  user: { id: string; name: string | null; email: string; avatarUrl: string | null }
  messages: { id: string; body: string; createdAt: string; type: string; isInternal: boolean; authorAgent?: { name: string } | null; authorUser?: { name: string | null; email: string } | null }[]
  githubIssue?: { issueNumber: number; repo: string; issueUrl: string; title: string; state: string } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function initials(name: string | null, email: string) {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GithubActionPage() {
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<GithubNotification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ticket, setTicket] = useState<FullTicket | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [isSending, setIsSending] = useState(false)

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadNotifications = () => {
    if (!token) return
    api.get<GithubNotification[]>('/notifications', token)
      .then((n) => { setNotifications(n); setIsLoading(false) })
      .catch(() => setIsLoading(false))
  }

  useEffect(() => { loadNotifications() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (notifications.length > 0 && !selectedId) {
      const first = notifications.find((n) => !n.isRead && n.ticket) ?? notifications.find((n) => n.ticket)
      if (first) selectNotif(first)
    }
  }, [notifications]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectNotif = (n: GithubNotification) => {
    if (!n.ticket || !token) return
    setSelectedId(n.id)
    setTicket(null)
    setTicketLoading(true)
    api.get<{ ticket: FullTicket }>(`/tickets/${n.ticket.id}`, token)
      .then((r) => setTicket(r.ticket))
      .catch(() => {})
      .finally(() => setTicketLoading(false))
    if (!n.isRead) void markRead(n.id, false)
  }

  const markRead = async (id: string, updateNotifs = true) => {
    if (!token) return
    await api.patch(`/notifications/${id}/read`, {}, token)
    if (updateNotifs) setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
    else setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
  }

  const markAllRead = async () => {
    if (!token) return
    await api.patch('/notifications/read-all', {}, token)
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
  }

  const sendReply = async () => {
    if (!reply.trim() || !token || !ticket) return
    setIsSending(true)
    try {
      await api.post(`/tickets/${ticket.id}/messages`, { body: reply, type: 'REPLY' }, token)
      setReply('')
      const r = await api.get<{ ticket: FullTicket }>(`/tickets/${ticket.id}`, token)
      setTicket(r.ticket)
    } catch (e) { console.error(e) } finally { setIsSending(false) }
  }

  const resolveTicket = async () => {
    if (!token || !ticket) return
    await api.patch(`/tickets/${ticket.id}`, { status: 'RESOLVED' }, token)
    const r = await api.get<{ ticket: FullTicket }>(`/tickets/${ticket.id}`, token)
    setTicket(r.ticket)
  }

  const unread = notifications.filter((n) => !n.isRead)
  const withTicket = notifications.filter((n) => n.ticket)
  const resolved = notifications.filter((n) => n.isRead).length
  const lastRealMessage = ticket?.messages.filter((m) => m.type === 'REPLY' && !m.isInternal).slice(-1)[0]

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Header */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Action needed</h1>
            {unread.length > 0 && <span style={{ fontSize: 13, color: 'var(--d-text-3)' }}>{unread.length} unread</span>}
          </div>
          {unread.length > 0 && (
            <button type="button" onClick={() => { void markAllRead() }}
              style={{ height: 30, padding: '0 14px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-2)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Check size={12} /> Mark all read
            </button>
          )}
        </header>

        {/* Stats bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          {[
            { icon: <Bell size={13} />, label: 'Unread', value: unread.length, color: unread.length > 0 ? 'var(--d-accent)' : 'var(--d-text-4)' },
            { icon: <Ticket size={13} />, label: 'Tickets needing reply', value: withTicket.length, color: withTicket.length > 0 ? 'var(--d-warning)' : 'var(--d-text-4)' },
            { icon: <CheckCircle size={13} />, label: 'Actioned', value: resolved, color: resolved > 0 ? 'var(--d-success)' : 'var(--d-text-4)' },
          ].map((stat, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRight: i < 2 ? '1px solid var(--d-border)' : 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${stat.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: stat.color, flexShrink: 0 }}>{stat.icon}</div>
              <div>
                <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--d-text)', margin: 0, lineHeight: 1, fontFamily: 'var(--font-display)' }}>{stat.value}</p>
                <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '2px 0 0' }}>{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Split panel */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left — notification list */}
          <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--d-border)', overflowY: 'auto' }}>
            {isLoading ? (
              [...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 80, margin: '8px 10px', borderRadius: 8 }} />)
            ) : notifications.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>All clear</div>
            ) : (
              notifications.map((n) => {
                const sel = n.id === selectedId
                return (
                  <div key={n.id} onClick={() => selectNotif(n)}
                    style={{ position: 'relative', padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid var(--d-border-2)', background: sel ? 'rgba(59,130,246,0.07)' : 'transparent', borderLeft: `3px solid ${sel ? 'var(--d-accent)' : n.isRead ? 'transparent' : 'var(--d-accent)55'}`, opacity: n.isRead && !sel ? 0.5 : 1, transition: 'background 80ms' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'var(--d-success-bg)', color: 'var(--d-success)', border: '1px solid var(--d-success)' }}>fix-deployed</span>
                      <span style={{ fontSize: 10, color: 'var(--d-text-4)' }}>{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.githubIssueTitle && <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.githubIssueTitle}</p>}
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.githubRepo}#{n.githubIssueNumber}
                      {n.ticket && <span style={{ fontFamily: 'inherit', color: 'var(--d-text-3)', marginLeft: 8 }}>· TMR-{n.ticket.ref}</span>}
                    </p>
                  </div>
                )
              })
            )}
          </div>

          {/* Right — full ticket panel */}
          {ticketLoading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: 24 }}>
              {[100, 60, 80, 120].map((h, i) => <div key={i} className="shimmer" style={{ height: h, borderRadius: 8 }} />)}
            </div>
          ) : ticket ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Ticket topbar */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{ticket.displayId}</span>
                      <CategoryPill category={ticket.category} size="xs" />
                      {ticket.connector && <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{ticket.connector}</span>}
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--d-text)', margin: 0, lineHeight: 1.3 }}>{ticket.title}</h2>
                  </div>
                  <Link href={`/tickets/${ticket.id}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-2)', textDecoration: 'none', flexShrink: 0 }}>
                    Open full ticket <ArrowUpRight size={11} />
                  </Link>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className={`pill ${STATUS_CLS[ticket.status]}`}><span className="dot" />{STATUS_LABEL[ticket.status]}</span>
                  <PriorityBadge priority={ticket.priority} />
                </div>
              </div>

              {/* Body — two columns */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

                {/* Left column — customer + last message + reply */}
                <div style={{ overflowY: 'auto', padding: '16px 20px', borderRight: '1px solid var(--d-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Customer */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>Customer</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                        {initials(ticket.user.name, ticket.user.email)}
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)', margin: 0 }}>{ticket.user.name ?? 'Guest'}</p>
                        <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: '2px 0 0' }}>{ticket.user.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Last message */}
                  {lastRealMessage && (
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Last message · {timeAgo(lastRealMessage.createdAt)}</p>
                      <div style={{ padding: '12px 14px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)' }}>
                        <p style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.6, margin: '0 0 6px' }}>
                          &ldquo;{lastRealMessage.body.slice(0, 200)}{lastRealMessage.body.length > 200 ? '…' : ''}&rdquo;
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>
                          — {lastRealMessage.authorAgent?.name ?? lastRealMessage.authorUser?.name ?? lastRealMessage.authorUser?.email ?? 'Unknown'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Quick reply */}
                  <div style={{ marginTop: 'auto' }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Quick reply</p>
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendReply() }}
                      placeholder="Type a reply…"
                      style={{ width: '100%', minHeight: 90, padding: 12, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', color: 'var(--d-text)', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, resize: 'vertical', outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button type="button" onClick={() => { void sendReply() }} disabled={!reply.trim() || isSending}
                        style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: reply.trim() ? 'var(--d-accent)' : 'var(--d-raised)', color: reply.trim() ? '#fff' : 'var(--d-text-4)', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: reply.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                        <Send size={12} /> {isSending ? 'Sending…' : 'Send & keep open'}
                      </button>
                      <button type="button" onClick={() => { void resolveTicket() }}
                        style={{ height: 32, padding: '0 14px', background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Check size={12} /> Resolve
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right column — GitHub issue + ticket metadata */}
                <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* GitHub issue */}
                  {ticket.githubIssue && (
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>GitHub issue</p>
                      <a href={ticket.githubIssue.issueUrl} target="_blank" rel="noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', textDecoration: 'none' }}>
                        <Github size={16} style={{ color: 'var(--d-text-3)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.githubIssue.title}</p>
                          <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0, fontFamily: 'var(--font-mono)' }}>{ticket.githubIssue.repo}#{ticket.githubIssue.issueNumber}</p>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, color: ticket.githubIssue.state === 'open' ? '#FCD34D' : '#86EFAC', background: ticket.githubIssue.state === 'open' ? 'rgba(245,158,11,0.14)' : 'rgba(34,197,94,0.14)', flexShrink: 0 }}>
                          {ticket.githubIssue.state}
                        </span>
                      </a>
                    </div>
                  )}

                  {/* Ticket metadata */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Ticket details</p>
                    <div style={{ padding: '12px 14px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        ['Created', fmtDate(ticket.createdAt)],
                        ['Updated', fmtDate(ticket.updatedAt)],
                        ...(ticket.connector ? [['Connector', ticket.connector]] : []),
                        ...(ticket.product ? [['Product', ticket.product]] : []),
                        ['Source', ticket.source],
                        ['Assignee', ticket.assignee?.name ?? '—'],
                      ].map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{label}</span>
                          <span style={{ fontSize: 12, color: 'var(--d-text-2)', fontWeight: 500, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Thread snippet */}
                  {ticket.messages.filter((m) => m.type === 'REPLY' && !m.isInternal).length > 0 && (
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                        Thread · {ticket.messages.filter((m) => m.type === 'REPLY' && !m.isInternal).length} messages
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {ticket.messages.filter((m) => m.type === 'REPLY' && !m.isInternal).slice(-3).map((m) => {
                          const isAgent = !!m.authorAgent
                          return (
                            <div key={m.id} style={{ padding: '8px 12px', background: isAgent ? 'rgba(59,130,246,0.08)' : 'var(--d-raised)', border: `1px solid ${isAgent ? 'rgba(59,130,246,0.2)' : 'var(--d-border)'}`, borderRadius: 'var(--r-sm)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: isAgent ? 'var(--d-accent)' : 'var(--d-text-3)' }}>
                                  {isAgent ? (m.authorAgent?.name ?? 'Agent') : (m.authorUser?.name ?? m.authorUser?.email ?? 'Customer')}
                                </span>
                                <span style={{ fontSize: 10, color: 'var(--d-text-4)' }}>{timeAgo(m.createdAt)}</span>
                              </div>
                              <p style={{ fontSize: 12, color: 'var(--d-text-2)', margin: 0, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.body}</p>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--d-text-4)' }}>
              <svg width="40" height="40" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.15 }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <p style={{ fontSize: 13, margin: 0 }}>Select a notification</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
