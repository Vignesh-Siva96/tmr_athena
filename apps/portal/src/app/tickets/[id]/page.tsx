'use client'
import { useEffect, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bold, Italic, List, Paperclip, Send, Copy, Github as GithubIcon } from 'lucide-react'
import { PortalNav } from '@/components/portal/PortalNav'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { sanitizeHtml, isHtmlBody } from '@tmr/ui/sanitize'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
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
  bodyHtml?: string | null
  isInternal: boolean
  authorUser?: Author | null
  authorAgent?: Author | null
  authorBotName?: string | null
  attachments: Attachment[]
  createdAt: string
}

interface GithubIconIssue {
  issueNumber: number
  repo: string
  issueUrl: string
  title: string
  state: string
}

interface TicketDetail {
  id: string
  ref: string
  displayId: string
  title: string
  status: TicketStatus
  category: TicketCategory
  field1?: string | null
  field2?: string | null
  emailThreadId: string
  messages: Message[]
  attachments: Attachment[]
  githubIssue?: GithubIconIssue | null
  assignee?: Author | null
  user: Author
  createdAt: string
  updatedAt: string
}

const STATUS_STYLES: Record<TicketStatus, { color: string; bg: string; label: string }> = {
  NEW: { color: '#52525B', bg: '#F4F4F5', label: 'New' },
  OPEN: { color: '#1D4ED8', bg: '#EFF6FF', label: 'Open' },
  IN_PROGRESS: { color: '#B45309', bg: '#FFFBEB', label: 'In Progress' },
  WAITING: { color: '#7C3AED', bg: '#F5F3FF', label: 'Waiting on you' },
  RESOLVED: { color: '#15803D', bg: '#F0FDF4', label: 'Resolved' },
  CLOSED: { color: '#52525B', bg: '#F4F4F5', label: 'Closed' },
  DISMISSED: { color: '#52525B', bg: '#F4F4F5', label: 'Dismissed' },
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return formatDate(iso)
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
  const [hasContent, setHasContent] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [replyAttachments, setReplyAttachments] = useState<Attachment[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replyEditorRef = useRef<HTMLDivElement>(null)

  const applyFormat = (type: 'bold' | 'italic' | 'list') => {
    const editor = replyEditorRef.current
    if (!editor) return
    editor.focus()
    if (type === 'bold') document.execCommand('bold', false)
    else if (type === 'italic') document.execCommand('italic', false)
    else if (type === 'list') document.execCommand('insertUnorderedList', false)
  }

  useEffect(() => {
    if (!authLoading && !user) router.push('/auth')
  }, [authLoading, user, router])

  useEffect(() => {
    if (!token || !id) return
    api
      .get<{ ticket: TicketDetail }>(`/tickets/${id}`, token)
      .then((res) => {
        setTicket(res.ticket)
        lastMessageIdRef.current = res.ticket.messages.at(-1)?.id ?? null
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [token, id])

  const lastMessageIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!token || !id) return
    const poll = async () => {
      if (document.hidden) return
      try {
        const res = await api.get<{ ticket: TicketDetail }>(`/tickets/${id}`, token)
        setTicket((prev) => {
          if (!prev) return res.ticket
          const lastKnown = lastMessageIdRef.current
          const latestId = res.ticket.messages.at(-1)?.id ?? null
          if (latestId === lastKnown) return prev
          lastMessageIdRef.current = latestId
          return { ...prev, messages: res.ticket.messages, status: res.ticket.status, updatedAt: res.ticket.updatedAt }
        })
      } catch {
        // silent
      }
    }
    const interval = setInterval(() => { void poll() }, 5_000)
    return () => clearInterval(interval)
  }, [token, id])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token || !ticket) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
      const res = await fetch(`${apiUrl}/api/v1/files/upload?ticketId=${ticket.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (res.ok) {
        const json = await res.json() as { data: { attachment: Attachment } }
        setReplyAttachments((prev) => [...prev, json.data.attachment])
      }
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const sendReply = async () => {
    const textContent = replyEditorRef.current?.textContent?.trim() ?? ''
    if (!textContent || !token || !ticket) return
    setIsSending(true)
    try {
      const htmlBody = replyEditorRef.current?.innerHTML ?? ''
      const payload: Record<string, unknown> = { body: htmlBody }
      if (replyAttachments.length > 0) payload.attachmentIds = replyAttachments.map((a) => a.id)
      const res = await api.post<{ message: Message }>(`/tickets/${ticket.id}/messages`, payload, token)
      setTicket((prev) => prev ? { ...prev, messages: [...prev.messages, res.message] } : prev)
      if (replyEditorRef.current) replyEditorRef.current.innerHTML = ''
      setHasContent(false)
      setReplyAttachments([])
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

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1500)
  }

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
        <PortalNav />
        <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 32px 96px' }}>
          <div className="shimmer" style={{ height: 20, width: 120, borderRadius: 4, marginBottom: 20 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div className="shimmer" style={{ height: 36, width: 480, borderRadius: 6 }} />
            <div className="shimmer" style={{ height: 28, width: 140, borderRadius: 6 }} />
          </div>
          <div className="shimmer" style={{ height: 18, width: 320, borderRadius: 4, marginBottom: 20 }} />
          <div style={{ height: 1, background: 'var(--p-border-2)', marginBottom: 32 }} />
          <div style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {[140, 100, 180].map((h, i) => (
                <div key={i} style={{ paddingBottom: 20, borderBottom: '1px solid var(--p-border-2)', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div className="shimmer" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                    <div className="shimmer" style={{ height: 14, width: 120, borderRadius: 4 }} />
                  </div>
                  <div className="shimmer" style={{ height: h, borderRadius: 6, marginLeft: 48 }} />
                </div>
              ))}
            </div>
            <div style={{ width: 300, flexShrink: 0 }}>
              <div className="shimmer" style={{ height: 120, borderRadius: 8, marginBottom: 16 }} />
              <div className="shimmer" style={{ height: 160, borderRadius: 8, marginBottom: 16 }} />
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!ticket) return null

  const statusStyle = STATUS_STYLES[ticket.status]
  const isResolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
  const nonSystemMessages = ticket.messages.filter(m => m.type !== 'SYSTEM_EVENT')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
      <PortalNav />

      <style>{`
        @media (max-width: 1024px) {
          .ticket-detail-layout { flex-direction: column !important; }
          .ticket-detail-sidebar { width: 100% !important; position: static !important; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
          .ticket-detail-sidebar > div { margin-bottom: 0 !important; }
        }
        @media (max-width: 640px) {
          .ticket-detail-sidebar { grid-template-columns: 1fr !important; }
        }
        .linked-issue-card:hover { background: var(--p-surface) !important; }
        .copy-link-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; background: none; border: 1px solid var(--p-border); border-radius: var(--r-sm); font-size: 12px; color: var(--p-text-3); cursor: pointer; font-family: inherit; transition: border-color 120ms ease, color 120ms ease; }
        .copy-link-btn:hover { border-color: var(--p-text-3); color: var(--p-text); }
      `}</style>

      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 32px 96px' }}>

        {/* Breadcrumb */}
        <div style={{ marginBottom: 20 }}>
          <Link href="/tickets" style={{ fontSize: 13, color: 'var(--p-text-3)', textDecoration: 'none' }}>← My Tickets</Link>
        </div>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 10 }}>
            <h1 style={{ fontSize: 30, fontWeight: 700, color: 'var(--p-text)', lineHeight: 1.2, margin: 0, flex: 1, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticket.title}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 6 }}>
              <button type="button" onClick={copyLink} className="copy-link-btn">
                <Copy size={11} />
                {copiedLink ? 'Copied!' : 'Copy link'}
              </button>
              <button type="button" onClick={copyId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--p-text-3)', cursor: 'pointer' }}>
                {ticket.displayId} <Copy size={10} />
                {copied && <span style={{ fontSize: 10, color: 'var(--p-success)', fontFamily: 'inherit', marginLeft: 2 }}>Copied!</span>}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: statusStyle.color, background: statusStyle.bg, border: `1px solid ${statusStyle.color}30` }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.color }} />
              {statusStyle.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--p-text-4)', padding: '3px 8px', background: 'var(--p-surface)', border: '1px solid var(--p-border)', borderRadius: 999 }}>
              {CATEGORY_ICONS[ticket.category]} {CATEGORY_LABELS[ticket.category]}
            </span>
            <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>Opened {formatDate(ticket.createdAt)}</span>
            <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>Last activity {timeAgo(ticket.updatedAt)}</span>
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--p-border-2)', marginBottom: 32 }} />

        {/* Two-column layout */}
        <div className="ticket-detail-layout" style={{ display: 'flex', gap: 40, alignItems: 'flex-start' }}>

          {/* Thread column */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {ticket.messages.map((msg, idx) => {
              if (msg.type === 'SYSTEM_EVENT') {
                return (
                  <div key={msg.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--p-border-2)' }} />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--p-text-4)', whiteSpace: 'nowrap' }}>
                      {msg.body.includes('github') && <GithubIcon size={11} />}
                      {parseSystemEvent(msg.body)}
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'var(--p-border-2)' }} />
                  </div>
                )
              }

              const isFromUser = !!msg.authorUser
              const isFromBot = !!msg.authorBotName
              const author = msg.authorUser ?? msg.authorAgent
              if (!author && !isFromBot) return null

              const isLastMessage = idx === nonSystemMessages.indexOf(msg) && nonSystemMessages.at(-1)?.id === msg.id

              return (
                <div
                  key={msg.id}
                  data-testid="message-body"
                  style={{
                    padding: '20px 0',
                    borderBottom: isLastMessage ? 'none' : '1px solid var(--p-border-2)',
                  }}
                >
                  {/* Author row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: isFromBot
                        ? 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)'
                        : isFromUser ? 'var(--p-accent)' : '#3F3F46',
                      color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, overflow: 'hidden',
                    }}>
                      {isFromBot
                        ? <span style={{ fontSize: 16 }}>✨</span>
                        : (author?.avatarUrl
                          ? <img src={author.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : getInitials(author?.name ?? null, author?.email ?? ''))}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--p-text)' }}>
                      {isFromBot
                        ? msg.authorBotName
                        : isFromUser ? (author?.name ?? 'You') : (author?.name ?? author?.email)}
                    </span>
                    {isFromBot && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6', background: 'rgba(139,92,246,0.1)', padding: '2px 7px', borderRadius: 4 }}>
                        AI assistant
                      </span>
                    )}
                    {!isFromUser && !isFromBot && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--p-accent)', background: 'color-mix(in srgb, var(--p-accent) 10%, transparent)', padding: '2px 7px', borderRadius: 4 }}>
                        Support
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--p-text-4)', whiteSpace: 'nowrap' }}>{formatDate(msg.createdAt)}</span>
                  </div>

                  {/* Body */}
                  {msg.bodyHtml
                    ? <div className="msg-html" style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--p-text)', paddingLeft: 48 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.bodyHtml) }} />
                    : isHtmlBody(msg.body)
                    ? <div className="msg-html" style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--p-text)', paddingLeft: 48 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.body) }} />
                    : <p style={{ fontSize: 14.5, lineHeight: 1.7, color: 'var(--p-text)', margin: 0, paddingLeft: 48, whiteSpace: 'pre-wrap' }}>{msg.body}</p>
                  }

                  {/* Attachments */}
                  {msg.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingLeft: 48 }}>
                      {msg.attachments.map((att) => (
                        <a key={att.id} href={att.url} target="_blank" rel="noreferrer" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '4px 8px',
                          background: '#fff',
                          border: '1px solid var(--p-border)',
                          borderRadius: 4,
                          fontSize: 12.5, color: 'var(--p-text)', textDecoration: 'none',
                        }}>
                          <Paperclip size={12} style={{ color: 'var(--p-text-3)', flexShrink: 0 }} />
                          {att.filename}
                          <span style={{ fontSize: 11, color: 'var(--p-text-4)' }}>{formatSize(att.size)}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Reply composer */}
            <div style={{ marginTop: 32 }}>
              {isResolved ? (
                <div style={{
                  padding: '20px 24px',
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: 'var(--r-lg)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#15803D', margin: '0 0 2px' }}>Ticket resolved ✓</p>
                    <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>We hope this helped! Still having trouble?</p>
                  </div>
                  <button type="button" onClick={reopenTicket} style={{ height: 34, padding: '0 16px', background: '#fff', color: '#15803D', border: '1px solid #86EFAC', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    Reopen ticket →
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--p-text-4)' }}>Reply</span>
                  </div>
                  <input ref={fileInputRef} type="file" onChange={handleFileSelect} style={{ display: 'none' }} />
                  <div style={{
                    border: '1px solid var(--p-border)',
                    borderRadius: 'var(--r-lg)',
                    background: '#fff',
                    overflow: 'hidden',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.08)',
                  }}>
                    <div
                      ref={replyEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      data-testid="reply-editor"
                      data-placeholder="Write your reply…"
                      onInput={() => setHasContent((replyEditorRef.current?.textContent?.trim().length ?? 0) > 0)}
                      style={{ width: '100%', minHeight: 120, padding: '14px 16px', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: 'var(--p-text)', background: 'transparent', display: 'block', boxSizing: 'border-box' }}
                    />
                    {replyAttachments.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 10px' }}>
                        {replyAttachments.map((att) => (
                          <span key={att.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', background: 'var(--p-surface)', border: '1px solid var(--p-border)', borderRadius: 4, fontSize: 12 }}>
                            <Paperclip size={11} style={{ color: 'var(--p-text-3)', flexShrink: 0 }} />
                            <span style={{ color: 'var(--p-text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename}</span>
                            <button type="button" onClick={() => setReplyAttachments((p) => p.filter((a) => a.id !== att.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--p-text-4)', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderTop: '1px solid var(--p-border-2)', background: 'var(--p-surface)' }}>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {([{ Icon: Bold, type: 'bold' as const }, { Icon: Italic, type: 'italic' as const }, { Icon: List, type: 'list' as const }]).map(({ Icon, type }) => (
                          <button key={type} type="button" onMouseDown={(e) => { e.preventDefault(); applyFormat(type) }} style={{ width: 28, height: 28, borderRadius: 'var(--r-xs)', color: 'var(--p-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
                            <Icon size={13} />
                          </button>
                        ))}
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} title="Attach file" style={{ width: 28, height: 28, borderRadius: 'var(--r-xs)', color: isUploading ? 'var(--p-accent)' : 'var(--p-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: isUploading ? 'wait' : 'pointer' }}>
                          <Paperclip size={13} />
                        </button>
                      </div>
                      <button
                        type="button" data-testid="reply-send" onClick={sendReply} disabled={!hasContent || isSending}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 16px', background: hasContent ? 'var(--p-accent)' : 'var(--p-border)', color: hasContent ? '#fff' : 'var(--p-text-4)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, border: 'none', cursor: hasContent ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                      >
                        <Send size={13} /> {isSending ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                  <style>{`
                    [data-placeholder]:empty:before { content: attr(data-placeholder); color: var(--p-text-4); pointer-events: none; }
                  `}</style>
                </>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="ticket-detail-sidebar" style={{ width: 300, flexShrink: 0, position: 'sticky', top: 24, alignSelf: 'flex-start' }}>

            {/* Status card */}
            <div style={{ background: '#fff', border: '1px solid var(--p-border)', borderRadius: 'var(--r-lg)', padding: '16px 18px', marginBottom: 16 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 10px' }}>Status</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusStyle.color, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: statusStyle.color }}>{statusStyle.label}</span>
              </div>
              {ticket.assignee ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--p-border-2)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3F3F46', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                    {getInitials(ticket.assignee.name, ticket.assignee.email)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--p-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.assignee.name}</p>
                    <p style={{ fontSize: 11, color: 'var(--p-text-4)', margin: '1px 0 0' }}>Your support rep</p>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--p-border-2)' }}>
                  <p style={{ fontSize: 12, color: 'var(--p-text-4)', margin: 0 }}>Reviewing your request</p>
                </div>
              )}
            </div>

            {/* Details card */}
            <div style={{ background: '#fff', border: '1px solid var(--p-border)', borderRadius: 'var(--r-lg)', padding: '16px 18px', marginBottom: 16 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: '0 0 12px' }}>Details</p>
              {[
                { label: 'Category', value: `${CATEGORY_ICONS[ticket.category]} ${CATEGORY_LABELS[ticket.category]}` },
                ...(ticket.field1 ? [{ label: 'Field 1', value: ticket.field1 }] : []),
                ...(ticket.field2 ? [{ label: 'Field 2', value: ticket.field2 }] : []),
                { label: 'Opened', value: new Date(ticket.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--p-text-4)', fontWeight: 500, flexShrink: 0, paddingTop: 1 }}>{label}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--p-text)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* GitHub issue card */}
            {ticket.githubIssue && (
              <div style={{ background: '#fff', border: '1px solid var(--p-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--p-border-2)' }}>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--p-text-4)', textTransform: 'uppercase', letterSpacing: '0.09em', margin: 0 }}>Linked Issue</p>
                </div>
                <a
                  href={ticket.githubIssue.issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="linked-issue-card"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 18px', textDecoration: 'none', transition: 'background 120ms ease' }}
                >
                  <GithubIcon size={14} style={{ color: 'var(--p-text-3)', marginTop: 2, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--p-text)', margin: '0 0 4px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {ticket.githubIssue.title}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--p-text-4)', fontFamily: 'var(--font-mono)' }}>{ticket.githubIssue.repo}#{ticket.githubIssue.issueNumber}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, color: ticket.githubIssue.state === 'open' ? '#B45309' : '#15803D', background: ticket.githubIssue.state === 'open' ? '#FFFBEB' : '#F0FDF4' }}>
                        {ticket.githubIssue.state}
                      </span>
                    </div>
                  </div>
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
