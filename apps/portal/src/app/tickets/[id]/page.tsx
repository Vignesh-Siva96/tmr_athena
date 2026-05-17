'use client'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bold, Italic, Code, Link as LinkIcon, List, Send, Copy, Github } from 'lucide-react'
import { PortalNav } from '@/components/portal/PortalNav'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
type MessageType = 'REPLY' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT'

interface Author {
  id: string
  name: string | null
  email: string
  avatarUrl: string | null
}

interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  isLink: boolean
  linkUrl?: string | null
}

interface Message {
  id: string
  type: MessageType
  body: string
  isInternal: boolean
  authorUser?: Author | null
  authorAgent?: Author | null
  attachments: Attachment[]
  createdAt: string
}

interface GithubIssue {
  issueNumber: number
  repo: string
  issueUrl: string
  title: string
  state: string
}

interface TicketDetail {
  id: string
  number: number
  displayId: string
  title: string
  status: TicketStatus
  category: TicketCategory
  product?: string | null
  connector?: string | null
  emailThreadId: string
  messages: Message[]
  attachments: Attachment[]
  githubIssue?: GithubIssue | null
  assignee?: Author | null
  user: Author
  createdAt: string
  updatedAt: string
}

const STATUS_STYLES: Record<TicketStatus, { color: string; bg: string; label: string }> = {
  OPEN: { color: '#1D4ED8', bg: '#EFF6FF', label: 'Open' },
  IN_PROGRESS: { color: '#B45309', bg: '#FFFBEB', label: 'In Progress' },
  WAITING: { color: '#7C3AED', bg: '#F5F3FF', label: 'Waiting on you' },
  RESOLVED: { color: '#15803D', bg: '#F0FDF4', label: 'Resolved' },
  CLOSED: { color: '#52525B', bg: '#F4F4F5', label: 'Closed' },
}

const CATEGORY_ICONS: Record<TicketCategory, string> = {
  BUG_REPORT: '🪲',
  FEATURE_REQUEST: '✨',
  QUESTION: '❓',
  BILLING: '💳',
  OTHER: '📋',
}

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  BUG_REPORT: 'Bug Report',
  FEATURE_REQUEST: 'Feature Request',
  QUESTION: 'Question',
  BILLING: 'Billing',
  OTHER: 'Other',
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const p = name.trim().split(' ')
    return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parseSystemEvent(body: string): string {
  if (body.startsWith('status_changed:')) {
    const [, from, to] = body.split(':')
    return `Status changed ${from} → ${to}`
  }
  if (body.startsWith('github_linked:')) {
    const rest = body.slice('github_linked:'.length)
    return `Linked to GitHub issue ${rest}`
  }
  if (body.startsWith('assigned:')) {
    const who = body.slice('assigned:'.length)
    return who === 'unassigned' ? 'Ticket unassigned' : `Ticket assigned`
  }
  return body
}

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user, token, isLoading: authLoading } = useAuth()
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [replyBody, setReplyBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth')
  }, [authLoading, user, router])

  useEffect(() => {
    if (!token || !id) return
    api
      .get<{ ticket: TicketDetail }>(`/tickets/${id}`, token)
      .then((res) => setTicket(res.ticket))
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [token, id])

  const sendReply = async () => {
    if (!replyBody.trim() || !token || !ticket) return
    setIsSending(true)
    try {
      const res = await api.post<{ message: Message }>(`/tickets/${ticket.id}/messages`, { body: replyBody }, token)
      setTicket((prev) => prev ? { ...prev, messages: [...prev.messages, res.message] } : prev)
      setReplyBody('')
    } catch (err) {
      console.error(err)
    } finally {
      setIsSending(false)
    }
  }

  const reopenTicket = async () => {
    if (!token || !ticket) return
    try {
      await api.patch<{ ticket: TicketDetail }>(`/tickets/${ticket.id}`, { status: 'OPEN' }, token)
      const res = await api.get<{ ticket: TicketDetail }>(`/tickets/${ticket.id}`, token)
      setTicket(res.ticket)
    } catch (err) {
      console.error(err)
    }
  }

  const copyId = () => {
    if (ticket?.displayId) {
      void navigator.clipboard.writeText(ticket.displayId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
        <PortalNav />
        <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px' }}>
          <div className="shimmer" style={{ height: 28, width: 200, borderRadius: 4, marginBottom: 16 }} />
          <div className="shimmer" style={{ height: 40, borderRadius: 8, marginBottom: 32 }} />
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ flex: '0 0 65%' }}>
              {[...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 120, borderRadius: 8, marginBottom: 16 }} />)}
            </div>
            <div style={{ flex: 1 }}>
              <div className="shimmer" style={{ height: 240, borderRadius: 8 }} />
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!ticket) return null

  const statusStyle = STATUS_STYLES[ticket.status]
  const isResolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
      <PortalNav />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 80px' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
          <Link href="/tickets" style={{ fontSize: 13, color: 'var(--p-text-3)', textDecoration: 'none' }}>My Tickets</Link>
          <span style={{ color: 'var(--p-text-4)' }}>›</span>
          <span className="mono" style={{ fontSize: 13, color: 'var(--p-text-3)' }}>{ticket.displayId}</span>
        </div>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--p-text)', lineHeight: 1.2, margin: 0, flex: 1 }}>
            {ticket.title}
          </h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 999,
            fontSize: 12, fontWeight: 600,
            color: statusStyle.color, background: statusStyle.bg, flexShrink: 0,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.color }} />
            {statusStyle.label}
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--p-text-4)', marginBottom: 32 }}>
          Opened {formatDate(ticket.createdAt)} · Last activity {formatDate(ticket.updatedAt)}
        </p>

        {/* Two-column layout */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          {/* Thread column (65%) */}
          <div style={{ flex: '0 0 calc(65% - 12px)', minWidth: 0 }}>
            {/* Messages */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
              {ticket.messages.map((msg) => {
                if (msg.type === 'SYSTEM_EVENT') {
                  return (
                    <div key={msg.id} style={{ textAlign: 'center', padding: '4px 0' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontSize: 12, color: 'var(--p-text-4)',
                        padding: '4px 12px', borderRadius: 999,
                        background: 'var(--p-surface)', border: '1px solid var(--p-border-2)',
                      }}>
                        {msg.body.includes('github') && <Github size={12} />}
                        {parseSystemEvent(msg.body)}
                      </span>
                    </div>
                  )
                }

                const isFromUser = !!msg.authorUser
                const author = msg.authorUser ?? msg.authorAgent
                if (!author) return null

                return (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isFromUser ? 'flex-end' : 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexDirection: isFromUser ? 'row-reverse' : 'row' }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: isFromUser ? 'var(--p-accent)' : '#71717A',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, flexShrink: 0,
                      }}>
                        {author.avatarUrl ? (
                          <img src={author.avatarUrl} alt={author.name ?? ''} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          getInitials(author.name, author.email)
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: isFromUser ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)' }}>
                          {isFromUser ? 'You' : (author.name ?? author.email)}
                        </span>
                        {!isFromUser && (
                          <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>from TMR Support</span>
                        )}
                        <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>{formatDate(msg.createdAt)}</span>
                      </div>
                    </div>

                    <div style={{
                      maxWidth: '85%',
                      padding: '12px 16px',
                      borderRadius: 'var(--r-md)',
                      background: isFromUser ? '#EFF4FE' : '#fff',
                      border: `1px solid ${isFromUser ? 'rgba(37,99,235,0.15)' : 'var(--p-border)'}`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--p-text)', margin: 0, whiteSpace: 'pre-wrap' }}>
                        {msg.body}
                      </p>
                      {msg.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                          {msg.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px',
                                border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)',
                                fontSize: 12, color: 'var(--p-text-2)', textDecoration: 'none',
                                background: 'rgba(255,255,255,0.8)',
                              }}
                            >
                              📎 {att.filename}
                              <span style={{ color: 'var(--p-text-4)' }}>{formatSize(att.size)}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Reply composer */}
            {isResolved ? (
              <div style={{
                padding: '16px 20px',
                background: 'var(--p-surface)',
                border: '1px solid var(--p-border)',
                borderRadius: 'var(--r-md)',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 14, color: 'var(--p-text-2)', margin: 0 }}>
                  This ticket has been resolved.{' '}
                  <button type="button" onClick={reopenTicket} style={{ color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }}>
                    Need more help? Reopen →
                  </button>
                </p>
              </div>
            ) : (
              <div style={{
                border: '1px solid var(--p-border)',
                borderRadius: 'var(--r-md)',
                background: '#fff',
                overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--p-border-2)',
                  background: 'var(--p-surface-2)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)' }}>Reply</span>
                  <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>Markdown supported</span>
                </div>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write a reply…"
                  style={{
                    width: '100%', minHeight: 120, padding: '12px 14px',
                    border: 'none', outline: 'none', resize: 'vertical',
                    fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6,
                    color: 'var(--p-text)', background: 'transparent', display: 'block',
                  }}
                />
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderTop: '1px solid var(--p-border-2)',
                  background: 'var(--p-surface-2)',
                }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[Bold, Italic, Code, LinkIcon, List].map((Icon, i) => (
                      <button key={i} type="button" style={{ width: 26, height: 26, borderRadius: 'var(--r-xs)', color: 'var(--p-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
                        <Icon size={13} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={!replyBody.trim() || isSending}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      height: 32, padding: '0 14px',
                      background: replyBody.trim() ? 'var(--p-accent)' : 'var(--p-border)',
                      color: replyBody.trim() ? '#fff' : 'var(--p-text-4)',
                      borderRadius: 'var(--r-sm)',
                      fontSize: 13, fontWeight: 600,
                      border: 'none', cursor: replyBody.trim() ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit',
                    }}
                  >
                    <Send size={13} /> {isSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar column (35%) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              border: '1px solid var(--p-border)',
              borderRadius: 'var(--r-lg)',
              background: '#fff',
              overflow: 'hidden',
            }}>
              {/* Section 1: ticket meta */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--p-border-2)' }}>
                {[
                  { label: 'Status', value: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: statusStyle.color, background: statusStyle.bg }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: statusStyle.color }} />{statusStyle.label}</span> },
                  {
                    label: 'Ticket ID', value: (
                      <button type="button" onClick={copyId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--p-text-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {ticket.displayId} <Copy size={12} style={{ color: 'var(--p-text-4)' }} />
                        {copied && <span style={{ fontSize: 11, color: 'var(--p-success)' }}>Copied!</span>}
                      </button>
                    )
                  },
                  { label: 'Opened', value: new Date(ticket.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
                  { label: 'Category', value: `${CATEGORY_ICONS[ticket.category]} ${CATEGORY_LABELS[ticket.category]}` },
                  ...(ticket.product ? [{ label: 'Product', value: ticket.product }] : []),
                  ...(ticket.connector ? [{ label: 'Connector', value: ticket.connector }] : []),
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--p-text-4)', fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 13, color: 'var(--p-text)', fontWeight: 500 }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Section 2: Linked GitHub issue */}
              {ticket.githubIssue && (
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--p-border-2)' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Linked Issue</p>
                  <a
                    href={ticket.githubIssue.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
                  >
                    <Github size={14} style={{ color: 'var(--p-text-3)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: 'var(--p-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ticket.githubIssue.title}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--p-text-4)', margin: '2px 0 0', fontFamily: 'var(--font-mono)' }}>
                        {ticket.githubIssue.repo}#{ticket.githubIssue.issueNumber}
                      </p>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                      color: ticket.githubIssue.state === 'open' ? '#B45309' : '#15803D',
                      background: ticket.githubIssue.state === 'open' ? '#FFFBEB' : '#F0FDF4',
                    }}>
                      {ticket.githubIssue.state}
                    </span>
                  </a>
                </div>
              )}

              {/* Section 3: Assigned to */}
              {ticket.assignee && (
                <div style={{ padding: '14px 20px' }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Assigned To</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#71717A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
                      {getInitials(ticket.assignee.name, ticket.assignee.email)}
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)', margin: 0 }}>{ticket.assignee.name}</p>
                      <p style={{ fontSize: 12, color: 'var(--p-text-4)', margin: '2px 0 0' }}>TMR Support</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
