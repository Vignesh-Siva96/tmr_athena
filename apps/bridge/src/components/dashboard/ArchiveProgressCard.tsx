'use client'
import { useBackfillStatus } from '@/lib/useBackfillStatus'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function ArchiveProgressCard({ token, onRunAI }: { token: string; onRunAI?: () => void }) {
  const { backfill: state, refresh } = useBackfillStatus(token)

  if (!state || state.archiveStatus === 'IDLE') return null

  const seen = state.archiveTotalSeen ?? 0
  const total = state.archiveTotalEstimate

  const progressText = total
    ? `${seen.toLocaleString()} / ${total.toLocaleString()} emails retrieved`
    : `${seen.toLocaleString()} emails retrieved`

  const progressPct = total && total > 0 ? Math.min(100, Math.round((seen / total) * 100)) : null

  if (state.archiveStatus === 'RUNNING') {
    return (
      <div style={{ padding: '12px', background: 'var(--d-raised)', borderRadius: 8, marginTop: 12 }}>
        <style>{`@keyframes bfIndeterminate { 0% { left: -40%; width: 40% } 100% { left: 100%; width: 40% } }`}</style>
        <div style={{ fontSize: 13, color: 'var(--d-text-2)', marginBottom: 8 }}>
          {progressText} — <span style={{ color: 'var(--d-text-3)' }}>you can use Bridge now</span>
        </div>
        <div style={{ height: 4, background: 'var(--d-border)', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
          {progressPct !== null ? (
            <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--d-accent)', borderRadius: 2, transition: 'width 600ms ease' }} />
          ) : (
            <div style={{ position: 'absolute', height: '100%', background: 'var(--d-accent)', borderRadius: 2, animation: 'bfIndeterminate 1.4s ease-in-out infinite' }} />
          )}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await fetch(`${API_BASE}/api/v1/sync/archive/cancel`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
              })
              refresh()
            } catch { /* ignore */ }
          }}
          style={{ marginTop: 8, fontSize: 12, color: 'var(--d-text-3)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
    )
  }

  if (state.archiveStatus === 'DONE') {
    return (
      <div style={{ padding: '12px', background: 'var(--d-raised)', borderRadius: 8, marginTop: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--d-success)' }}>
          ✓ Imported {seen > 0 ? `${seen.toLocaleString()} emails` : 'all emails'}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={async () => {
              try {
                await fetch(`${API_BASE}/api/v1/sync/resync`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
                refresh()
              } catch { /* ignore */ }
            }}
            style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--d-border)', borderRadius: 4, background: 'none', color: 'var(--d-text-2)', cursor: 'pointer' }}
          >
            Pull again
          </button>
          {onRunAI && (
            <button
              type="button"
              onClick={onRunAI}
              style={{ fontSize: 12, padding: '4px 10px', border: '1px solid var(--d-border)', borderRadius: 4, background: 'none', color: 'var(--d-text-2)', cursor: 'pointer' }}
            >
              Run AI on imported emails
            </button>
          )}
        </div>
      </div>
    )
  }

  if (state.archiveStatus === 'FAILED' || state.archiveStatus === 'CANCELLED') {
    return (
      <div style={{ padding: '12px', background: 'var(--d-raised)', borderRadius: 8, marginTop: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--d-danger)' }}>
          {state.archiveStatus === 'FAILED' ? 'Archive failed.' : 'Archive cancelled.'}{' '}
          <button
            type="button"
            onClick={async () => {
              try {
                await fetch(`${API_BASE}/api/v1/sync/archive/resume`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
                refresh()
              } catch { /* ignore */ }
            }}
            style={{ fontSize: 12, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Resume
          </button>
        </div>
      </div>
    )
  }

  return null
}
