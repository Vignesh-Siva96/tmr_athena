'use client'
import { useEffect, useState, useMemo, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { EmailNotConfiguredGate } from '@/components/dashboard/EmailNotConfiguredGate'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { buildDomainGroups } from '@/lib/groupTicketsByDomain'
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

function DomainFavicon({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false)
  const abbr = domain.slice(0, 2).toUpperCase()
  return (
    <div style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--d-border)', background: 'var(--d-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
      {errored ? (
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text-3)' }}>{abbr}</span>
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          onError={() => setErrored(true)}
          style={{ width: 20, height: 20 }}
          alt=""
        />
      )}
    </div>
  )
}

const PREVIEW_COUNT = 5

export default function InboxPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--d-bg)' }} />}>
      <InboxInner />
    </Suspense>
  )
}

function InboxInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { agent, token, isLoading: authLoading } = useAuth()
  const { isConnected, isLoading: emailConfigLoading } = useEmailConfig(token)
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('bridge.tickets.expandedDomains')
      return new Set(stored ? (JSON.parse(stored) as string[]) : [])
    } catch { return new Set() }
  })

  const [showAllDomains, setShowAllDomains] = useState<Set<string>>(new Set())

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) { next.delete(domain) } else { next.add(domain) }
      try { localStorage.setItem('bridge.tickets.expandedDomains', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  const toggleShowAll = (domain: string) => {
    setShowAllDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) { next.delete(domain) } else { next.add(domain) }
      return next
    })
  }

  const statusFilter = searchParams.get('status') ?? ''
  const categoryFilter = searchParams.get('category') ?? ''
  const searchQuery = searchParams.get('search') ?? ''

  // Local search input state — debounced into URL
  const [searchInput, setSearchInput] = useState(searchQuery)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const p = new URLSearchParams()
      if (statusFilter) p.set('status', statusFilter)
      if (categoryFilter) p.set('category', categoryFilter)
      if (searchInput.trim()) p.set('search', searchInput.trim())
      router.push(`/inbox${p.toString() ? '?' + p.toString() : ''}`)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => buildDomainGroups(tickets), [tickets])

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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)' }}>Inbox</h1>
            <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>{isLoading ? '…' : `${total} total`}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Search */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--d-text-4)', pointerEvents: 'none' }} />
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearchInput(''); searchRef.current?.blur() } }}
                placeholder="Search…"
                style={{ height: 30, padding: '0 28px 0 28px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text)', fontFamily: 'inherit', outline: 'none', width: 180 }}
              />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput('')}
                  style={{ position: 'absolute', right: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--d-text-4)', display: 'flex', padding: 0 }}>
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Status filter */}
            <div style={{ position: 'relative' }}>
              <select value={statusFilter} onChange={(e) => {
                const p = new URLSearchParams()
                if (e.target.value) p.set('status', e.target.value)
                if (categoryFilter) p.set('category', categoryFilter)
                if (searchQuery) p.set('search', searchQuery)
                router.push(`/inbox${p.toString() ? '?' + p.toString() : ''}`)
              }}
                style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: statusFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
            </div>
            {/* Category filter */}
            <div style={{ position: 'relative' }}>
              <select value={categoryFilter} onChange={(e) => {
                const p = new URLSearchParams()
                if (statusFilter) p.set('status', statusFilter)
                if (e.target.value) p.set('category', e.target.value)
                if (searchQuery) p.set('search', searchQuery)
                router.push(`/inbox${p.toString() ? '?' + p.toString() : ''}`)
              }}
                style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: categoryFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                <option value="">All categories</option>
                {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
            </div>
            {/* Clear filters */}
            {(statusFilter || categoryFilter) && (
              <button type="button" onClick={() => router.push('/inbox')}
                style={{ height: 30, padding: '0 10px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear
              </button>
            )}
          </div>
        </header>

        {!emailConfigLoading && !isConnected ? (
          <EmailNotConfiguredGate />
        ) : (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Domain card list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {isLoading ? (
                [...Array(5)].map((_, i) => <div key={i} className="shimmer" style={{ height: 64, borderRadius: 12 }} />)
              ) : tickets.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%', color: 'var(--d-text-3)', fontSize: 14 }}>
                  No tickets found.
                </div>
              ) : (
                groups.map((group) => {
                  const expanded = expandedDomains.has(group.domain)
                  const showAll = showAllDomains.has(group.domain)
                  const visibleTickets = expanded ? (showAll ? group.tickets : group.tickets.slice(0, PREVIEW_COUNT)) : []
                  const hiddenCount = group.tickets.length - PREVIEW_COUNT

                  return (
                    <div key={group.domain} style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                      {/* Domain card header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: expanded ? '1px solid var(--d-border-2)' : 'none' }}>
                        {/* Left: favicon + text → filter link */}
                        <div
                          onClick={() => router.push(`/tickets/domain/${encodeURIComponent(group.domain)}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer', userSelect: 'none' }}
                        >
                          <DomainFavicon domain={group.domain} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                              {group.domain}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{group.tickets.length} {group.tickets.length === 1 ? 'ticket' : 'tickets'}</span>
                              {group.openCount > 0 && (
                                <><span>·</span><span style={{ color: 'var(--d-accent)', fontWeight: 500 }}>{group.openCount} open</span></>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* Right: timestamp + chevron toggle */}
                        <span style={{ fontSize: 12, color: 'var(--d-text-4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeAgo(group.lastActivity)}</span>
                        <button
                          type="button"
                          onClick={() => toggleDomain(group.domain)}
                          title={expanded ? 'Collapse' : 'Expand'}
                          style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--d-border)', background: expanded ? 'var(--d-raised)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--d-text-3)', transition: 'background 100ms, border-color 100ms' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--d-raised)'; e.currentTarget.style.borderColor = 'var(--d-border-2)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = expanded ? 'var(--d-raised)' : 'transparent'; e.currentTarget.style.borderColor = 'var(--d-border)' }}
                        >
                          {expanded
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />
                          }
                        </button>
                      </div>

                      {/* Ticket rows */}
                      {visibleTickets.map((t, idx) => {
                        const isLast = idx === visibleTickets.length - 1 && (!showAll || hiddenCount <= 0)
                        return (
                          <div key={t.id} onClick={() => router.push(`/tickets/${t.id}`)}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48, borderBottom: isLast ? 'none' : '1px solid var(--d-border-2)', cursor: 'pointer', background: 'transparent', transition: 'background 80ms' }}
                          >
                            <span style={{ width: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLOR[t.priority], display: 'block' }} /></span>
                            <span className="mono" style={{ width: 76, fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', flexShrink: 0 }}>{t.displayId}</span>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                              {t.hasUnreadReply && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                              <span style={{ fontSize: 14, fontWeight: t.hasUnreadReply ? 600 : 500, color: t.hasUnreadReply ? 'var(--d-text)' : 'var(--d-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                              <CategoryPill category={t.category} size="xs" />
                            </div>
                            <span style={{ width: 100, textAlign: 'right', flexShrink: 0 }}><span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span></span>
                            <span style={{ width: 72, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                              {t.assignee ? (
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }} title={t.assignee.name}>
                                  {initials(t.assignee.name, '')}
                                </div>
                              ) : (
                                <div style={{ width: 22, height: 22, borderRadius: '50%', border: '1px dashed var(--d-border)', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>–</div>
                              )}
                            </span>
                            <span style={{ width: 44, fontSize: 11, color: 'var(--d-text-4)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeAgo(t.updatedAt)}</span>
                          </div>
                        )
                      })}

                      {/* Show more / show less footer */}
                      {expanded && hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleShowAll(group.domain) }}
                          style={{ width: '100%', padding: '9px 16px', fontSize: 12, fontWeight: 500, color: 'var(--d-accent)', background: 'var(--d-raised)', border: 'none', borderTop: '1px solid var(--d-border-2)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                        >
                          {showAll ? `↑ Show fewer` : `Show ${hiddenCount} more →`}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

        </div>
        )}
      </main>
    </div>
  )
}
