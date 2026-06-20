'use client'
import { useEffect, useState, useRef, use, useCallback, useLayoutEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bold, Italic, Link as LinkIcon, List, Paperclip, ChevronDown, Github, Send, ExternalLink, X, CornerUpLeft, Lock } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CustomerProfilePanel } from '@/components/dashboard/CustomerProfilePanel'
import { EmailNotConfiguredGate } from '@/components/dashboard/EmailNotConfiguredGate'
import { MessageCard } from '@/components/dashboard/MessageCard'
import { CategoryPill } from '@/components/dashboard/TicketPreviewPanel'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { api } from '@/lib/api'
import { sseEventBus } from '@/lib/sseEventBus'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
type MessageType = 'REPLY' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT'

type EmailStatus = 'ACTIVE' | 'BOUNCING' | 'BLOCKED'
interface Author { id: string; name: string | null; email: string; avatarUrl: string | null; emailStatus?: EmailStatus }
interface Attachment { id: string; filename: string; size: number; url: string; isLink: boolean }
interface Message { id: string; type: MessageType; body: string; bodyHtml?: string | null; isInternal: boolean; authorUser?: Author | null; authorAgent?: Author | null; authorBotName?: string | null; attachments: Attachment[]; createdAt: string }
interface GithubIssue { issueNumber: number; repo: string; issueUrl: string; title: string; state: string; reviewers: number; daysOpen: number }
interface AiRating { aiRating: number | null; aiEffortScore: number | null; aiSummary: string | null }
interface Tag { id: string; name: string; color: string }
interface TicketDetail {
  id: string; ref: string; displayId: string; isTicket: boolean; title: string; status: TicketStatus; priority: TicketPriority; category: TicketCategory
  field1?: string | null; field2?: string | null; source: string
  user: Author; assignee?: Author | null; messages: Message[]; attachments: Attachment[]
  tags: Tag[]
  githubIssue?: GithubIssue | null; rating?: AiRating | null; createdAt: string; updatedAt: string
}

// Only lifecycle statuses are settable via dropdown — NEW/DISMISSED are set via convert/dismiss
const STATUS_OPTS: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']
const STATUS_LABEL: Record<TicketStatus, string> = { NEW: 'New', OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed', DISMISSED: 'Dismissed' }
const STATUS_CLS: Record<TicketStatus, string> = { NEW: 'd-new', OPEN: 'd-open', IN_PROGRESS: 'd-prog', WAITING: 'd-wait', RESOLVED: 'd-res', CLOSED: 'd-res', DISMISSED: 'd-res' }
const PRIORITY_OPTS: TicketPriority[] = ['NORMAL', 'HIGH', 'URGENT']
const PRIORITY_LABEL: Record<TicketPriority, string> = { NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }
const PRIORITY_COLOR: Record<TicketPriority, string> = { NORMAL: 'var(--d-accent)', HIGH: 'var(--d-warning)', URGENT: 'var(--d-danger)' }
const PRIORITY_BG: Record<TicketPriority, string>    = { NORMAL: 'var(--d-accent-bg)', HIGH: 'var(--d-warning-bg)', URGENT: 'var(--d-danger-bg)' }

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
          background: PRIORITY_BG[value], border: `1px solid var(--d-border)`,
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
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLOR[p], flexShrink: 0, boxShadow: `0 0 5px ${PRIORITY_COLOR[p]}` }} />
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

function TagPicker({
  ticketId,
  tags,
  token,
  onUpdate,
}: {
  ticketId: string
  tags: Tag[]
  token: string | null
  onUpdate: (tags: Tag[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [allTags, setAllTags] = useState<Tag[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !token) return
    api.get<{ data: Tag[] }>('/tags', token).then((res) => setAllTags(res.data)).catch(() => {})
  }, [open, token])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggleTag = async (tag: Tag) => {
    if (!token) return
    const has = tags.some((t) => t.id === tag.id)
    const next = has ? tags.filter((t) => t.id !== tag.id) : [...tags, tag]
    try {
      await api.patch(`/tickets/${ticketId}`, { tagIds: next.map((t) => t.id) }, token)
      onUpdate(next)
    } catch (err) { console.error(err) }
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span
          key={t.id}
          style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, color: t.color, background: `${t.color}20`, border: `1px solid ${t.color}40`, cursor: 'pointer' }}
          onClick={() => { void toggleTag(t) }}
          title={`Remove ${t.name}`}
        >
          {t.name}
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Add tag"
        style={{ height: 22, padding: '0 6px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 999, fontSize: 11, color: 'var(--d-text-3)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}
      >
        + Tag
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 28, left: 0, zIndex: 60,
          background: 'var(--d-raised-2)', border: '1px solid var(--d-border)',
          borderRadius: 'var(--r-md)', padding: 6, minWidth: 160,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          {allTags.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--d-text-4)', padding: '6px 8px' }}>No tags — create them in Settings.</div>
          ) : allTags.map((tag) => {
            const selected = tags.some((t) => t.id === tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => { void toggleTag(tag) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 10px', borderRadius: 6, border: 'none',
                  background: selected ? `${tag.color}18` : 'transparent',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: selected ? tag.color : 'var(--d-text-2)', flex: 1, textAlign: 'left', fontWeight: selected ? 600 : 400 }}>{tag.name}</span>
                {selected && <span style={{ fontSize: 10, color: tag.color }}>✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AgentTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const { isConnected, isLoading: emailConfigLoading } = useEmailConfig(token)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [composeTab, setComposeTab] = useState<'reply' | 'note'>('reply')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const composeRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [fixDeployedNotif, setFixDeployedNotif] = useState<{ id: string } | null>(null)
  const [hasReplied, setHasReplied] = useState(false)
  const [isMarkingPending, setIsMarkingPending] = useState(false)
  const [supportEmail, setSupportEmail] = useState<string>('')
  const [isConverting, setIsConverting] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)
  const [replyAttachments, setReplyAttachments] = useState<Array<{ id: string; filename: string }>>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [cannedResponses, setCannedResponses] = useState<Array<{ id: string; name: string; body: string }>>([])
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashPickerIdx, setSlashPickerIdx] = useState(0)
  const slashPickerRef = useRef<HTMLDivElement>(null)
  const [slashPickerRect, setSlashPickerRect] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  useEffect(() => {
    if (!token) return
    api.get<{ oauthEmail?: string | null; supportEmail?: string | null }>('/config', token)
      .then((cfg) => setSupportEmail(cfg.supportEmail ?? cfg.oauthEmail ?? ''))
      .catch(() => {})
  }, [token])

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

  // SSE: reload messages when a new message arrives on this ticket
  useEffect(() => {
    if (!token || !id) return
    const unsub = sseEventBus.on('message-created', (ev) => {
      if (ev.ticketId !== id) return
      api.get<{ ticket: TicketDetail }>(`/tickets/${id}`, token)
        .then((res) => setTicket(res.ticket))
        .catch(() => {})
    })
    return unsub
  }, [token, id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
        const json = await res.json() as { data: { attachment: { id: string; filename: string } } }
        setReplyAttachments((prev) => [...prev, json.data.attachment])
      }
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [token, ticket])

  const sendMessage = useCallback(async () => {
    const textContent = editorRef.current?.textContent?.trim() ?? ''
    if (!textContent || !token || !ticket) return
    const htmlBody = editorRef.current?.innerHTML ?? ''
    setIsSending(true)
    try {
      const payload: Record<string, unknown> = {
        body: htmlBody,
        type: composeTab === 'note' ? 'INTERNAL_NOTE' : 'REPLY',
        isInternal: composeTab === 'note',
      }
      if (replyAttachments.length > 0) payload.attachmentIds = replyAttachments.map((a) => a.id)
      const res = await api.post<{ message: Message }>(`/tickets/${ticket.id}/messages`, payload, token)
      setTicket((prev) => prev ? { ...prev, messages: [...prev.messages, res.message] } : prev)
      setBody('')
      setReplyAttachments([])
      if (editorRef.current) editorRef.current.innerHTML = ''
      setShowCompose(false)
      if (composeTab !== 'note') setHasReplied(true)
    } catch (err) { console.error(err) } finally { setIsSending(false) }
  }, [token, ticket, composeTab, replyAttachments])

  const applyFormat = (type: 'bold' | 'italic' | 'code' | 'link' | 'list') => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()

    if (type === 'bold') {
      document.execCommand('bold', false)
    } else if (type === 'italic') {
      document.execCommand('italic', false)
    } else if (type === 'code') {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        const code = document.createElement('code')
        const extracted = range.extractContents()
        // Ensure the code element has some content
        if (!extracted.textContent) {
          const textNode = document.createTextNode('code')
          code.appendChild(textNode)
        } else {
          code.appendChild(extracted)
        }
        range.insertNode(code)
        // Move cursor to end of inserted code element
        range.selectNodeContents(code)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    } else if (type === 'link') {
      const url = window.prompt('Enter URL:', 'https://')
      if (url) document.execCommand('createLink', false, url)
    } else if (type === 'list') {
      document.execCommand('insertUnorderedList', false)
    }

    setBody(editor.innerHTML)
  }

  useEffect(() => {
    if (!showCompose) { setSlashQuery(null); return }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCompose(false)
        setBody('')
        setSlashQuery(null)
        if (editorRef.current) editorRef.current.innerHTML = ''
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void sendMessage()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCompose, sendMessage])

  useLayoutEffect(() => {
    if (showCompose && composeRef.current) {
      composeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [showCompose])

  useEffect(() => {
    if (showCompose) {
      // Small delay so the DOM element is mounted before focusing
      const t = setTimeout(() => editorRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  }, [showCompose])

  const handleConvert = async () => {
    if (!token || !ticket) return
    setIsConverting(true)
    try {
      const res = await api.post<{ ticket: TicketDetail }>(`/tickets/${ticket.id}/convert`, {}, token)
      setTicket(res.ticket)
    } catch (err) { console.error(err) }
    finally { setIsConverting(false) }
  }

  const handleDiscard = async () => {
    if (!token || !ticket) return
    setIsDismissing(true)
    try {
      await api.post(`/tickets/${ticket.id}/discard`, {}, token)
      router.push('/inbox')
    } catch (err) { console.error(err) }
    finally { setIsDismissing(false) }
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

  const updateTags = (tags: Tag[]) => {
    setTicket((prev) => prev ? { ...prev, tags } : prev)
    // Refetch full ticket so the tags_changed system-event message appears in the thread
    if (token && ticket) {
      api.get<{ ticket: TicketDetail }>(`/tickets/${ticket.id}`, token)
        .then((res) => setTicket(res.ticket))
        .catch(() => {})
    }
  }

  // Load canned responses once when composer first opens
  useEffect(() => {
    if (!showCompose || !token || cannedResponses.length > 0) return
    api.get<{ data: Array<{ id: string; name: string; body: string }> }>('/canned-responses', token)
      .then((res) => setCannedResponses(res.data))
      .catch(() => {})
  }, [showCompose, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detect /query in the contentEditable editor
  const handleEditorInput = (html: string) => {
    setBody(html)
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) { setSlashQuery(null); return }
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) { setSlashQuery(null); return }
    const text = node.textContent ?? ''
    const cursor = range.startOffset
    // Walk backwards from cursor to find a / that starts the token
    const before = text.slice(0, cursor)
    const slashIdx = before.lastIndexOf('/')
    if (slashIdx === -1) { setSlashQuery(null); return }
    const between = before.slice(0, slashIdx)
    if (between.length > 0 && !/\s$/.test(between)) { setSlashQuery(null); return }
    const query = before.slice(slashIdx + 1)
    if (/\s/.test(query)) { setSlashQuery(null); return }
    // Position picker near caret
    const caretRect = range.getBoundingClientRect()
    if (caretRect.width === 0 && caretRect.height === 0) {
      const editorEl = editorRef.current
      if (editorEl) {
        const r = editorEl.getBoundingClientRect()
        setSlashPickerRect({ top: r.bottom + 4, left: r.left })
      }
    } else {
      setSlashPickerRect({ top: caretRect.bottom + 4, left: caretRect.left })
    }
    setSlashQuery(query)
    setSlashPickerIdx(0)
  }

  const filteredCanned = slashQuery !== null
    ? cannedResponses.filter((r) => r.name.toLowerCase().includes(slashQuery.toLowerCase()))
    : []

  const insertCannedResponse = (cr: { name: string; body: string }) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      const cursor = range.startOffset
      const before = text.slice(0, cursor)
      const slashIdx = before.lastIndexOf('/')
      if (slashIdx !== -1) {
        // Delete the /query text
        const deleteRange = document.createRange()
        deleteRange.setStart(node, slashIdx)
        deleteRange.setEnd(node, cursor)
        deleteRange.deleteContents()
        sel.removeAllRanges()
        sel.addRange(deleteRange)
      }
    }
    document.execCommand('insertHTML', false, cr.body)
    setBody(editor.innerHTML)
    setSlashQuery(null)
  }

  if (!emailConfigLoading && !isConnected) return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <EmailNotConfiguredGate />
      </main>
    </div>
  )

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
            <span className="mono" style={{ fontSize: 13, color: 'var(--d-text-3)' }}>{ticket.isTicket ? ticket.displayId : 'Conversation'}</span>
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
            <CategoryPill category={ticket.category} size="sm" />
            {ticket.assignee && (<><span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>·</span><span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>Assigned to {ticket.assignee.name}</span></>)}
            {ticket.tags && ticket.tags.length > 0 && <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>·</span>}
            <TagPicker ticketId={ticket.id} tags={ticket.tags ?? []} token={token} onUpdate={updateTags} />
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 32px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            const lastIdx = (ticket.messages ?? []).reduce((acc, msg, i) => msg.type !== 'SYSTEM_EVENT' ? i : acc, -1)
            return ticket.messages.map((msg, i) => (
              <MessageCard
                key={msg.id}
                id={msg.id}
                type={msg.type}
                body={msg.body}
                bodyHtml={msg.bodyHtml}
                isInternal={msg.isInternal}
                authorUser={msg.authorUser}
                authorAgent={msg.authorAgent}
                authorBotName={msg.authorBotName}
                attachments={msg.attachments}
                createdAt={msg.createdAt}
                supportEmail={supportEmail}
                isLast={i === lastIdx && !showCompose}
                onReply={() => { setComposeTab('reply'); setShowCompose(true) }}
                onNote={() => { setComposeTab('note'); setShowCompose(true) }}
              />
            ))
          })()}

          {/* Inline compose — Gmail-style card that appears below the last message */}
          {showCompose && (
            <div ref={composeRef} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--d-success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                {agent ? initials(agent.name ?? null, agent.email ?? '') : '?'}
              </div>
              <div style={{ flex: 1, background: composeTab === 'note' ? 'var(--d-note-bg)' : 'var(--d-surface)', border: composeTab === 'note' ? '1px solid rgba(245,158,11,0.3)' : '1px solid var(--d-border)', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: composeTab === 'note' ? '1px solid rgba(245,158,11,0.15)' : '1px solid var(--d-border-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                    {composeTab === 'reply' ? (
                      <>
                        <CornerUpLeft size={13} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--d-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong style={{ fontWeight: 600, color: 'var(--d-text-2)' }}>{agent?.name ?? 'You'}</strong>
                          {supportEmail ? ` <${supportEmail}>` : ''} <span style={{ color: 'var(--d-text-4)' }}>to {ticket.user.email}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <Lock size={12} style={{ color: '#F59E0B', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>Internal note</span>
                        <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>— not visible to customer</span>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, marginLeft: 8 }}>
                    <button type="button" onClick={() => setComposeTab(composeTab === 'reply' ? 'note' : 'reply')}
                      style={{ fontSize: 11, color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px', borderRadius: 4 }}>
                      {composeTab === 'reply' ? 'Switch to note' : 'Switch to reply'}
                    </button>
                    <button type="button" onClick={() => { setShowCompose(false); setBody('') }}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {/* Rich text editor */}
                <div style={{ position: 'relative' }}>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="rt-editor"
                    data-testid="reply-editor"
                    data-placeholder={composeTab === 'note' ? 'Write an internal note…' : 'Write a reply…'}
                    onInput={(e) => handleEditorInput((e.currentTarget as HTMLDivElement).innerHTML)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); applyFormat('bold') }
                      if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); applyFormat('italic') }
                      if (slashQuery !== null && filteredCanned.length > 0) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setSlashPickerIdx((i) => Math.min(i + 1, filteredCanned.length - 1)) }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setSlashPickerIdx((i) => Math.max(i - 1, 0)) }
                        else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertCannedResponse(filteredCanned[slashPickerIdx]!) }
                        else if (e.key === 'Escape') { setSlashQuery(null) }
                      }
                    }}
                    onBlur={() => { setTimeout(() => setSlashQuery(null), 150) }}
                    style={{ width: '100%', minHeight: 130, padding: '12px 14px', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, color: 'var(--d-text)', background: 'transparent', display: 'block', boxSizing: 'border-box', overflowY: 'auto', wordBreak: 'break-word' }}
                  />
                  {/* Slash-command picker popover */}
                  {slashQuery !== null && filteredCanned.length > 0 && slashPickerRect && (
                    <div
                      ref={slashPickerRef}
                      style={{
                        position: 'fixed', top: slashPickerRect.top, left: slashPickerRect.left, zIndex: 999,
                        background: 'var(--d-raised-2)', border: '1px solid var(--d-border)',
                        borderRadius: 'var(--r-md)', padding: 4, minWidth: 220, maxHeight: 220, overflowY: 'auto',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                      }}
                    >
                      {filteredCanned.map((cr, i) => (
                        <button
                          key={cr.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); insertCannedResponse(cr) }}
                          onMouseEnter={() => setSlashPickerIdx(i)}
                          style={{
                            display: 'block', width: '100%', padding: '8px 10px',
                            borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            background: i === slashPickerIdx ? 'var(--d-accent-bg)' : 'transparent',
                            textAlign: 'left',
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-accent)' }}>/{cr.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--d-text-4)', marginLeft: 8 }}>
                            {cr.body.replace(/<[^>]*>/g, '').slice(0, 50)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Attachment chips */}
                {replyAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 14px 0', borderTop: '1px solid var(--d-border-2)' }}>
                    {replyAttachments.map((a) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 4, fontSize: 11, color: 'var(--d-text-3)' }}>
                        <Paperclip size={10} />
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.filename}</span>
                        <button type="button" onClick={() => setReplyAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--d-text-4)', display: 'flex', padding: 0, marginLeft: 2 }}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Toolbar + send */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: composeTab === 'note' ? '1px solid rgba(245,158,11,0.15)' : '1px solid var(--d-border-2)' }}>
                  <div style={{ display: 'flex', gap: 1 }}>
                    {([
                      { Icon: Bold,       action: () => applyFormat('bold'),   title: 'Bold (⌘B)' },
                      { Icon: Italic,     action: () => applyFormat('italic'), title: 'Italic (⌘I)' },
                      { Icon: LinkIcon,   action: () => applyFormat('link'),   title: 'Insert link' },
                      { Icon: List,       action: () => applyFormat('list'),   title: 'Bullet list' },
                      { Icon: Paperclip,  action: () => fileInputRef.current?.click(),  title: 'Attach file' },
                    ] as { Icon: React.ElementType; action?: () => void; title: string }[]).map(({ Icon, action, title }, i) => (
                      <button key={i} type="button" title={title} onClick={action} disabled={i === 3 && isUploading}
                        style={{ width: 26, height: 26, borderRadius: 4, color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: action ? 'pointer' : 'not-allowed', opacity: (action && !(i === 3 && isUploading)) ? 1 : 0.4 }}
                        onMouseEnter={(e) => { if (action) e.currentTarget.style.color = 'var(--d-text-2)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--d-text-4)' }}
                      >
                        <Icon size={13} />
                      </button>
                    ))}
                    {/* Hidden file input for Paperclip */}
                    <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleFileSelect(e)} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Send & Resolve — only shown when there's content */}
                    {body.replace(/<[^>]*>/g, '').trim() && (
                      <button type="button"
                        onClick={async () => { await sendMessage(); void updateStatus('RESOLVED') }}
                        style={{ height: 32, padding: '0 12px', background: 'transparent', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        Send & Resolve
                      </button>
                    )}
                    {/* Primary Send button — always visible, disabled when empty */}
                    {(() => {
                      const hasText = body.replace(/<[^>]*>/g, '').trim().length > 0
                      return (
                        <button type="button" data-testid="reply-send" disabled={!hasText || isSending} onClick={() => void sendMessage()}
                          style={{ height: 32, padding: '0 16px', background: 'var(--d-accent)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 'var(--r-sm)', cursor: hasText ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6, opacity: hasText ? (isSending ? 0.7 : 1) : 0.35, fontFamily: 'inherit' }}>
                          <Send size={13} />{isSending ? 'Sending…' : 'Send'}
                        </button>
                      )
                    })()}
                  </div>
                </div>
              </div>
            </div>
          )}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <p style={{ fontSize: 11, color: 'var(--d-text-3)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ticket.user.email}</p>
                {ticket.user.emailStatus && ticket.user.emailStatus !== 'ACTIVE' && (
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#EF4444', flexShrink: 0 }}>
                    {ticket.user.emailStatus === 'BOUNCING' ? 'email bouncing' : 'email blocked'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Ticket meta */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--d-border-2)', marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Ticket</p>
          {[
            ['Created', fmtDate(ticket.createdAt)],
            ['Updated', fmtDate(ticket.updatedAt)],
            ...(ticket.field1 ? [['Field 1', ticket.field1]] : []),
            ...(ticket.field2 ? [['Field 2', ticket.field2]] : []),
            ['Source', ticket.source],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{label}</span>
              <span style={{ fontSize: 13, color: 'var(--d-text-2)', fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* AI Analysis — shown in sidebar when ticket is resolved/closed */}
        {(ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && ticket.rating?.aiSummary && (
          <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--d-border-2)', marginBottom: 16 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, margin: '0 0 10px' }}>AI Analysis</p>
            {(ticket.rating.aiRating !== null || ticket.rating.aiEffortScore !== null) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {ticket.rating.aiRating !== null && (
                  <div style={{ flex: 1, padding: '8px 10px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: ticket.rating.aiRating >= 4 ? '#22C55E' : ticket.rating.aiRating <= 2 ? '#EF4444' : '#F59E0B' }}>{ticket.rating.aiRating}/5</div>
                    <div style={{ fontSize: 9, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>CSAT</div>
                  </div>
                )}
                {ticket.rating.aiEffortScore !== null && (
                  <div style={{ flex: 1, padding: '8px 10px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: ticket.rating.aiEffortScore >= 4 ? '#EF4444' : ticket.rating.aiEffortScore <= 2 ? '#22C55E' : '#F59E0B' }}>{ticket.rating.aiEffortScore}/5</div>
                    <div style={{ fontSize: 9, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>Effort</div>
                  </div>
                )}
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0, lineHeight: 1.6 }}>{ticket.rating.aiSummary}</p>
          </div>
        )}

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
            {!ticket.isTicket ? (
              <>
                <button type="button" data-testid="convert-ticket" onClick={() => { void handleConvert() }} disabled={isConverting}
                  style={{ height: 34, background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: isConverting ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: isConverting ? 0.6 : 1 }}>
                  {isConverting ? 'Converting…' : '✓ Convert to ticket'}
                </button>
                <button type="button" data-testid="dismiss-ticket" onClick={() => { void handleDiscard() }} disabled={isDismissing}
                  style={{ height: 34, background: 'transparent', color: 'var(--d-text-4)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: isDismissing ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: isDismissing ? 0.6 : 1 }}>
                  {isDismissing ? 'Dismissing…' : 'Dismiss'}
                </button>
              </>
            ) : (
              <>
                {ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? (
                  <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--d-success-bg)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, opacity: 0.6 }}>
                    ✓ Resolved
                  </div>
                ) : (
                  <button type="button" onClick={() => { void updateStatus('RESOLVED') }}
                    style={{ height: 34, background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✓ Resolve ticket
                  </button>
                )}
                <button type="button" style={{ height: 34, background: 'var(--d-raised)', color: 'var(--d-text-2)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✉ Send to customer
                </button>
              </>
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
