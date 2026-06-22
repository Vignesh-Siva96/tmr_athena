'use client'
import { RefreshCw, LineChart, CreditCard, Users, Star, Database, Search, Calendar, Clock, Plus, Table } from 'lucide-react'
import type { ReactNode } from 'react'

export interface TmrAccountSummary {
  accountId: string
  planName: string
  status: string
  coreDestination: string | null
  additionalDestinations: string[]
  billingFreq: string | null
}

export interface TmrTeamSummary {
  teamId: string
  name: string
  dataSources: number
  queries: number
  schedules: number
}

export interface TmrMetadata {
  accounts: TmrAccountSummary[]
  accountStatusCounts: Record<string, number>
  teams: TmrTeamSummary[]
}

type TmrSyncStatus = 'PENDING' | 'OK' | 'NOT_FOUND' | 'ERROR'

interface Props {
  data: TmrMetadata | null
  status: TmrSyncStatus
  syncedAt: string | null
  onRefresh: () => void
  variant: 'panel' | 'compact'
  onViewMore?: () => void
  /** True while a sync is actually in flight. PENDING only shows the loading
   *  shimmer while this is true — otherwise PENDING renders a terminal
   *  "not synced" state with a manual sync button (prevents an infinite spinner
   *  when the service is unconfigured or the worker no-ops). */
  syncing?: boolean
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--d-success)',
  in_trial: 'var(--d-purple)',
  non_renewing: 'var(--d-warning)',
  cancelled: 'var(--d-text-3)',
}
const STATUS_BG: Record<string, string> = {
  active: 'var(--d-success-bg)',
  in_trial: 'var(--d-purple-bg)',
  non_renewing: 'var(--d-warning-bg)',
  cancelled: 'rgba(126,133,144,0.14)',
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'var(--d-text-3)'
  const bg = STATUS_BG[status] ?? 'rgba(126,133,144,0.14)'
  const label = status.replace(/_/g, ' ')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      padding: '3px 9px', borderRadius: 999,
      color, background: bg, border: `1px solid ${color}55`, flexShrink: 0,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}

function PlanBadge({ name }: { name: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%',
      padding: '3px 9px', borderRadius: 'var(--r-sm)', fontSize: 12.5, fontWeight: 700,
      background: 'var(--d-accent-bg)', color: 'var(--d-accent)', border: '1px solid rgba(255,103,0,0.22)',
    }}>
      <Star size={12} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Plan'}</span>
    </span>
  )
}

function MetaTag({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px',
      borderRadius: 'var(--r-xs)', background: 'var(--d-raised-2)', border: '1px solid var(--d-border-2)',
      fontSize: 11, color: 'var(--d-text-2)',
    }}>
      <span style={{ color: 'var(--d-text-4)', display: 'inline-flex' }}>{icon}</span>
      <b style={{ color: 'var(--d-text)', fontWeight: 600 }}>{value}</b>
    </span>
  )
}

function SummaryTile({ icon, iconColor, iconBg, value, label }: { icon: ReactNode; iconColor: string; iconBg: string; value: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)', background: 'var(--d-raised)', border: '1px solid var(--d-border)' }}>
      <span style={{ width: 30, height: 30, borderRadius: 'var(--r-sm)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconColor, background: iconBg }}>{icon}</span>
      <div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--d-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}>{value}</div>
        <div style={{ fontSize: 10, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

function TeamStat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div style={{ border: '1px solid var(--d-border-2)', borderRadius: 'var(--r-sm)', padding: '9px 8px 8px', textAlign: 'center', background: 'var(--d-raised-2)' }}>
      <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 6, color: 'var(--d-text-3)' }}>{icon}</span>
      <div style={{ fontSize: 18, fontWeight: 700, color: value === 0 ? 'var(--d-text-4)' : 'var(--d-text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 5 }}>{label}</div>
    </div>
  )
}

function BrandBand({ syncedAt, onRefresh, refreshing }: { syncedAt: string | null; onRefresh: () => void; refreshing?: boolean }) {
  return (
    <div style={{
      background: 'radial-gradient(120% 140% at 0% 0%, rgba(255,103,0,0.16), transparent 60%), linear-gradient(180deg, rgba(255,103,0,0.07), rgba(255,103,0,0)), var(--d-raised-2)',
      borderRadius: 'var(--r-md)',
      border: '1px solid rgba(255,103,0,0.22)',
      borderLeft: '3px solid var(--d-accent)',
      padding: '12px 14px', marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, var(--d-accent), #C24B00)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(255,103,0,0.35)',
      }}>
        <LineChart size={15} color="#fff" strokeWidth={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--d-text)', letterSpacing: '0.01em' }}>TMR Product</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-success)', boxShadow: '0 0 0 3px rgba(34,197,94,0.18)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--d-text-3)' }}>{syncedAt ? `Synced ${new Date(syncedAt).toLocaleDateString()}` : 'Not synced'}</span>
        </div>
      </div>
      <button type="button" onClick={onRefresh} disabled={refreshing} title="Refresh TMR data" style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
        background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)',
        color: 'var(--d-text-2)', fontSize: 11, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer',
        fontFamily: 'inherit', flexShrink: 0, opacity: refreshing ? 0.7 : 1,
      }}>
        <RefreshCw size={11} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        {refreshing ? 'Syncing…' : 'Refresh'}
      </button>
    </div>
  )
}

function ShimmerBlock({ height = 48 }: { height?: number }) {
  return <div className="shimmer" style={{ height, borderRadius: 8, marginBottom: 8 }} />
}

const SECTION_LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }

export function TmrProductSection({ data, status, syncedAt, onRefresh, variant, onViewMore, syncing }: Props) {
  // PENDING means "never resolved". Show the shimmer only while a sync is in
  // flight; once it settles still-PENDING, fall back to a terminal state so the
  // panel never spins forever (e.g. service unconfigured → worker no-ops).
  const isLoading = status === 'PENDING' && !!syncing
  const isUnsynced = status === 'PENDING' && !syncing

  if (variant === 'compact') {
    return (
      <div style={{ border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 16, flexShrink: 0 }}>
        {/* mini brand band */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px',
          background: 'radial-gradient(120% 160% at 0% 0%, rgba(255,103,0,0.16), transparent 60%), var(--d-raised-2)',
          borderBottom: '1px solid var(--d-border-2)', borderLeft: '3px solid var(--d-accent)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--d-text-2)' }}>
            <LineChart size={13} style={{ color: 'var(--d-accent)' }} /> TMR Product
          </span>
          {syncing
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--d-text-4)' }}><RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Syncing…</span>
            : syncedAt && <span style={{ fontSize: 10.5, color: 'var(--d-text-4)' }}>Synced {new Date(syncedAt).toLocaleDateString()}</span>}
        </div>

        <div style={{ padding: 12 }}>
          {isLoading && (<><ShimmerBlock height={28} /><ShimmerBlock height={36} /></>)}

          {isUnsynced && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--d-text-4)', fontStyle: 'italic' }}>Not synced yet</span>
              <button type="button" onClick={onRefresh} style={{ fontSize: 11, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Sync</button>
            </div>
          )}

          {status === 'NOT_FOUND' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--d-text-4)', fontStyle: 'italic' }}>No TMR account linked</span>
              <button type="button" onClick={onRefresh} style={{ fontSize: 11, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
            </div>
          )}

          {status === 'ERROR' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--r-sm)', background: 'var(--d-danger-bg)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <span style={{ fontSize: 12, color: 'var(--d-danger)' }}>Couldn&apos;t load product data</span>
              <button type="button" onClick={onRefresh} style={{ fontSize: 11, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
            </div>
          )}

          {status === 'OK' && data && (
            <>
              {data.accounts[0] && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                  <PlanBadge name={data.accounts[0].planName} />
                  <StatusPill status={data.accounts[0].status} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: onViewMore ? 11 : 0 }}>
                {[
                  { value: data.accounts.length, label: 'Accounts' },
                  { value: data.teams.length, label: 'Teams' },
                ].map(({ value, label }) => (
                  <div key={label} style={{ flex: 1, background: 'var(--d-raised-2)', border: '1px solid var(--d-border-2)', borderRadius: 'var(--r-sm)', padding: 9, textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--d-text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}>{value}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
              {onViewMore && (
                <button type="button" onClick={onViewMore} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, width: '100%', fontSize: 11.5, fontWeight: 600, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  view more details →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // variant === 'panel'
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--d-border)' }}>
      <p style={{ ...SECTION_LABEL, margin: '0 0 12px' }}>Product Account</p>

      <BrandBand syncedAt={syncedAt} onRefresh={onRefresh} refreshing={!!syncing} />

      {isLoading && (
        <>
          <ShimmerBlock height={56} />
          <ShimmerBlock height={56} />
          <ShimmerBlock height={40} />
        </>
      )}

      {isUnsynced && (
        <div style={{ padding: '16px', textAlign: 'center', borderRadius: 'var(--r-md)', background: 'var(--d-raised)', border: '1px solid var(--d-border)' }}>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: '0 0 10px' }}>Product data not synced yet</p>
          <button type="button" onClick={onRefresh} style={{ height: 28, padding: '0 14px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Sync now</button>
        </div>
      )}

      {status === 'NOT_FOUND' && (
        <div style={{ padding: '16px', textAlign: 'center', borderRadius: 'var(--r-md)', background: 'var(--d-raised)', border: '1px solid var(--d-border)' }}>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: '0 0 10px' }}>No TMR account linked to this email</p>
          <button type="button" onClick={onRefresh} style={{ height: 28, padding: '0 14px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {status === 'ERROR' && (
        <div style={{ padding: '14px', borderRadius: 'var(--r-md)', background: 'var(--d-danger-bg)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <p style={{ fontSize: 13, color: 'var(--d-danger)', fontWeight: 600, margin: '0 0 6px' }}>Couldn&apos;t load product data</p>
          <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: '0 0 10px' }}>Check that the TMR service is reachable.</p>
          <button type="button" onClick={onRefresh} style={{ height: 26, padding: '0 12px', background: 'none', color: 'var(--d-accent)', border: '1px solid var(--d-accent)', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}

      {status === 'OK' && data && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <SummaryTile icon={<CreditCard size={15} />} iconColor="var(--d-accent)" iconBg="var(--d-accent-bg)" value={data.accounts.length} label="Accounts" />
            <SummaryTile icon={<Users size={15} />} iconColor="#3B82F6" iconBg="rgba(59,130,246,0.14)" value={data.teams.length} label="Teams" />
          </div>

          {/* Accounts */}
          {data.accounts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--d-text-2)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>Accounts</p>
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {Object.entries(data.accountStatusCounts).map(([st, count]) => {
                    const c = STATUS_COLOR[st] ?? 'var(--d-text-3)'
                    return (
                      <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: c, background: STATUS_BG[st] ?? 'rgba(126,133,144,0.14)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />
                        {count} {st.replace(/_/g, ' ')}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {data.accounts.map((acc) => (
                  <div key={acc.accountId} style={{ padding: '11px 12px', borderRadius: 'var(--r-sm)', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderLeft: `3px solid ${STATUS_COLOR[acc.status] ?? 'var(--d-text-3)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
                      <PlanBadge name={acc.planName} />
                      <StatusPill status={acc.status} />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {acc.coreDestination && <MetaTag icon={<Table size={11} />} value={acc.coreDestination} />}
                      {acc.additionalDestinations.length > 0 && <MetaTag icon={<Plus size={11} />} value={acc.additionalDestinations.join(', ')} />}
                      {acc.billingFreq && <MetaTag icon={<Clock size={11} />} value={acc.billingFreq} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Teams */}
          {data.teams.length > 0 && (
            <div>
              <p style={SECTION_LABEL}>Teams</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {data.teams.map((team) => (
                  <div key={team.teamId} style={{ padding: '11px 12px', borderRadius: 'var(--r-sm)', background: 'var(--d-raised)', border: '1px solid var(--d-border)' }}>
                    <p style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 9px' }}>
                      <Users size={13} style={{ color: '#3B82F6', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      <TeamStat icon={<Database size={14} />} value={team.dataSources} label="Sources" />
                      <TeamStat icon={<Search size={14} />} value={team.queries} label="Queries" />
                      <TeamStat icon={<Calendar size={14} />} value={team.schedules} label="Schedules" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
