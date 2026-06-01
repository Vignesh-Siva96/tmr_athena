'use client'
import { useEffect, useState, useMemo, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { EmailNotConfiguredGate } from '@/components/dashboard/EmailNotConfiguredGate'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { buildDomainGroups } from '@/lib/groupTicketsByDomain'
import { api } from '@/lib/api'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
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
  isBulk?: boolean
  dismissedAt?: string | null
  dismissedBy?: { id: string; name: string } | null
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
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const offsetRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [acting, setActing] = useState<Record<string, 'converting' | 'discarding'>>({})
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('bridge.tickets.expandedDomains')
      return new Set(stored ? (JSON.parse(stored) as string[]) : [])
    } catch { return new Set() }
  })
  const [showAllDomains, setShowAllDomains] = useState<Set<string>>(new Set())

  const view = (searchParams.get('view') ?? 'inbox') as 'inbox' | 'tickets'
  const statusFilter = searchParams.get('status') ?? ''
  const categoryFilter = searchParams.get('category') ?? ''
  const searchQuery = searchParams.get('search') ?? ''

  const [searchInput, setSearchInput] = useState(searchQuery)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buildParams = useCallback((overrides?: Partial<{ view: string; status: string; category: string; search: string }>) => {
    const p = new URLSearchParams()
    const v = overrides?.view ?? view
    if (v && v !== 'inbox') p.set('view', v)
    const s = overrides && 'status' in overrides ? overrides.status : statusFilter
    if (s) p.set('status', s)
    const c = overrides && 'category' in overrides ? overrides.category : categoryFilter
    if (c) p.set('category', c)
    const q = overrides && 'search' in overrides ? overrides.search : searchInput.trim()
    if (q) p.set('search', q)
    return p.toString()
  }, [view, statusFilter, categoryFilter, searchInput])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const qs = buildParams({ search: searchInput.trim() })
      router.push(`/inbox${qs ? '?' + qs : ''}`)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const groups = useMemo(() => buildDomainGroups(tickets), [tickets])

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadTickets = useCallback((opts: { background?: boolean; append?: boolean } = {}) => {
    if (!token) return
    const { background = false, append = false } = opts

    if (!background && !append) {
      setIsLoading(true)
      offsetRef.current = 0
    }

    const offset = append ? offsetRef.current : 0
    const params = new URLSearchParams({ limit: '100', offset: String(offset), view, sortBy: 'updatedAt', sortOrder: 'desc' })
    if (statusFilter) params.set('status', statusFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (searchQuery) params.set('search', searchQuery)

    api.get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => {
        setTotal(res.meta.total)
        if (background) {
          // Silently merge: upsert existing, prepend genuinely new tickets
          setTickets((prev) => {
            const prevMap = new Map(prev.map((t) => [t.id, t]))
            for (const t of res.data) prevMap.set(t.id, t)
            return [...prevMap.values()].sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
            )
          })
        } else if (append) {
          offsetRef.current += res.data.length
          setTickets((prev) => {
            const existingIds = new Set(prev.map((t) => t.id))
            return [...prev, ...res.data.filter((t) => !existingIds.has(t.id))]
          })
        } else {
          // Full reset — auto-expand domains with new tickets in inbox view
          offsetRef.current = res.data.length
          setTickets(res.data)
          if (view === 'inbox') {
            const domainsWithNew = new Set<string>()
            for (const t of res.data) {
              if (t.status === 'NEW') {
                const domain = t.user.email.split('@')[1]?.toLowerCase() ?? 'unknown'
                domainsWithNew.add(domain)
              }
            }
            // Also expand the top domain (most recently active)
            const topDomain = res.data[0]?.user.email.split('@')[1]?.toLowerCase()
            if (topDomain) domainsWithNew.add(topDomain)
            if (domainsWithNew.size > 0) {
              setExpandedDomains((prev) => {
                const next = new Set(prev)
                domainsWithNew.forEach((d) => next.add(d))
                return next
              })
            }
          }
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!background && !append) setIsLoading(false)
        if (append) setIsLoadingMore(false)
      })
  }, [token, view, statusFilter, categoryFilter, searchQuery])

  useEffect(() => { loadTickets() }, [loadTickets])

  // Silent background refresh every 15s — no loading flash
  useEffect(() => {
    if (!token) return
    const tick = () => { if (document.visibilityState === 'visible') loadTickets({ background: true }) }
    const interval = setInterval(tick, 15000)
    return () => clearInterval(interval)
  }, [loadTickets, token])

  // Infinite scroll: load next page when the sentinel enters the viewport
  const hasMore = tickets.length < total
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoadingMore) {
          setIsLoadingMore(true)
          loadTickets({ append: true })
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, loadTickets])

  const handleConvert = async (ticketId: string) => {
    if (!token) return
    setActing((prev) => ({ ...prev, [ticketId]: 'converting' }))
    // Optimistic update: flip to OPEN in place so the row transforms smoothly
    setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: 'OPEN' as TicketStatus } : t))
    try {
      await api.post(`/tickets/${ticketId}/convert`, {}, token)
    } catch (err) {
      // Revert on failure
      setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: 'NEW' as TicketStatus } : t))
      console.error(err)
    }
    finally { setActing((prev) => { const next = { ...prev }; delete next[ticketId]; return next }) }
  }

  const handleDiscard = async (ticketId: string) => {
    if (!token) return
    setActing((prev) => ({ ...prev, [ticketId]: 'discarding' }))
    try {
      await api.post(`/tickets/${ticketId}/discard`, {}, token)
      loadTickets()
    } catch (err) { console.error(err) }
    finally { setActing((prev) => { const next = { ...prev }; delete next[ticketId]; return next }) }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ padding: '0 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          {/* Title row */}
          <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)' }}>
                {view === 'inbox' ? 'Inbox' : 'Tickets'}
              </h1>
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
                  const qs = buildParams({ status: e.target.value })
                  router.push(`/inbox${qs ? '?' + qs : ''}`)
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
                  const qs = buildParams({ category: e.target.value })
                  router.push(`/inbox${qs ? '?' + qs : ''}`)
                }}
                  style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: categoryFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                  <option value="">All categories</option>
                  {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
              </div>
              {(statusFilter || categoryFilter) && (
                <button type="button" onClick={() => router.push(`/inbox${view !== 'inbox' ? '?view=' + view : ''}`)}
                  style={{ height: 30, padding: '0 10px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Tab strip */}
          <div style={{ display: 'flex', gap: 0 }}>
            {([
              { key: 'inbox' as const, label: 'Inbox' },
              { key: 'tickets' as const, label: 'Tickets' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  const qs = buildParams({ view: key })
                  router.push(`/inbox${qs ? '?' + qs : ''}`)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: view === key ? 600 : 400, fontFamily: 'inherit',
                  color: view === key ? 'var(--d-text)' : 'var(--d-text-4)',
                  borderBottom: view === key ? '2px solid var(--d-accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            ))}
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
                  {view === 'inbox' ? 'No inbound emails.' : 'No tickets found.'}
                </div>
              ) : (
                <>
                {groups.map((group) => {
                  const expanded = expandedDomains.has(group.domain)
                  const showAll = showAllDomains.has(group.domain)
                  const visibleTickets = expanded ? (showAll ? group.tickets : group.tickets.slice(0, PREVIEW_COUNT)) : []
                  const hiddenCount = group.tickets.length - PREVIEW_COUNT

                  return (
                    <div key={group.domain} style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                      {/* Domain card header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: expanded ? '1px solid var(--d-border-2)' : 'none' }}>
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
                              {group.newCount > 0 && (
                                <><span>·</span><span style={{ color: '#FCA5A5', fontWeight: 600 }}>{group.newCount} new</span></>
                              )}
                              {group.openCount > 0 && (
                                <><span>·</span><span style={{ color: 'var(--d-accent)', fontWeight: 500 }}>{group.openCount} open</span></>
                              )}
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--d-text-4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeAgo(group.lastActivity)}</span>
                        <button
                          type="button"
                          onClick={() => toggleDomain(group.domain)}
                          title={expanded ? 'Collapse' : 'Expand'}
                          style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--d-border)', background: expanded ? 'var(--d-raised)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--d-text-3)', transition: 'background 100ms, border-color 100ms' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--d-raised)'; e.currentTarget.style.borderColor = 'var(--d-border-2)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = expanded ? 'var(--d-raised)' : 'transparent'; e.currentTarget.style.borderColor = 'var(--d-border)' }}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </div>

                      {/* Ticket rows */}
                      {visibleTickets.map((t, idx) => {
                        const isLast = idx === visibleTickets.length - 1 && (!showAll || hiddenCount <= 0)
                        const isNew = t.status === 'NEW'
                        const isDismissed = t.status === 'DISMISSED'
                        const isActing = !!acting[t.id]
                        return (
                          <div key={t.id}
                            onClick={() => !isDismissed && router.push(`/tickets/${t.id}`)}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', minHeight: 48, borderBottom: isLast ? 'none' : '1px solid var(--d-border-2)', cursor: isDismissed ? 'default' : 'pointer', background: 'transparent', transition: 'background 80ms', opacity: isActing ? 0.6 : 1 }}
                          >
                            <span style={{ width: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLOR[t.priority], display: 'block' }} /></span>
                            <span className="mono" style={{ width: 76, fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', flexShrink: 0 }}>{t.displayId}</span>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                              {t.hasUnreadReply && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                              <span style={{ fontSize: 14, fontWeight: t.hasUnreadReply ? 600 : 500, color: isDismissed ? 'var(--d-text-4)' : t.hasUnreadReply ? 'var(--d-text)' : 'var(--d-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDismissed ? 'line-through' : 'none' }}>
                                {t.title}
                              </span>
                              <CategoryPill category={t.category} size="xs" />
                              {t.isBulk && (
                                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: 'var(--d-warning)', border: '1px solid rgba(245,158,11,0.3)', flexShrink: 0 }}>
                                  Promotional
                                </span>
                              )}
                              {isDismissed && t.dismissedAt && (
                                <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                  {t.dismissedBy ? `Dismissed by ${t.dismissedBy.name}` : 'Auto-filtered'} · {timeAgo(t.dismissedAt)}
                                </span>
                              )}
                            </div>
                            {/* Status pill */}
                            <span style={{ width: 100, textAlign: 'right', flexShrink: 0 }}>
                              <span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span>
                            </span>
                            {/* Assignee or inline NEW actions */}
                            {isNew ? (
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={() => void handleConvert(t.id)}
                                  style={{ height: 26, padding: '0 10px', borderRadius: 'var(--r-sm)', background: 'rgba(34,197,94,0.1)', color: 'var(--d-success)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 11, fontWeight: 600, cursor: isActing ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >
                                  {acting[t.id] === 'converting' ? 'Converting…' : '✓ Convert to Ticket'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isActing}
                                  onClick={() => void handleDiscard(t.id)}
                                  style={{ height: 26, padding: '0 10px', borderRadius: 'var(--r-sm)', background: 'transparent', color: 'var(--d-text-4)', border: '1px solid var(--d-border)', fontSize: 11, fontWeight: 500, cursor: isActing ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                                >
                                  {acting[t.id] === 'discarding' ? 'Dismissing…' : 'Dismiss'}
                                </button>
                              </div>
                            ) : (
                              <span style={{ width: 72, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                                {t.assignee ? (
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }} title={t.assignee.name}>
                                    {initials(t.assignee.name, '')}
                                  </div>
                                ) : (
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: '1px dashed var(--d-border)', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>–</div>
                                )}
                              </span>
                            )}
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
                })}

                {/* Infinite scroll sentinel */}
                <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />

                {/* Footer: progress counter + loading indicator */}
                <div style={{ padding: '8px 0 4px', textAlign: 'center', fontSize: 12, color: 'var(--d-text-4)', flexShrink: 0 }}>
                  {isLoadingMore ? (
                    <span>Loading more…</span>
                  ) : (
                    <span>Showing {tickets.length} of {total}</span>
                  )}
                </div>
                </>
              )}
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  )
}
