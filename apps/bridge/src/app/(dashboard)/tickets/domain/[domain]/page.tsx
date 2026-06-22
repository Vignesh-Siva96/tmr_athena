'use client'
import { use, useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { CategoryPill, STATUS_CLS, STATUS_LABEL, CAT_LABEL } from '@/components/dashboard/TicketPreviewPanel'
import { EmailNotConfiguredGate } from '@/components/dashboard/EmailNotConfiguredGate'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { api } from '@/lib/api'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

interface TicketUser { id: string; name: string | null; email: string }
interface Assignee { id: string; name: string; avatarUrl: string | null }

interface TicketListItem {
  id: string; ref: string; displayId: string; isTicket: boolean; title: string
  status: TicketStatus; priority: TicketPriority; category: TicketCategory
  field2?: string | null; assignee?: Assignee | null; user: TicketUser
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

function DomainFavicon({ domain, size = 48 }: { domain: string; size?: number }) {
  const [errored, setErrored] = useState(false)
  const abbr = domain.slice(0, 2).toUpperCase()
  const fontSize = size <= 36 ? 13 : 16
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', border: '1px solid var(--d-border)', background: 'var(--d-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
      {errored ? (
        <span style={{ fontSize, fontWeight: 700, color: 'var(--d-text-3)' }}>{abbr}</span>
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          onError={() => setErrored(true)}
          style={{ width: size * 0.55, height: size * 0.55 }}
          alt=""
        />
      )}
    </div>
  )
}

export default function DomainPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = use(params)
  const decodedDomain = decodeURIComponent(domain)
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--d-bg)' }} />}>
      <DomainPageInner domain={decodedDomain} />
    </Suspense>
  )
}

function DomainPageInner({ domain }: { domain: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { agent, token, isLoading: authLoading } = useAuth()
  const { isConnected, isLoading: emailConfigLoading } = useEmailConfig(token)

  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const statusFilter = searchParams.get('status') ?? ''

  useEffect(() => { if (!authLoading && !agent) router.push('/auth') }, [authLoading, agent, router])

  const loadTickets = () => {
    if (!token) return
    setIsLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (statusFilter) params.set('status', statusFilter)
    params.set('search', `@${domain}`)
    api.get<TicketsResponse>(`/tickets?${params.toString()}`, token)
      .then((res) => {
        // Server search matches on email substring; narrow to exact domain match client-side
        const domainTickets = res.data.filter((t) => {
          const parts = t.user.email.split('@')
          return parts.length === 2 && parts[1]!.toLowerCase() === domain.toLowerCase()
        })
        setTickets(domainTickets)
        setTotal(domainTickets.length)
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }

  useEffect(() => { loadTickets() }, [token, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return
    const tick = () => { if (document.visibilityState === 'visible') loadTickets() }
    const interval = setInterval(tick, 15000)
    return () => clearInterval(interval)
  }, [token, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const openCount = tickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length

  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Domain hero header */}
        <header style={{ flexShrink: 0, borderBottom: '1px solid var(--d-border)', background: 'var(--d-surface)' }}>
          {/* Back nav */}
          <div style={{ padding: '10px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => router.push('/inbox')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 6, fontSize: 12, color: 'var(--d-text-3)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <ArrowLeft size={12} /> Inbox
            </button>
          </div>

          {/* Domain identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px 16px' }}>
            <DomainFavicon domain={domain} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {domain}
              </h1>
              <div style={{ fontSize: 13, color: 'var(--d-text-4)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{isLoading ? '…' : `${total} ticket${total !== 1 ? 's' : ''}`}</span>
                {openCount > 0 && <><span style={{ color: 'var(--d-border)' }}>·</span><span style={{ color: 'var(--d-accent)', fontWeight: 500 }}>{openCount} open</span></>}
              </div>
            </div>

            {/* Status filter */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select
                value={statusFilter}
                onChange={(e) => {
                  const p = new URLSearchParams()
                  if (e.target.value) p.set('status', e.target.value)
                  router.push(`/tickets/domain/${encodeURIComponent(domain)}${p.toString() ? '?' + p.toString() : ''}`)
                }}
                style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
            </div>
          </div>
        </header>

        {!emailConfigLoading && !isConnected ? (
          <EmailNotConfiguredGate />
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Ticket list */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 36, borderBottom: '1px solid var(--d-border)', background: 'var(--d-raised)', flexShrink: 0 }}>
                <span style={{ width: 8 }} />
                <span className="mono" style={{ width: 76, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ID</span>
                <span style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Subject</span>
                <span style={{ width: 100, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Status</span>
                <span style={{ width: 72, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Agent</span>
                <span style={{ width: 44, fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right' }}>Last</span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {isLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {[...Array(6)].map((_, i) => <div key={i} className="shimmer" style={{ height: 52, margin: '1px 0' }} />)}
                  </div>
                ) : tickets.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 8 }}>
                    <span style={{ fontSize: 14, color: 'var(--d-text-3)' }}>No tickets from {domain}</span>
                    {statusFilter && <button type="button" onClick={() => router.push(`/tickets/domain/${encodeURIComponent(domain)}`)} style={{ fontSize: 12, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Clear filter</button>}
                  </div>
                ) : (
                  tickets.map((t) => {
                    return (
                      <div
                        key={t.id}
                        onClick={() => router.push(`/tickets/${t.id}`)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 52, borderBottom: '1px solid var(--d-border-2)', cursor: 'pointer', background: 'transparent', transition: 'background 80ms' }}
                      >
                        <span style={{ width: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLOR[t.priority], display: 'block' }} /></span>
                        <span className="mono" style={{ width: 76, fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', flexShrink: 0 }}>{t.displayId}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {t.hasUnreadReply && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-accent)', flexShrink: 0 }} />}
                            <span style={{ fontSize: 14, fontWeight: t.hasUnreadReply ? 600 : 500, color: t.hasUnreadReply ? 'var(--d-text)' : 'var(--d-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                            <CategoryPill category={t.category} size="xs" />
                          </div>
                          {t.user.name && (
                            <div style={{ fontSize: 12, color: 'var(--d-text-4)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.user.name} · {t.user.email}
                            </div>
                          )}
                        </div>
                        <span style={{ width: 100, textAlign: 'right', flexShrink: 0 }}><span className={`pill ${STATUS_CLS[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span></span>
                        <span style={{ width: 72, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                          {t.assignee ? (
                            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }} title={t.assignee.name}>
                              {initials(t.assignee.name, '')}
                            </div>
                          ) : (
                            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '1px dashed var(--d-border)', color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>–</div>
                          )}
                        </span>
                        <span style={{ width: 44, fontSize: 11, color: 'var(--d-text-4)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{timeAgo(t.updatedAt)}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

          </div>
        )}
    </main>
  )
}
