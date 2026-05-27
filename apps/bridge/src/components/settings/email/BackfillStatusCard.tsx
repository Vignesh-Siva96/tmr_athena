'use client'
import type { BackfillStatus } from '@/lib/useBackfillStatus'

interface BackfillStatusCardProps {
  backfill: BackfillStatus | null
  token: string | null
  onStartFullArchive?: () => void
  onRunAi?: () => void
}

const card: React.CSSProperties = {
  background: 'var(--d-surface)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-md)',
  padding: '20px 24px',
  marginTop: 20,
}

export function BackfillStatusCard({ backfill, onStartFullArchive, onRunAi }: BackfillStatusCardProps) {
  if (!backfill || backfill.archiveStatus === 'IDLE') return null

  if (backfill.archiveStatus === 'RUNNING') {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--d-accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)' }}>Importing inbox history…</span>
        </div>

        {backfill.archiveTotalSeen !== null && (
          <div style={{ fontSize: 12, color: 'var(--d-text-3)', marginBottom: 8 }}>
            {backfill.archiveTotalSeen.toLocaleString()} emails imported so far
          </div>
        )}

        <div style={{ height: 6, background: 'var(--d-raised)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '60%', background: 'var(--d-accent)', borderRadius: 3 }} />
        </div>

        <p style={{ fontSize: 12, color: 'var(--d-text-4)', marginTop: 10, margin: '10px 0 0' }}>
          You can use Bridge normally while this runs — live mail is prioritised.
        </p>

        <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }`}</style>
      </div>
    )
  }

  if (backfill.archiveStatus === 'DONE') {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-success)' }}>Inbox history imported</span>
        </div>

        {backfill.archiveTotalSeen !== null && (
          <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: '0 0 14px' }}>
            Imported {backfill.archiveTotalSeen.toLocaleString()} emails.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onStartFullArchive && (
            <button
              type="button"
              onClick={onStartFullArchive}
              style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--d-border)', background: 'var(--d-raised)', color: 'var(--d-text)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit' }}
            >
              Pull again
            </button>
          )}
          {onRunAi && (
            <button
              type="button"
              onClick={onRunAi}
              style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--d-border)', background: 'var(--d-raised)', color: 'var(--d-text)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit' }}
            >
              Run AI on imported emails
            </button>
          )}
        </div>
      </div>
    )
  }

  if (backfill.archiveStatus === 'FAILED' || backfill.archiveStatus === 'CANCELLED') {
    return (
      <div style={{ ...card, borderColor: 'var(--d-danger)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-danger)', marginBottom: 6 }}>
          {backfill.archiveStatus === 'FAILED' ? 'Import failed' : 'Import cancelled'}
        </div>
        {onStartFullArchive && (
          <button
            type="button"
            onClick={onStartFullArchive}
            style={{ height: 32, padding: '0 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--d-border)', background: 'var(--d-raised)', color: 'var(--d-text)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit' }}
          >
            Resume
          </button>
        )}
      </div>
    )
  }

  return null
}
