'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Plus, ChevronRight, Clock } from 'lucide-react'
import { PortalNav } from '@/components/portal/PortalNav'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

interface TicketListItem {
  id: string
  number: number
  displayId: string
  title: string
  status: TicketStatus
  category: TicketCategory
  connector?: string | null
  product?: string | null
  tags: { id: string; name: string; color: string }[]
  lastMessage?: { body: string; createdAt: string } | null
  hasUnreadReply: boolean
  updatedAt: string
}

interface TicketsResponse {
  data: TicketListItem[]
  meta: { total: number; limit: number; offset: number }
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

const STATUS_STYLES: Record<TicketStatus, { color: string; bg: string }> = {
  OPEN: { color: '#1D4ED8', bg: '#EFF6FF' },
  IN_PROGRESS: { color: '#B45309', bg: '#FFFBEB' },
  WAITING: { color: '#7C3AED', bg: '#F5F3FF' },
  RESOLVED: { color: '#15803D', bg: '#F0FDF4' },
  CLOSED: { color: '#52525B', bg: '#F4F4F5' },
}

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  BUG_REPORT: 'Bug Report',
  FEATURE_REQUEST: 'Feature Request',
  QUESTION: 'Question',
  BILLING: 'Billing',
  OTHER: 'Other',
}

const CATEGORY_STYLES: Record<TicketCategory, { color: string; bg: string }> = {
  BUG_REPORT: { color: '#991B1B', bg: '#FEF2F2' },
  FEATURE_REQUEST: { color: '#166534', bg: '#F0FDF4' },
  QUESTION: { color: '#1E40AF', bg: '#EFF6FF' },
  BILLING: { color: '#92400E', bg: '#FFFBEB' },
  OTHER: { color: '#3F3F46', bg: '#F4F4F5' },
}

const FILTER_TABS: { key: TicketStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'WAITING', label: 'Waiting' },
  { key: 'RESOLVED', label: 'Resolved' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function MyTicketsPage() {
  const router = useRouter()
  const { user, token, isLoading: authLoading } = useAuth()
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [allTickets, setAllTickets] = useState<TicketListItem[]>([])
  const [meta, setMeta] = useState({ total: 0, limit: 25, offset: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<TicketStatus | 'ALL'>('ALL')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth')
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!token) return
    api.get<TicketsResponse>('/tickets?limit=100', token)
      .then((res) => setAllTickets(res.data))
      .catch(console.error)
  }, [token])

  useEffect(() => {
    if (!token) return
    setIsLoading(true)
    const params = new URLSearchParams()
    if (activeFilter !== 'ALL') params.set('status', activeFilter)
    if (search) params.set('search', search)
    api
      .get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => {
        setTickets(res.data)
        setMeta(res.meta)
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [token, activeFilter, search])

  const openCount = allTickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length
  const resolvedCount = allTickets.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status)).length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
      <PortalNav />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0, color: 'var(--p-text)', fontFamily: 'var(--font-display)' }}>
              My tickets
            </h1>
            <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginTop: 6 }}>
              {openCount} open · {resolvedCount} resolved
            </p>
          </div>
          <Link
            href="/submit"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 38,
              padding: '0 16px',
              background: 'var(--p-accent)',
              color: '#fff',
              borderRadius: 'var(--r-sm)',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              marginTop: 8,
            }}
          >
            <Plus size={15} /> New ticket
          </Link>
        </div>

        {/* Filters + search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0 0', borderBottom: '1px solid var(--p-border)' }}>
          <div style={{ display: 'flex', gap: 0, flex: 1 }}>
            {FILTER_TABS.map((tab) => {
              const count = tab.key === 'ALL' ? allTickets.length : allTickets.filter((t) => t.status === tab.key).length
              const isActive = activeFilter === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveFilter(tab.key)}
                  style={{
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--p-text)' : 'var(--p-text-3)',
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--p-accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: isActive ? 'var(--p-accent-bg)' : 'var(--p-surface)',
                    color: isActive ? 'var(--p-accent)' : 'var(--p-text-4)',
                  }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--p-text-4)' }} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              style={{
                height: 34,
                padding: '0 12px 0 32px',
                border: '1px solid var(--p-border)',
                borderRadius: 'var(--r-sm)',
                fontSize: 13,
                color: 'var(--p-text)',
                background: '#fff',
                outline: 'none',
                width: 200,
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Ticket list */}
        <div style={{ marginTop: 0 }}>
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="shimmer" style={{ height: 68, borderRadius: 'var(--r-md)', marginTop: 8 }} />
            ))
          ) : tickets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 0' }}>
              <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--p-text-2)', marginBottom: 12 }}>
                {search ? 'No tickets match your search.' : activeFilter !== 'ALL' ? `No ${STATUS_LABELS[activeFilter as TicketStatus]} tickets.` : 'No tickets yet.'}
              </p>
              {!search && activeFilter === 'ALL' && (
                <Link href="/submit" style={{ fontSize: 14, color: 'var(--p-accent)', textDecoration: 'none', fontWeight: 500 }}>
                  Submit your first ticket →
                </Link>
              )}
              {(search || activeFilter !== 'ALL') && (
                <button type="button" onClick={() => { setSearch(''); setActiveFilter('ALL') }} style={{ fontSize: 13, color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  View all tickets
                </button>
              )}
            </div>
          ) : (
            tickets.map((ticket) => {
              const statusStyle = STATUS_STYLES[ticket.status]
              const catStyle = CATEGORY_STYLES[ticket.category]
              return (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 0',
                    borderBottom: '1px solid var(--p-border-2)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {/* Status badge */}
                  <div style={{ width: 130, flexShrink: 0 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusStyle.color,
                      background: statusStyle.bg,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusStyle.color }} />
                      {STATUS_LABELS[ticket.status]}
                    </span>
                  </div>

                  {/* ID */}
                  <span className="mono" style={{ fontSize: 12, color: 'var(--p-text-4)', width: 80, flexShrink: 0 }}>
                    {ticket.displayId}
                  </span>

                  {/* Title + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {ticket.hasUnreadReply && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--p-accent)', flexShrink: 0 }} />
                      )}
                      <span style={{
                        fontSize: 14,
                        fontWeight: ticket.hasUnreadReply ? 600 : 500,
                        color: 'var(--p-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {ticket.title}
                      </span>
                    </div>
                    {(ticket.product ?? ticket.connector) && (
                      <p style={{ fontSize: 12, color: 'var(--p-text-4)', margin: '2px 0 0' }}>
                        {[ticket.product, ticket.connector].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>

                  {/* Category tag */}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 7px',
                    borderRadius: 4,
                    color: catStyle.color,
                    background: catStyle.bg,
                    flexShrink: 0,
                  }}>
                    {CATEGORY_LABELS[ticket.category]}
                  </span>

                  {/* Time */}
                  <span style={{ fontSize: 12, color: 'var(--p-text-4)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} />
                    {timeAgo(ticket.updatedAt)}
                  </span>

                  <ChevronRight size={16} style={{ color: 'var(--p-text-4)', flexShrink: 0 }} />
                </Link>
              )
            })
          )}
        </div>

        {/* Footer */}
        {!isLoading && tickets.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--p-border-2)' }}>
            <span style={{ fontSize: 13, color: 'var(--p-text-4)' }}>
              Showing {tickets.length} of {meta.total} tickets
            </span>
            <button type="button" style={{ fontSize: 13, color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              Export as CSV
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
