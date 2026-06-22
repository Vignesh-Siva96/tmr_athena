'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, ChevronDown } from 'lucide-react'
import { CustomerProfilePanel } from '@/components/dashboard/CustomerProfilePanel'
import { UserCategoryControl, UserCategoryBadge } from '@/components/dashboard/TicketPreviewPanel'
import type { UserCategory } from '@/components/dashboard/TicketPreviewPanel'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface CustomerRow {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  category: UserCategory
  domain: string
  ticketCount: number
  conversationCount: number
  openCount: number
  lastActiveAt: string | null
  createdAt: string
}

interface CustomersResponse {
  data: CustomerRow[]
  meta: { total: number; limit: number; offset: number }
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

function DomainFavicon({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false)
  return errored ? (
    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--d-text-3)', width: 16, display: 'inline-block', textAlign: 'center' }}>{domain.slice(0, 2).toUpperCase()}</span>
  ) : (
    <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} onError={() => setErrored(true)} style={{ width: 16, height: 16 }} alt="" />
  )
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--d-bg)' }} />}>
      <CustomersInner />
    </Suspense>
  )
}

function CustomersInner() {
  const router = useRouter()
  const { agent, token, isLoading: authLoading } = useAuth()
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<UserCategory | ''>('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !agent) router.push('/auth')
  }, [authLoading, agent, router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const loadCustomers = useCallback(() => {
    if (!token) return
    setIsLoading(true)
    const params = new URLSearchParams({ limit: '50', offset: '0' })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (categoryFilter) params.set('category', categoryFilter)
    api.get<CustomersResponse>(`/users?${params.toString()}`, token)
      .then((res) => { setCustomers(res.data); setTotal(res.meta.total) })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [token, debouncedSearch, categoryFilter])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  const updateCategoryInList = (userId: string, category: UserCategory) => {
    setCustomers((prev) => prev.map((c) => c.id === userId ? { ...c, category } : c))
  }

  return (
    <>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ padding: '0 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)' }}>Customers</h1>
              <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>{isLoading ? '…' : `${total} total`}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Search */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--d-text-4)', pointerEvents: 'none' }} />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  style={{ height: 30, padding: '0 28px 0 28px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text)', fontFamily: 'inherit', outline: 'none', width: 220 }} />
                {search && (
                  <button type="button" onClick={() => setSearch('')}
                    style={{ position: 'absolute', right: 7, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--d-text-4)', display: 'flex', padding: 0 }}>
                    <X size={12} />
                  </button>
                )}
              </div>
              {/* Category filter */}
              <div style={{ position: 'relative' }}>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as UserCategory | '')}
                  style={{ height: 30, padding: '0 28px 0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: categoryFilter ? 'var(--d-text)' : 'var(--d-text-3)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                  <option value="">All categories</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="PROMOTIONAL">Promotional</option>
                </select>
                <ChevronDown size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-3)', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>
        </header>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...Array(8)].map((_, i) => <div key={i} className="shimmer" style={{ height: 52, borderRadius: 8 }} />)}
            </div>
          ) : customers.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%', color: 'var(--d-text-3)', fontSize: 14 }}>
              No customers found.
            </div>
          ) : (
            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 140px 80px 80px 80px 100px', gap: 0, padding: '8px 16px', borderBottom: '1px solid var(--d-border)', background: 'var(--d-raised)' }}>
                {['Name / Email', 'Domain', 'Category', 'Tickets', 'Convos', 'Open', 'Last active'].map((h) => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</span>
                ))}
              </div>

              {customers.map((c, idx) => (
                <div key={c.id}
                  onClick={() => setSelectedUserId(c.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 140px 80px 80px 80px 100px',
                    gap: 0, padding: '10px 16px', cursor: 'pointer',
                    borderBottom: idx < customers.length - 1 ? '1px solid var(--d-border-2)' : 'none',
                    background: 'transparent', transition: 'background 80ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--d-raised)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Name / Email */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                      {initials(c.name, c.email)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name ?? c.email}</div>
                      {c.name && <div style={{ fontSize: 11, color: 'var(--d-text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>}
                    </div>
                  </div>

                  {/* Domain */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DomainFavicon domain={c.domain} />
                    <span style={{ fontSize: 12, color: 'var(--d-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.domain}</span>
                  </div>

                  {/* Category (inline control) */}
                  <div style={{ display: 'flex', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <UserCategoryControl userId={c.id} category={c.category} onChange={(cat) => updateCategoryInList(c.id, cat)} />
                  </div>

                  {/* Tickets */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--d-text-2)', fontVariantNumeric: 'tabular-nums' }}>{c.ticketCount}</span>
                  </div>

                  {/* Conversations */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--d-text-2)', fontVariantNumeric: 'tabular-nums' }}>{c.conversationCount}</span>
                  </div>

                  {/* Open */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: c.openCount > 0 ? 'var(--d-warning)' : 'var(--d-text-4)', fontWeight: c.openCount > 0 ? 600 : 400 }}>
                      {c.openCount > 0 ? c.openCount : '—'}
                    </span>
                  </div>

                  {/* Last active */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{timeAgo(c.lastActiveAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {selectedUserId && (
        <CustomerProfilePanel userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      )}
    </>
  )
}
