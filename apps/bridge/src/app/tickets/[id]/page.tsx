'use client'
import { useEffect, useState, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bold, Italic, Code, Link as LinkIcon, List, Paperclip, ChevronDown, Github, Lock, Send, Plus, ExternalLink, X } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CustomerProfilePanel } from '@/components/dashboard/CustomerProfilePanel'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
type MessageType = 'REPLY' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT'

interface Author { id: string; name: string | null; email: string; avatarUrl: string | null }
interface Attachment { id: string; filename: string; size: number; url: string; isLink: boolean }
interface Message { id: string; type: MessageType; body: string; isInternal: boolean; authorUser?: Author | null; authorAgent?: Author | null; attachments: Attachment[]; createdAt: string }
interface GithubIssue { issueNumber: number; repo: string; issueUrl: string; title: string; state: string; reviewers: number; daysOpen: number }
interface AiRating { aiRating: number | null; aiEffortScore: number | null; aiSummary: string | null }
interface TicketDetail {
  id: string; number: number; displayId: string; title: string; status: TicketStatus; priority: TicketPriority; category: TicketCategory
  product?: string | null; connector?: string | null; source: string
  user: Author; assignee?: Author | null; messages: Message[]; attachments: Attachment[]
  githubIssue?: GithubIssue | null; rating?: AiRating | null; createdAt: string; updatedAt: string
}

const STATUS_OPTS: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed' }
const STATUS_CLS: Record<TicketStatus, string> = { OPEN: 'd-open', IN_PROGRESS: 'd-prog', WAITING: 'd-wait', RESOLVED: 'd-res', CLOSED: 'd-res' }
const CAT_LABEL: Record<TicketCategory, string> = { BUG_REPORT: 'Bug Report', FEATURE_REQUEST: 'Feature Request', QUESTION: 'Question', BILLING: 'Billing', OTHER: 'Other' }
const PRIORITY_OPTS: TicketPriority[] = ['NORMAL', 'HIGH', 'URGENT']
const PRIORITY_LABEL: Record<TicketPriority, string> = { NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }
const PRIORITY_COLOR: Record<TicketPriority, string> = { NORMAL: '#60A5FA', HIGH: '#FB923C', URGENT: '#F43F5E' }
const PRIORITY_BG: Record<TicketPriority, string>    = { NORMAL: 'rgba(96,165,250,0.12)', HIGH: 'rgba(251,146,60,0.14)', URGENT: 'rgba(244,63,94,0.14)' }

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parseEvent(body: string): string {
  if (body.startsWith('status_changed:')) { const [, f, t] = body.split(':'); return `Status changed ${f} → ${t}` }
  if (body.startsWith('github_linked:')) return `Linked to GitHub issue ${body.slice('github_linked:'.length)}`
  if (body.startsWith('assigned:')) { const w = body.slice('assigned:'.length); return w === 'unassigned' ? 'Ticket unassigned' : 'Ticket assigned' }
  return body
}

function GitHubIssuePanel({
  ticket, token, onLinked,
}: {
  ticket: TicketDetail
  token: string | null
  onLinked: (issue: GithubIssue) => void
}) {
  const [tab, setTab] = useState<'create' | 'link'>('create')
  const [linkInput, setLinkInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [defaultRepo, setDefaultRepo] = useState<string | null | undefined>(undefined) // undefined = loading

  useEffect(() => {
    if (!token) return
    api.get<{ connected: boolean; defaultRepo?: string }>('/github/status', token)
      .then((res) => setDefaultRepo(res.defaultRepo ?? null))
      .catch(() => setDefaultRepo(null))
  }, [token])

  const parseLinkInput = (val: string): { repo: string; issueNumber: number } | null => {
    const urlMatch = val.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/)
    if (urlMatch) return { repo: urlMatch[1], issueNumber: parseInt(urlMatch[2]) }
    const shortMatch = val.match(/^([^/]+\/[^/#]+)#(\d+)$/)
    if (shortMatch) return { repo: shortMatch[1], issueNumber: parseInt(shortMatch[2]) }
    return null
  }

  const handleCreate = async () => {
    if (!token) return
    setIsSubmitting(true); setError('')
    try {
      const res = await api.post<{ issue: GithubIssue }>(`/tickets/${ticket.id}/github/issues`, {}, token)
      onLinked(res.issue)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create issue')
    } finally { setIsSubmitting(false) }
  }

  const handleLink = async () => {
    if (!token || !linkInput.trim()) return
    const parsed = parseLinkInput(linkInput.trim())
    if (!parsed) { setError('Use format owner/repo#123 or paste a GitHub issue URL'); return }
    setIsSubmitting(true); setError('')
    try {
      const res = await api.post<{ issue: GithubIssue }>(`/tickets/${ticket.id}/github/link`, parsed, token)
      onLinked(res.issue)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link issue')
    } finally { setIsSubmitting(false) }
  }

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: 'flex', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', padding: 2, gap: 2, marginBottom: 10 }}>
        {(['create', 'link'] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setError('') }}
            style={{ flex: 1, height: 26, borderRadius: 4, border: 'none', background: tab === t ? 'var(--d-raised)' : 'transparent', color: tab === t ? 'var(--d-text)' : 'var(--d-text-4)', fontSize: 11, fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.15)' : 'none' }}>
            {t === 'create' ? '+ New issue' : '⇒ Link existing'}
          </button>
        ))}
      </div>

      {tab === 'create' ? (
        <div>
          {/* Default repo indicator */}
          {defaultRepo === undefined ? (
            <div className="shimmer" style={{ height: 28, borderRadius: 6, marginBottom: 8 }} />
          ) : defaultRepo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', marginBottom: 8 }}>
              <Github size={11} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--d-text-3)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{defaultRepo}</span>
              <Link href="/settings/github" style={{ fontSize: 10, color: 'var(--d-accent)', textDecoration: 'none', flexShrink: 0 }}>change</Link>
            </div>
          ) : (
            <div style={{ padding: '8px 10px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--r-sm)', marginBottom: 8 }}>
              <p style={{ fontSize: 11, color: '#FCD34D', margin: '0 0 4px', fontWeight: 600 }}>No default repo set</p>
              <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '0 0 6px', lineHeight: 1.4 }}>Set a default repository so issues know where to open.</p>
              <Link href="/settings/github" style={{ fontSize: 11, color: 'var(--d-accent)', textDecoration: 'none', fontWeight: 500 }}>
                Configure in Settings → GitHub →
              </Link>
            </div>
          )}

          <button type="button" onClick={() => { void handleCreate() }}
            disabled={isSubmitting || !defaultRepo}
            style={{ width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, color: defaultRepo ? 'var(--d-text-2)' : 'var(--d-text-4)', cursor: (isSubmitting || !defaultRepo) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (isSubmitting || !defaultRepo) ? 0.5 : 1 }}>
            <Github size={13} />{isSubmitting ? 'Creating…' : 'Create GitHub issue'}
          </button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 11, color: 'var(--d-text-4)', marginBottom: 8, lineHeight: 1.4 }}>
            Paste an issue URL or type <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>owner/repo#123</code>
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={linkInput}
              onChange={(e) => { setLinkInput(e.target.value); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleLink() }}
              placeholder="owner/repo#123"
              style={{ flex: 1, height: 32, padding: '0 8px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text)', outline: 'none', fontFamily: 'var(--font-mono)' }}
            />
            <button type="button" onClick={() => { void handleLink() }} disabled={isSubmitting || !linkInput.trim()}
              style={{ height: 32, padding: '0 10px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: isSubmitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0, opacity: isSubmitting ? 0.6 : 1 }}>
              {isSubmitting ? '…' : 'Link'}
            </button>
          </div>
        </div>
      )}

      {error && <p style={{ fontSize: 11, color: 'var(--d-danger)', marginTop: 6 }}>{error}</p>}
    </div>
  )
}

function PriorityPicker({ value, onChange }: { value: TicketPriority; onChange: (p: TicketPriority) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 30, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
          background: PRIORITY_BG[value], border: `1px solid ${PRIORITY_COLOR[value]}50`,
          borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600,
          color: PRIORITY_COLOR[value], cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[value], flexShrink: 0 }} />
        {PRIORITY_LABEL[value]}
        <ChevronDown size={11} style={{ marginLeft: 2, opacity: 0.7 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 36, left: 0, zIndex: 50,
          background: 'var(--d-raised-2)', border: '1px solid var(--d-border)',
          borderRadius: 'var(--r-md)', padding: 4, minWidth: 140,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          {PRIORITY_OPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { onChange(p); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                padding: '8px 10px', borderRadius: 6, border: 'none',
                background: p === value ? PRIORITY_BG[p] : 'transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLOR[p], flexShrink: 0, boxShadow: `0 0 6px ${PRIORITY_COLOR[p]}80` }} />
              <span style={{ fontSize: 13, fontWeight: p === value ? 600 : 400, color: p === value ? PRIORITY_COLOR[p] : 'var(--d-text-2)', flex: 1, textAlign: 'left' }}>
                {PRIORITY_LABEL[p]}
              </span>
              {p === value && <span style={{ fontSize: 10, color: PRIORITY_COLOR[p] }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tab, setTab] = useState<'reply' | 'note'>('reply')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [fixDeployedNotif, setFixDeployedNotif] = useState<{ id: string } | null>(null)
  const [hasReplied, setHasReplied] = useState(false)
  const [isMarkingPending, setIsMarkingPending] = useState(false)

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  useEffect(() => {
    if (!token || !id) return
    const load = (showSpinner = false) => {
      if (showSpinner) setIsLoading(true)
      return api.get<{ ticket: TicketDetail }>(`/tickets/${id}`, token)
        .then((res) => setTicket(res.ticket))
        .catch(console.error)
        .finally(() => { if (showSpinner) setIsLoading(false) })
    }
    load(true)

    // Poll so inbound customer replies (via email) show up without a reload
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(false)
    }, 10000)
    return () => clearInterval(interval)
  }, [token, id])

  // Check for fix-deployed notification for this ticket
  useEffect(() => {
    if (!token || !ticket) return
    api.get<Array<{ id: string; type: string; ticketId: string | null; isRead: boolean }>>('/notifications', token)
      .then((notifs) => {
        const match = notifs.find((n) => n.type === 'GITHUB_FIX_DEPLOYED' && n.ticketId === ticket.id && !n.isRead)
        setFixDeployedNotif(match ?? null)
      })
      .catch(() => {})
  }, [token, ticket])

  // Check if agent has replied in this ticket
  useEffect(() => {
    if (!ticket || !agent) return
    const agentReplied = ticket.messages.some(
      (m) => m.authorAgent?.id === agent.id && m.type === 'REPLY' && !m.isInternal
    )
    setHasReplied(agentReplied)
  }, [ticket, agent])

  const sendMessage = async () => {
    if (!body.trim() || !token || !ticket) return
    setIsSending(true)
    try {
      const res = await api.post<{ message: Message }>(`/tickets/${ticket.id}/messages`, {
        body, type: tab === 'note' ? 'INTERNAL_NOTE' : 'REPLY', isInternal: tab === 'note',
      }, token)
      setTicket((prev) => prev ? { ...prev, messages: [...prev.messages, res.message] } : prev)
      setBody('')
      if (tab !== 'note') setHasReplied(true)
    } catch (err) { console.error(err) } finally { setIsSending(false) }
  }

  const updateStatus = async (status: TicketStatus) => {
    if (!token || !ticket) return
    try {
      await api.patch(`/tickets/${ticket.id}`, { status }, token)
      // Refetch full ticket so the new system-event message appears in the thread
      const res = await api.get<{ ticket: TicketDetail }>(`/tickets/${ticket.id}`, token)
      setTicket(res.ticket)
    } catch (err) { console.error(err) }
  }

  const updatePriority = async (priority: TicketPriority) => {
    if (!token || !ticket) return
    try {
      await api.patch(`/tickets/${ticket.id}`, { priority }, token)
      // Merge optimistically — no side-effect messages created for priority changes
      setTicket((prev) => prev ? { ...prev, priority } : prev)
    } catch (err) { console.error(err) }
  }

  if (isLoading) return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <div style={{ flex: 1, padding: 32 }}>
        {[...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 8, marginBottom: 16 }} />)}
      </div>
    </div>
  )

  if (!ticket) return null

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />

      {/* Main thread */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderRight: '1px solid var(--d-border)' }}>
        {/* Thread header */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Link href="/inbox" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--d-text-3)', textDecoration: 'none' }}>
              <ArrowLeft size={14} /> Inbox
            </Link>
            <span style={{ color: 'var(--d-text-4)' }}>/</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--d-text-3)' }}>{ticket.displayId}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 12px', lineHeight: 1.2, letterSpacing: '-0.02em', fontFamily: 'var(--font-display)' }}>{ticket.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Status dropdown */}
            <div style={{ position: 'relative' }}>
              <select value={ticket.status} onChange={(e) => updateStatus(e.target.value as TicketStatus)}
                style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>·</span>
            {/* Priority picker */}
            <PriorityPicker value={ticket.priority} onChange={(p) => { void updatePriority(p) }} />
            <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>{CAT_LABEL[ticket.category]}</span>
            {ticket.assignee && (<><span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>·</span><span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>Assigned to {ticket.assignee.name}</span></>)}
          </div>
        </div>

        {/* Fix-deployed amber banner */}
        {fixDeployedNotif && ticket.githubIssue && (
          <div style={{
            margin: '0', padding: '12px 24px',
            background: 'rgba(245,158,11,0.08)',
            borderBottom: '1px solid rgba(245,158,11,0.2)',
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#FCD34D' }}>
                Issue #{ticket.githubIssue.issueNumber} marked as fix-deployed
              </span>
              <span style={{ fontSize: 13, color: 'var(--d-text-3)', marginLeft: 8 }}>
                Reply to the customer to confirm the fix.
              </span>
            </div>
            {hasReplied ? (
              <button
                type="button"
                disabled={isMarkingPending}
                onClick={async () => {
                  if (!token || !ticket) return
                  setIsMarkingPending(true)
                  try {
                    await api.post(`/tickets/${ticket.id}/github/pending`, {}, token)
                    await api.patch(`/notifications/${fixDeployedNotif.id}/read`, {}, token)
                    setFixDeployedNotif(null)
                  } catch (err) { console.error(err) }
                  finally { setIsMarkingPending(false) }
                }}
                style={{
                  height: 30, padding: '0 14px', flexShrink: 0,
                  background: 'rgba(245,158,11,0.15)', color: '#FCD34D',
                  border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--r-sm)',
                  fontSize: 12, fontWeight: 600, cursor: isMarkingPending ? 'wait' : 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {isMarkingPending ? 'Marking…' : '✓ Mark as pending confirmation'}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--d-text-4)', flexShrink: 0, fontStyle: 'italic' }}>
                Reply first, then mark pending
              </span>
            )}
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {ticket.messages.map((msg) => {
            if (msg.type === 'SYSTEM_EVENT') return (
              <div key={msg.id} style={{ textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--d-text-4)', padding: '4px 12px', borderRadius: 999, background: 'var(--d-raised)', border: '1px solid var(--d-border-2)' }}>
                  {msg.body.includes('github') && <Github size={11} />}
                  {parseEvent(msg.body)}
                </span>
              </div>
            )

            const isFromAgent = !!msg.authorAgent
            const author = msg.authorAgent ?? msg.authorUser
            if (!author) return null

            if (msg.isInternal) return (
              <div key={msg.id} style={{ padding: '12px 16px', background: 'var(--d-note-bg)', borderLeft: '3px solid var(--d-note-line)', borderRadius: '0 var(--r-md) var(--r-md) 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#78350F', color: 'var(--d-note-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{initials(author.name, author.email)}</div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-note-text)' }}>{author.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)' }}>
                      <Lock size={9} /> INTERNAL NOTE
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{fmtDate(msg.createdAt)}</span>
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--d-note-text)', margin: 0, whiteSpace: 'pre-wrap' }}>{msg.body}</p>
              </div>
            )

            return (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isFromAgent ? 'flex-end' : 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexDirection: isFromAgent ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: isFromAgent ? 'var(--d-accent)' : 'var(--d-raised-2)', color: isFromAgent ? '#fff' : 'var(--d-text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, border: '1px solid var(--d-border)', flexShrink: 0 }}>
                    {initials(author.name, author.email)}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--d-text-3)' }}>{isFromAgent ? (author.name ?? 'Agent') : (author.name ?? author.email)}</span>
                  <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{fmtDate(msg.createdAt)}</span>
                  {isFromAgent && <span style={{ fontSize: 10, color: 'var(--d-success)', display: 'flex', alignItems: 'center', gap: 3 }}>✓ Sent</span>}
                </div>
                <div style={{
                  maxWidth: '80%', padding: '12px 16px', borderRadius: 'var(--r-md)',
                  background: isFromAgent ? 'rgba(59,130,246,0.12)' : 'var(--d-raised)',
                  border: `1px solid ${isFromAgent ? 'rgba(59,130,246,0.22)' : 'var(--d-border)'}`,
                  borderBottomRightRadius: isFromAgent ? 4 : 'var(--r-md)',
                  borderBottomLeftRadius: isFromAgent ? 'var(--r-md)' : 4,
                }}>
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: isFromAgent ? 'var(--d-text)' : 'var(--d-text-2)', margin: 0, whiteSpace: 'pre-wrap' }}>{msg.body}</p>
                  {msg.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {msg.attachments.map((att) => (
                        <a key={att.id} href={att.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-3)', textDecoration: 'none', background: 'var(--d-surface)' }}>
                          📎 {att.filename}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* AI scoring summary — agent-only, shown once ticket is resolved/closed */}
          {(ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && ticket.rating?.aiSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--d-border)' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>AI Analysis</span>
                <div style={{ flex: 1, height: 1, background: 'var(--d-border)' }} />
              </div>
              <div style={{ padding: '12px 16px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 8, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {ticket.rating.aiRating !== null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: ticket.rating.aiRating >= 4 ? '#22C55E' : ticket.rating.aiRating <= 2 ? '#EF4444' : '#F59E0B', lineHeight: 1 }}>{ticket.rating.aiRating}/5</div>
                      <div style={{ fontSize: 9, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>CSAT</div>
                    </div>
                  )}
                  {ticket.rating.aiEffortScore !== null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: ticket.rating.aiEffortScore >= 4 ? '#EF4444' : ticket.rating.aiEffortScore <= 2 ? '#22C55E' : '#F59E0B', lineHeight: 1 }}>{ticket.rating.aiEffortScore}/5</div>
                      <div style={{ fontSize: 9, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>Effort</div>
                    </div>
                  )}
                </div>
                {(ticket.rating.aiRating !== null || ticket.rating.aiEffortScore !== null) && (
                  <div style={{ width: 1, height: '100%', background: 'var(--d-border)', flexShrink: 0, alignSelf: 'stretch' }} />
                )}
                <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0, lineHeight: 1.6 }}>{ticket.rating.aiSummary}</p>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ borderTop: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--d-border-2)' }}>
            {[{ key: 'reply', label: '✉ Reply to customer' }, { key: 'note', label: '🔒 Internal note' }].map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setTab(key as 'reply' | 'note')}
                style={{ padding: '10px 16px', fontSize: 13, fontWeight: tab === key ? 600 : 400, color: tab === key ? 'var(--d-text)' : 'var(--d-text-3)', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid var(--d-accent)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ background: tab === 'note' ? 'var(--d-note-bg)' : 'var(--d-surface)' }}>
            <div style={{ display: 'flex', gap: 2, padding: '6px 12px', borderBottom: '1px solid var(--d-border-2)' }}>
              {[Bold, Italic, Code, LinkIcon, List, Paperclip].map((Icon, i) => (
                <button key={i} type="button" style={{ width: 26, height: 26, borderRadius: 'var(--r-xs)', color: 'var(--d-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={tab === 'note' ? 'Write an internal note (not visible to customer)…' : 'Write a reply…'}
              style={{ width: '100%', minHeight: 100, padding: '12px 16px', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, color: 'var(--d-text)', background: 'transparent', display: 'block' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid var(--d-border-2)' }}>
              <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>
                {tab === 'reply' ? `Customer: ${ticket.user.email}` : 'Internal — not sent to customer'}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" onClick={async () => { if (body.trim()) await sendMessage(); await updateStatus('RESOLVED') }}
                  style={{ height: 32, padding: '0 14px', background: 'transparent', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {body.trim() ? 'Send & Resolve' : 'Resolve'}
                </button>
                <div style={{ display: 'inline-flex', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                  <button type="button" disabled={!body.trim() || isSending} onClick={sendMessage}
                    style={{ height: 32, padding: '0 14px', background: body.trim() ? 'var(--d-accent)' : 'var(--d-raised)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: body.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6, borderRight: '1px solid rgba(0,0,0,0.2)' }}>
                    <Send size={13} /> {isSending ? 'Sending…' : 'Send & Keep Open'}
                  </button>
                  <button type="button" style={{ height: 32, width: 28, background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}>
                    <ChevronDown size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Right metadata sidebar */}
      <aside style={{ width: 280, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid var(--d-border)', background: 'var(--d-bg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Customer section */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--d-border-2)', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Customer</p>
            <button type="button" onClick={() => setShowProfile(true)} style={{ fontSize: 11, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View profile →</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
              {initials(ticket.user.name, ticket.user.email)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)', margin: 0 }}>{ticket.user.name ?? 'Guest'}</p>
              <p style={{ fontSize: 11, color: 'var(--d-text-3)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.user.email}</p>
            </div>
          </div>
        </div>

        {/* Ticket meta */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--d-border-2)', marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Ticket</p>
          {[
            ['Created', fmtDate(ticket.createdAt)],
            ['Updated', fmtDate(ticket.updatedAt)],
            ...(ticket.product ? [['Product', ticket.product]] : []),
            ...(ticket.connector ? [['Connector', ticket.connector]] : []),
            ['Source', ticket.source],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--d-text-2)', fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* GitHub */}
        <div id="github" style={{ paddingBottom: 16, borderBottom: '1px solid var(--d-border-2)', marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>GitHub</p>

          {ticket.githubIssue ? (
            /* Already linked — show the issue card */
            <div>
              <a href={ticket.githubIssue.issueUrl} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', padding: 10, background: 'var(--d-raised)', borderRadius: 'var(--r-sm)', border: '1px solid var(--d-border)', marginBottom: 6 }}>
                <Github size={14} style={{ color: 'var(--d-text-3)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, color: 'var(--d-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.githubIssue.title}</p>
                  <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '2px 0 0', fontFamily: 'var(--font-mono)' }}>{ticket.githubIssue.repo}#{ticket.githubIssue.issueNumber}</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, color: ticket.githubIssue.state === 'open' ? '#FCD34D' : '#86EFAC', background: ticket.githubIssue.state === 'open' ? 'rgba(245,158,11,0.14)' : 'rgba(34,197,94,0.14)' }}>
                    {ticket.githubIssue.state}
                  </span>
                  <ExternalLink size={11} style={{ color: 'var(--d-text-4)' }} />
                </div>
              </a>
              <button type="button"
                onClick={() => {
                  if (!token) return
                  void api.delete(`/tickets/${ticket.id}/github/link`, token)
                    .then(() => setTicket((prev) => prev ? { ...prev, githubIssue: null } : prev))
                    .catch(console.error)
                }}
                style={{ fontSize: 11, color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                <X size={11} /> Unlink issue
              </button>
            </div>
          ) : (
            /* Not linked — show create / link options */
            <GitHubIssuePanel ticket={ticket} token={token} onLinked={(issue) => setTicket((prev) => prev ? { ...prev, githubIssue: issue } : prev)} />
          )}
        </div>

        {/* Actions */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Actions</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => { void updateStatus('RESOLVED') }}
              style={{ height: 34, background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✓ Resolve ticket
            </button>
            <button type="button" style={{ height: 34, background: 'var(--d-raised)', color: 'var(--d-text-2)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
              ✉ Send to customer
            </button>
            {agent?.role === 'ADMIN' && (
              <button
                type="button"
                onClick={() => {
                  if (!token || !ticket) return
                  void api.delete(`/tickets/${ticket.id}`, token)
                    .then(() => router.push('/inbox'))
                    .catch(console.error)
                }}
                style={{ height: 34, background: 'transparent', color: 'var(--d-text-4)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                🗑 Archive ticket
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Customer profile slide-over */}
      {showProfile && (
        <CustomerProfilePanel userId={ticket.user.id} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}
