'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Check, ArrowUp, User } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { TicketPreviewPanel, CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_COLOR, CAT_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'

interface Assignee { id: string; name: string; avatarUrl: string | null }
interface TicketUser { id: string; name: string | null; email: string }

interface TicketListItem {
  id: string; number: number; displayId: string; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  connector?: string | null; assignee?: Assignee | null; user: TicketUser
  tags: { id: string; name: string; color: string }[]
  lastMessage?: { body: string; createdAt: string } | null
  hasUnreadReply: boolean; updatedAt: string
}

interface TicketsResponse { data: TicketListItem[]; meta: { total: number } }

const PRIO_COLOR: Record<TicketPriority, string> = { URGENT: 'var(--d-danger)', HIGH: 'var(--d-warning)', NORMAL: 'var(--d-border)' }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  if (hours < 48) return 'Yest'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

export default function InboxPage() {
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [isBulkActing, setIsBulkActing] = useState(false)

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadTickets = (sort?: 'desc' | 'asc') => {
    if (!token) return
    const params = new URLSearchParams({ limit: '50', sortOrder: sort ?? sortOrder })
    api.get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => { setTickets(res.data); if (res.data[0] && !selectedId) setSelectedId(res.data[0].id) })
      .catch(console.error).finally(() => setIsLoading(false))
  }

  useEffect(() => { loadTickets() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTickets(sortOrder) }, [sortOrder]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBulkResolve = async () => {
    if (!token || checkedIds.size === 0) return
    setIsBulkActing(true)
    try {
      await Promise.all([...checkedIds].map((id) => api.patch(`/tickets/${id}`, { status: 'RESOLVED' }, token)))
      setCheckedIds(new Set())
      loadTickets()
    } catch (err) { console.error(err) } finally { setIsBulkActing(false) }
  }

  const handleBulkAssignToMe = async () => {
    if (!token || checkedIds.size === 0 || !agent) return
    setIsBulkActing(true)
    try {
      await Promise.all([...checkedIds].map((id) => api.patch(`/tickets/${id}`, { assigneeId: agent.id }, token)))
      setCheckedIds(new Set())
      loadTickets()
    } catch (err) { console.error(err) } finally { setIsBulkActing(false) }
  }

  const toggleCheckAll = () => {
    if (checkedIds.size === tickets.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(tickets.map((t) => t.id)))
    }
  }

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const selected = tickets.find((t) => t.id === selectedId) ?? null
  const allChecked = tickets.length > 0 && checkedIds.size === tickets.length
  const someChecked = checkedIds.size > 0

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Inbox</h1>
            <span style={{ fontSize: 13, color: 'var(--d-text-3)', fontWeight: 400 }}>{isLoading ? '…' : `${tickets.filter(t => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length} open`}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setSortOrder((prev) => prev === 'desc' ? 'asc' : 'desc')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', fontSize: 12, fontWeight: 500, color: 'var(--d-text-2)', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
              {sortOrder === 'desc' ? <><ChevronDown size={12} /> Newest</> : <><ArrowUp size={12} /> Oldest</>}
            </button>
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* List */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {/* Column headers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
              {[['', 16], ['', 14], ['ID', 80], ['Subject', 'flex'], ['Status', 120], ['Assignee', 80], ['Updated', 56]].map(([label, w], i) => (
                <span key={i} style={{ width: w === 'flex' ? undefined : w, flex: w === 'flex' ? 1 : undefined, fontSize: 11, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 3 ? 'right' : 'left' }}>
                  {i === 0 ? (
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleCheckAll}
                      style={{ width: 14, height: 14, accentColor: 'var(--d-accent)', cursor: 'pointer' }}
                    />
                  ) : label}
                </span>
              ))}
            </div>

            {/* Bulk action bar */}
            {someChecked && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 24px', background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-2)' }}>{checkedIds.size} selected</span>
                <button
                  type="button"
                  onClick={() => { void handleBulkResolve() }}
                  disabled={isBulkActing}
                  style={{ height: 26, padding: '0 10px', background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 'var(--r-xs)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✓ Resolve all
                </button>
                <button
                  type="button"
                  onClick={() => { void handleBulkAssignToMe() }}
                  disabled={isBulkActing}
                  style={{ height: 26, padding: '0 10px', background: 'var(--d-raised)', color: 'var(--d-text-2)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xs)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={11} /> Assign to me</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCheckedIds(new Set())}
                  style={{ height: 26, padding: '0 8px', background: 'none', color: 'var(--d-text-3)', border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                  Clear
                </button>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isLoading ? (
                [...Array(8)].map((_, i) => <div key={i} className="shimmer" style={{ height: 48, borderBottom: '1px solid var(--d-border-2)' }} />)
              ) : tickets.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', color: 'var(--d-text-3)' }}>
                  <Check size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
                  <p style={{ fontSize: 15, fontWeight: 500 }}>All clear — no open tickets.</p>
                </div>
              ) : (
                tickets.map((t) => {
                  const sel = t.id === selectedId
                  const checked = checkedIds.has(t.id)
                  return (
                    <div key={t.id} onClick={() => setSelectedId(t.id)} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', height: 56, borderBottom: '1px solid var(--d-border-2)', cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.07)' : 'transparent', transition: 'background 80ms' }}>
                      {sel && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--d-accent)' }} />}
                      <span style={{ width: 16 }} onClick={(e) => toggleCheck(t.id, e)}>
                        <input type="checkbox" checked={checked} onChange={() => {}} style={{ width: 14, height: 14, accentColor: 'var(--d-accent)', cursor: 'pointer' }} />
                      </span>
                      <span style={{ width: 14 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PRIO_COLOR[t.priority], display: 'block' }} /></span>
                      <span className="mono" style={{ width: 80, fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', letterSpacing: '0.02em' }}>{t.displayId}</span>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          {t.hasUnreadReply && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                          <span style={{ fontSize: 14, fontWeight: t.hasUnreadReply ? 600 : 400, color: 'var(--d-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <CategoryPill category={t.category} size="xs" />
                          {t.connector && <span style={{ fontSize: 11, color: 'var(--d-text-3)', flexShrink: 0 }}>{t.connector}</span>}
                          <span style={{ fontSize: 12, color: 'var(--d-text-3)', flexShrink: 0 }}>{t.user.name ?? t.user.email}</span>
                        </div>
                      </div>
                      <span style={{ width: 120, textAlign: 'right' }}><span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span></span>
                      <span style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
                        {t.assignee ? (
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }} title={t.assignee.name}>{initials(t.assignee.name, '')}</div>
                        ) : (
                          <div style={{ width: 26, height: 26, borderRadius: '50%', border: '1px dashed var(--d-border)', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>–</div>
                        )}
                      </span>
                      <span style={{ width: 56, fontSize: 12, color: 'var(--d-text-3)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{timeAgo(t.updatedAt)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {selected && (
            <TicketPreviewPanel
              ticket={selected}
              token={token}
              agent={agent}
              onRefresh={() => loadTickets()}
            />
          )}
        </div>
      </main>
    </div>
  )
}
