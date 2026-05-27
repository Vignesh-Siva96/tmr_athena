'use client'
import type { ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { useSseEvents } from '@/lib/useSseEvents'

/**
 * Mounts the SSE connection once at the root of the authenticated shell.
 * Events are distributed via sseEventBus so components can subscribe
 * without prop-drilling or extra context.
 */
export function SseProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  useSseEvents(token)
  return <>{children}</>
}
