'use client'
import { useEffect, useRef } from 'react'
import { sseEventBus, type SseEvent } from './sseEventBus'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/**
 * Opens a single server-sent-events connection for the current session.
 * Should be mounted once, high in the React tree (e.g. layout.tsx).
 * All components subscribe to events via sseEventBus.on(), not this hook directly.
 */
export function useSseEvents(token: string | null): void {
  const esRef = useRef<EventSource | null>(null)
  const tokenRef = useRef(token)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  useEffect(() => {
    if (!token) return

    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0

    function connect() {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      const url = `${API_BASE}/api/v1/events?token=${encodeURIComponent(token!)}`
      const es = new EventSource(url)
      esRef.current = es

      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string) as SseEvent
          sseEventBus.emit(event)
          // Successful message — reset retry backoff
          retryCount = 0
        } catch {
          // Ignore unparseable frames
        }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        // Exponential backoff: 2s, 4s, 8s … capped at 30s
        const delay = Math.min(2000 * 2 ** retryCount, 30_000)
        retryCount++
        retryTimeout = setTimeout(() => {
          if (tokenRef.current) connect()
        }, delay)
      }
    }

    connect()

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
}
