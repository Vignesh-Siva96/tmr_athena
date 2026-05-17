'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Paperclip, Code, Github, ChevronDown, User, Check, Bug, Lightbulb, HelpCircle, CreditCard, Circle } from 'lucide-react'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

export interface PreviewTicket {
  id: string; number: number; displayId: string; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  connector?: string | null
  assignee?: { id: string; name: string; avatarUrl: string | null } | null
  user: { id: string; name: string | null; email: string }
  lastMessage?: { body: string; createdAt: string } | null
}

interface AgentUser { id: string; name: string; email: string; role: 'ADMIN' | 'AGENT' }

interface Props {
  ticket: PreviewTicket
  token: string | null
  agent: AgentUser | null
  onRefresh: () => void
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const STATUS_CLS: Record<TicketStatus, string> = { OPEN: 'd-open', IN_PROGRESS: 'd-prog', WAITING: 'd-wait', RESOLVED: 'd-res', CLOSED: 'd-res' }
export const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed' }
export const CAT_LABEL: Record<TicketCategory, string> = { BUG_REPORT: 'Bug', FEATURE_REQUEST: 'Feature', QUESTION: 'Question', BILLING: 'Billing', OTHER: 'Other' }
export const CAT_COLOR: Record<TicketCategory, string> = { BUG_REPORT: '#EF4444', FEATURE_REQUEST: '#3B82F6', QUESTION: '#22C55E', BILLING: '#F59E0B', OTHER: '#71717A' }
export const PRIO_LABEL: Record<TicketPriority, string> = { NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }

export const CAT_ICON: Record<TicketCategory, React.ReactNode> = {
  BUG_REPORT:      <Bug size={10} />,
  FEATURE_REQUEST: <Lightbulb size={10} />,
  QUESTION:        <HelpCircle size={10} />,
  BILLING:         <CreditCard size={10} />,
  OTHER:           <Circle size={10} />,
}

export function CategoryPill({ category, size = 'sm' }: { category: TicketCategory; size?: 'sm' | 'xs' }) {
  const fontSize = size === 'xs' ? 10 : 11
  const padding = size === 'xs' ? '1px 5px' : '1px 6px'
  return (
    <span style={{ fontSize, fontWeight: 500, padding, borderRadius: 4, color: CAT_COLOR[category], background: `${CAT_COLOR[category]}20`, display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      {CAT_ICON[category]}{CAT_LABEL[category]}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === 'NORMAL') return null
  const color = priority === 'URGENT' ? 'var(--d-danger)' : 'var(--d-warning)'
  const bg = priority === 'URGENT' ? 'var(--d-danger-bg)' : 'var(--d-warning-bg)'
  const icon = priority === 'URGENT' ? '⚑' : '↑'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, color, background: bg, border: `1px solid ${color}33` }}>
      {icon} {PRIO_LABEL[priority]}
    </span>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TicketPreviewPanel({ ticket: t, token, agent, onRefresh }: Props) {
  const [quickReply, setQuickReply] = useState('')
  const [isSending, setIsSending] = useState(false)

  const sendQuickReply = async () => {
    if (!quickReply.trim() || !token) return
    setIsSending(true)
    try {
      await api.post(`/tickets/${t.id}/messages`, { body: quickReply, type: 'REPLY' }, token)
      setQuickReply('')
      onRefresh()
    } catch (err) { console.error(err) } finally { setIsSending(false) }
  }

  const resolveTicket = async () => {
    if (!token) return
    try { await api.patch(`/tickets/${t.id}`, { status: 'RESOLVED' }, token); onRefresh() }
    catch (err) { console.error(err) }
  }

  const assignToMe = async () => {
    if (!token || !agent) return
    try { await api.patch(`/tickets/${t.id}`, { assigneeId: agent.id }, token); onRefresh() }
    catch (err) { console.error(err) }
  }

  return (
    <aside style={{ width: 360, flexShrink: 0, background: 'var(--d-surface)', borderLeft: '1px solid var(--d-border)', display: 'flex', flexDirection: 'column', padding: 20, gap: 14, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--d-text-3)' }}>{t.displayId}</span>
            <CategoryPill category={t.category} />
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--d-text)', margin: 0, lineHeight: 1.35 }}>{t.title}</p>
        </div>
        <Link href={`/tickets/${t.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-2)', textDecoration: 'none', flexShrink: 0 }}>
          Open <ArrowUpRight size={12} />
        </Link>
      </div>

      {/* Status + priority */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span>
        <PriorityBadge priority={t.priority} />
      </div>

      {/* Customer */}
      <div style={{ padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>Customer</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, flexShrink: 0 }}>
            {initials(t.user.name, t.user.email)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)', margin: 0 }}>{t.user.name ?? 'Guest'}</p>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.user.email}</p>
          </div>
        </div>
      </div>

      {/* Last message */}
      {t.lastMessage && (
        <div style={{ padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)' }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Last message · {timeAgo(t.lastMessage.createdAt)} ago</p>
          <p style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.6, margin: 0, padding: 12, background: 'var(--d-surface)', borderRadius: 'var(--r-sm)', border: '1px solid var(--d-border-2)' }}>
            &ldquo;{t.lastMessage.body.slice(0, 200)}{t.lastMessage.body.length > 200 ? '…' : ''}&rdquo;
          </p>
        </div>
      )}

      {/* Quick reply */}
      <div style={{ padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', marginTop: 'auto' }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Quick reply</p>
        <textarea value={quickReply} onChange={(e) => setQuickReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendQuickReply() }}
          placeholder="Type a reply…"
          style={{ width: '100%', minHeight: 80, padding: 12, background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', color: 'var(--d-text)', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.6, resize: 'vertical', outline: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[Paperclip, Code, Github].map((Icon, i) => <button key={i} type="button" style={{ width: 26, height: 26, borderRadius: 4, color: 'var(--d-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}><Icon size={13} /></button>)}
          </div>
          <div style={{ display: 'inline-flex', borderRadius: 'var(--r-xs)', overflow: 'hidden' }}>
            <button type="button" onClick={() => { void sendQuickReply() }} disabled={!quickReply.trim() || isSending}
              style={{ height: 28, padding: '0 12px', background: quickReply.trim() ? 'var(--d-accent)' : 'var(--d-raised)', color: quickReply.trim() ? '#fff' : 'var(--d-text-4)', fontSize: 12, fontWeight: 600, border: 'none', cursor: quickReply.trim() ? 'pointer' : 'not-allowed', borderRight: '1px solid rgba(0,0,0,0.2)' }}>
              {isSending ? 'Sending…' : 'Send & keep open'}
            </button>
            <button type="button" style={{ height: 28, width: 24, background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}><ChevronDown size={11} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--d-border-2)' }}>
          <button type="button" onClick={() => { void assignToMe() }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xs)', fontSize: 11, color: 'var(--d-text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
            <User size={12} /> Assign me
          </button>
          <button type="button" onClick={() => { void resolveTicket() }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xs)', fontSize: 11, color: 'var(--d-success)', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Check size={12} /> Resolve
          </button>
          <Link href={`/tickets/${t.id}#github`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xs)', fontSize: 11, color: 'var(--d-text-2)', textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <Github size={12} /> Link issue
          </Link>
        </div>
      </div>
    </aside>
  )
}
