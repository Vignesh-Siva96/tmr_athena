'use client'
import { useState, useEffect, useRef } from 'react'
import { sseEventBus } from './sseEventBus'

export interface BackfillStatus {
  archiveStatus: 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'
  archiveTotalSeen: number | null
  archiveTotalEstimate: number | null
  // sidebar alias
  status: 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'
  processed: number | null
}

const POLL_RUNNING_MS = 5000
const POLL_IDLE_MS = 30000

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function fetchStatus(token: string): Promise<BackfillStatus> {
  const res = await fetch(`${API_BASE}/api/v1/sync/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json() as { data?: Partial<BackfillStatus> } | Partial<BackfillStatus>
  const raw = ('data' in json && json.data ? json.data : json) as Partial<BackfillStatus>
  const status = raw.archiveStatus ?? 'IDLE'
  return {
    archiveStatus: status,
    archiveTotalSeen: raw.archiveTotalSeen ?? null,
    archiveTotalEstimate: raw.archiveTotalEstimate ?? null,
    status,
    processed: raw.archiveTotalSeen ?? null,
  }
}

export function useBackfillStatus(token: string | null) {
  const [status, setStatus] = useState<BackfillStatus | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tokenRef = useRef(token)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  useEffect(() => {
    if (!token) return

    let mounted = true

    const poll = () => {
      if (!tokenRef.current) return
      fetchStatus(tokenRef.current)
        .then((s) => {
          if (!mounted) return
          // Never let a stale poll overwrite a higher count already pushed by SSE
          setStatus((prev) => ({
            ...s,
            archiveTotalSeen: Math.max(s.archiveTotalSeen ?? 0, prev?.archiveTotalSeen ?? 0),
            archiveTotalEstimate: s.archiveTotalEstimate ?? prev?.archiveTotalEstimate ?? null,
          }))
          timerRef.current = setTimeout(poll, s.archiveStatus === 'RUNNING' ? POLL_RUNNING_MS : POLL_IDLE_MS)
        })
        .catch(() => {
          if (mounted) {
            timerRef.current = setTimeout(poll, POLL_IDLE_MS)
          }
        })
    }

    poll()

    return () => {
      mounted = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [token])

  const refresh = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!token) return
    fetchStatus(token).then(setStatus).catch(() => {})
  }

  // SSE: update optimistically on archive-progress events (avoids waiting for next poll tick)
  useEffect(() => {
    const unsub = sseEventBus.on('archive-progress', (ev) => {
      setStatus((prev) => {
        if (!prev) return prev
        const archiveStatus = ev.status as BackfillStatus['archiveStatus']
        return {
          ...prev,
          archiveStatus,
          archiveTotalSeen: ev.processed,
          archiveTotalEstimate: ev.total ?? prev.archiveTotalEstimate,
          status: archiveStatus,
          processed: ev.processed,
        }
      })
    })
    return unsub
  }, [])

  return { backfill: status, refresh }
}
