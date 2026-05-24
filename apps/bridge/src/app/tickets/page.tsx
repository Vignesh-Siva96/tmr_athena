'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { TicketPreviewPanel, CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

interface TicketUser { id: string; name: string | null; email: string }
interface Assignee { id: string; name: string; avatarUrl: string | null }

interface TicketListItem {
  id: string; number: number; displayId: string; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  connector?: string | null; assignee?: Assignee | null; user: TicketUser
  hasUnreadReply: boolean; updatedAt: string
  lastMessage?: { body: string; createdAt: string } | null
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

export default function AllTicketsPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--d-bg)' }} />}>
      <AllTicketsInner />
    </Suspense>
  )
}

function AllTicketsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { agent, token, isLoading: authLoading } = useAuth()
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const statusFilter = searchParams.get('status') ?? ''
  const categoryFilter = searchParams.get('category') ?? ''
  const searchQuery = searchParams.get('search') ?? ''

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadTickets = () => {
    if (!token) return
    setIsLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (statusFilter) params.set('status', statusFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (searchQuery) params.set('search', searchQuery)
    api.get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => {
        setTickets(res.data)
        setTotal(res.meta.total)
        if (res.data[0] && !selectedId) setSelectedId(res.data[0].id)
      })
      .catch(console.error).finally(() => setIsLoading(false))
  }

  useEffect(() => { loadTickets() }, [token, statusFilter, categoryFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new tickets — only when the tab is in the foreground
  useEffect(() => {
    if (!token) return
    const tick = () => {
      if (document.visibilityState === 'visible') loadTickets()
    }
    const interval = setInterval(tick, 15000)
    return () => clearInterval(interval)
  }, [token, statusFilter, categoryFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = tickets.find((t) => t.id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)' }}>
              {statusFilter ? (STATUS_LABEL[statusFilter as TicketStatus] ?? 'Tickets') :
               categoryFilter ? (CAT_LABEL[categoryFilter as TicketCategory] + ' Tickets') :
               'All Tickets'}
            </h1>
            <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>{isLoading ? '…' : `${total} total`}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <select value={statusFilter} onChange={(e) => {
              const p = new URLSearchParams()
              if (e.target.value) p.set('status', e.target.value)
              if (searchQuery) p.set('search', searchQuery)
              router.push(`/tickets${p.toString() ? '?' + p.toString() : ''}`)
            }}
              style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
          </div>
        </header>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Ticket list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {/* Column headers */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
              {[['', 14], ['ID', 80], ['Subject', 'flex'], ['Status', 110], ['Assignee', 80], ['Updated', 52]].map(([label, w], i) => (
                <span key={i} style={{ width: w === 'flex' ? undefined : w, flex: w === 'flex' ? 1 : undefined, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i > 2 ? 'right' : 'left' }}>
                  {label}
                </span>
              ))}
            </div>

            {/* Rows */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isLoading ? (
                [...Array(6)].map((_, i) => <div key={i} className="shimmer" style={{ height: 48, borderBottom: '1px solid var(--d-border-2)' }} />)
              ) : tickets.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%', color: 'var(--d-text-3)', fontSize: 14 }}>
                  No tickets found.
                </div>
              ) : (
                tickets.map((t) => {
                  const sel = t.id === selectedId
                  return (
                    <div key={t.id} onClick={() => setSelectedId(t.id)}
                      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', height: 48, borderBottom: '1px solid var(--d-border-2)', cursor: 'pointer', background: sel ? 'rgba(59,130,246,0.07)' : 'transparent', transition: 'background 80ms' }}
                    >
                      {sel && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--d-accent)' }} />}
                      <span style={{ width: 14 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLOR[t.priority], display: 'block' }} /></span>
                      <span className="mono" style={{ width: 80, fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)' }}>{t.displayId}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                        {t.hasUnreadReply && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                        <span style={{ fontSize: 14, fontWeight: t.hasUnreadReply ? 600 : 500, color: t.hasUnreadReply ? 'var(--d-text)' : 'var(--d-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                        <CategoryPill category={t.category} size="xs" />
                        <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0 }}>· {t.user.name ?? t.user.email}</span>
                      </div>
                      <span style={{ width: 110, textAlign: 'right' }}><span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span></span>
                      <span style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
                        {t.assignee ? (
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }} title={t.assignee.name}>
                            {initials(t.assignee.name, '')}
                          </div>
                        ) : (
                          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '1px dashed var(--d-border)', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>?</div>
                        )}
                      </span>
                      <span style={{ width: 52, fontSize: 11, color: 'var(--d-text-4)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{timeAgo(t.updatedAt)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Preview panel */}
          {selected && (
            <TicketPreviewPanel
              ticket={selected}
              token={token}
              agent={agent}
              onRefresh={loadTickets}
            />
          )}
        </div>
      </main>
    </div>
  )
}
