'use client'
import { useEffect, useState, useMemo, useRef, useCallback, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_LABEL, UserCategoryBadge } from '@/components/dashboard/TicketPreviewPanel'
import { EmailNotConfiguredGate } from '@/components/dashboard/EmailNotConfiguredGate'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { buildDomainGroups } from '@/lib/groupTicketsByDomain'
import type { UserCategory } from '@/lib/groupTicketsByDomain'
import { api } from '@/lib/api'
import { sseEventBus } from '@/lib/sseEventBus'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

interface TicketUser { id: string; name: string | null; email: string; category?: UserCategory }
interface Assignee { id: string; name: string; avatarUrl: string | null }
interface Tag { id: string; name: string; color: string }

interface TicketListItem {
  id: string; ref: string; displayId: string; isTicket: boolean; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  field2?: string | null; assignee?: Assignee | null; user: TicketUser
  tags?: Tag[]
  hasUnreadReply: boolean; updatedAt: string
  lastMessage?: { body: string; createdAt: string } | null
  dismissedAt?: string | null
  dismissedBy?: { id: string; name: string } | null
}

interface TicketsResponse { data: TicketListItem[]; meta: { total: number } }

const PREVIEW_COUNT = 5

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

export default function InboxPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--d-bg)' }} />}>
      <InboxInner />
    </Suspense>
  )
}

function InboxInner() {
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const { isConnected, isLoading: emailConfigLoading } = useEmailConfig(token)
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const offsetRef = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Single-level expand state: domains only
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('bridge.inbox.expandedDomains')
      return new Set(stored ? (JSON.parse(stored) as string[]) : [])
    } catch { return new Set() }
  })
  const [showAllDomains, setShowAllDomains] = useState<Set<string>>(new Set())

  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchInput])

  const groups = useMemo(() => buildDomainGroups(tickets.filter((t) => t.status !== 'DISMISSED')), [tickets])

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) { next.delete(domain) } else { next.add(domain) }
      try { localStorage.setItem('bridge.inbox.expandedDomains', JSON.stringify([...next])) } catch { /* ignore */ }
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

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadTickets = useCallback((opts: { background?: boolean; append?: boolean } = {}) => {
    if (!token) return
    const { background = false, append = false } = opts

    if (!background && !append) {
      setIsLoading(true)
      offsetRef.current = 0
    }

    const offset = append ? offsetRef.current : 0
    const params = new URLSearchParams({ limit: '100', offset: String(offset), sortBy: 'updatedAt', sortOrder: 'desc' })
    if (statusFilter) params.set('status', statusFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (tagFilter) params.set('tagIds', tagFilter)
    if (debouncedSearch) params.set('search', debouncedSearch)

    api.get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => {
        setTotal(res.meta.total)
        if (background) {
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
          offsetRef.current = res.data.length
          setTickets(res.data)
          // Auto-expand domains containing NEW items + the top (most-recent) domain
          const newDomains = new Set<string>()
          for (const t of res.data) {
            if (t.status === 'NEW') {
              newDomains.add(t.user.email.split('@')[1]?.toLowerCase() ?? 'unknown')
            }
          }
          const top = res.data[0]
          if (top) newDomains.add(top.user.email.split('@')[1]?.toLowerCase() ?? 'unknown')
          if (newDomains.size > 0) {
            setExpandedDomains((prev) => {
              const next = new Set(prev)
              newDomains.forEach((d) => next.add(d))
              return next
            })
          }
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!background && !append) setIsLoading(false)
        if (append) setIsLoadingMore(false)
      })
  }, [token, statusFilter, categoryFilter, tagFilter, debouncedSearch])

  useEffect(() => {
    if (!token) return
    api.get<{ data: Tag[] }>('/tags', token).then((res) => setAvailableTags(res.data)).catch(() => {})
  }, [token])

  useEffect(() => { loadTickets() }, [loadTickets])

  // Fallback poll every 60s (primary signal is SSE below; poll catches silently-dropped connections)
  useEffect(() => {
    if (!token) return
    const tick = () => { if (document.visibilityState === 'visible') loadTickets({ background: true }) }
    const interval = setInterval(tick, 60000)
    return () => clearInterval(interval)
  }, [loadTickets, token])

  // SSE-driven refresh: debounce bursts so a rapid sequence of messages fires only one refetch
  useEffect(() => {
    if (!token) return
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const trigger = () => {
      if (!document.visibilityState || document.visibilityState === 'visible') {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => loadTickets({ background: true }), 300)
      }
    }
    const unsubCreated = sseEventBus.on('ticket-created', trigger)
    const unsubUpdated = sseEventBus.on('ticket-updated', trigger)
    const unsubMessage = sseEventBus.on('message-created', trigger)
    const onVisible = () => { if (document.visibilityState === 'visible') loadTickets({ background: true }) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      unsubCreated()
      unsubUpdated()
      unsubMessage()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadTickets, token])

  // Infinite scroll
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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ padding: '0 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: statusFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                  <option value="">All statuses</option>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
              </div>
              {/* Category filter */}
              <div style={{ position: 'relative' }}>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: categoryFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                  <option value="">All categories</option>
                  {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
              </div>
              {/* Tag filter */}
              {availableTags.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}
                    style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: tagFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                    <option value="">All tags</option>
                    {availableTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
                </div>
              )}
              {(statusFilter || categoryFilter || tagFilter) && (
                <button type="button" onClick={() => { setStatusFilter(''); setCategoryFilter(''); setTagFilter('') }}
                  style={{ height: 30, padding: '0 10px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Clear
                </button>
              )}
            </div>
          </div>
        </header>

        {!emailConfigLoading && !isConnected ? (
          <EmailNotConfiguredGate />
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {isLoading ? (
              [...Array(5)].map((_, i) => <div key={i} className="shimmer" style={{ height: 64, borderRadius: 12 }} />)
            ) : groups.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%', color: 'var(--d-text-3)', fontSize: 14 }}>
                No emails yet.
              </div>
            ) : (
              <>
                {groups.map((domainGroup) => {
                  const domainExpanded = expandedDomains.has(domainGroup.domain)
                  const showAll = showAllDomains.has(domainGroup.domain)
                  const visibleConvos = domainExpanded
                    ? (showAll ? domainGroup.tickets : domainGroup.tickets.slice(0, PREVIEW_COUNT))
                    : []
                  const hiddenCount = domainGroup.tickets.length - PREVIEW_COUNT

                  return (
                    <div key={domainGroup.domain} style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
                      {/* Domain header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: domainExpanded ? '1px solid var(--d-border-2)' : 'none' }}>
                        <div
                          onClick={() => router.push(`/tickets/domain/${encodeURIComponent(domainGroup.domain)}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer', userSelect: 'none' }}
                        >
                          <DomainFavicon domain={domainGroup.domain} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                              {domainGroup.domain}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{domainGroup.tickets.length} {domainGroup.tickets.length === 1 ? 'conversation' : 'conversations'}</span>
                              {domainGroup.newCount > 0 && (
                                <><span>·</span><span style={{ color: '#FCA5A5', fontWeight: 600 }}>{domainGroup.newCount} new</span></>
                              )}
                              {domainGroup.openCount > 0 && (
                                <><span>·</span><span style={{ color: 'var(--d-accent)', fontWeight: 500 }}>{domainGroup.openCount} open</span></>
                              )}
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--d-text-4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeAgo(domainGroup.lastActivity)}</span>
                        <button type="button" onClick={() => toggleDomain(domainGroup.domain)} title={domainExpanded ? 'Collapse' : 'Expand'}
                          style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--d-border)', background: domainExpanded ? 'var(--d-raised)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'var(--d-text-3)', transition: 'background 100ms' }}>
                          {domainExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </div>

                      {/* Conversation blocks — one self-contained two-line block per conversation */}
                      {visibleConvos.map((t, idx) => {
                        const isNew = t.status === 'NEW'
                        const unread = isNew || t.hasUnreadReply
                        const cat = t.user.category ?? 'CUSTOMER'
                        return (
                          <div key={t.id}
                            data-testid="inbox-row"
                            data-title={t.title}
                            data-ticket-id={t.id}
                            onClick={() => router.push(`/tickets/${t.id}`)}
                            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', cursor: 'pointer', background: 'transparent', transition: 'background 80ms', borderTop: idx > 0 ? '1px solid var(--d-border-2)' : 'none' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--d-raised)' }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                          >
                            {/* Avatar */}
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                              {initials(t.user.name, t.user.email)}
                            </div>

                            {/* Content — sender line on top, subject below */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                                  {t.user.name ?? t.user.email}
                                </span>
                                {t.user.name && <span style={{ fontSize: 11, color: 'var(--d-text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 2 }}>{t.user.email}</span>}
                                {(cat === 'PROMOTIONAL' || cat === 'MARKETING') && <UserCategoryBadge category={cat} />}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                {unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                                <span style={{ fontSize: 13, fontWeight: 400, color: unread ? 'var(--d-text-2)' : 'var(--d-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.title}
                                </span>
                                <CategoryPill category={t.category} size="xs" />
                                {t.tags && t.tags.map((tag) => (
                                  <span key={tag.id} style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, color: tag.color, background: `${tag.color}20`, border: `1px solid ${tag.color}40`, flexShrink: 0 }}>{tag.name}</span>
                                ))}
                                {t.isTicket && (
                                  <span data-testid="ticket-ref" className="mono" style={{ fontSize: 11, fontWeight: 500, color: 'var(--d-text-4)', flexShrink: 0 }}>{t.displayId}</span>
                                )}
                              </div>
                            </div>

                            {/* Right meta — slots collapse when empty */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 1 }}>
                              {t.isTicket && (
                                <span data-testid="status-pill" className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span>
                              )}
                              {t.assignee && (
                                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }} title={t.assignee.name}>
                                  {initials(t.assignee.name, '')}
                                </div>
                              )}
                              <span style={{ minWidth: 36, fontSize: 11, color: 'var(--d-text-4)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{timeAgo(t.updatedAt)}</span>
                            </div>
                          </div>
                        )
                      })}

                      {/* Show more conversations */}
                      {domainExpanded && hiddenCount > 0 && (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); toggleShowAll(domainGroup.domain) }}
                          style={{ width: '100%', padding: '9px 16px', fontSize: 12, fontWeight: 500, color: 'var(--d-accent)', background: 'var(--d-raised)', border: 'none', borderTop: '1px solid var(--d-border-2)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          {showAll ? '↑ Show fewer' : `Show ${hiddenCount} more →`}
                        </button>
                      )}
                    </div>
                  )
                })}

                {/* Infinite scroll sentinel */}
                <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />

                <div style={{ padding: '8px 0 4px', textAlign: 'center', fontSize: 12, color: 'var(--d-text-4)', flexShrink: 0 }}>
                  {isLoadingMore ? <span>Loading more…</span> : <span>Showing {tickets.length} of {total}</span>}
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
