'use client'

/**
 * In-process pub/sub bus for SSE events received from the API.
 * Components subscribe via `sseEventBus.on(type, handler)` and the
 * single shared EventSource (created by useSseEvents) calls
 * `sseEventBus.emit(event)` whenever an event arrives.
 */

type SseEvent =
  | { type: 'hello'; ts: number }
  | { type: 'ticket-created'; ticketId: string; threadId?: string }
  | { type: 'ticket-updated'; ticketId: string }
  | { type: 'message-created'; ticketId: string; messageId: string }
  | { type: 'archive-progress'; processed: number; total?: number; status: string }
  | { type: 'notification-created'; notificationId: string }

type EventType = SseEvent['type']
type HandlerMap = { [K in EventType]?: Set<(event: Extract<SseEvent, { type: K }>) => void> }

const handlers: HandlerMap = {}

function on<K extends EventType>(
  type: K,
  handler: (event: Extract<SseEvent, { type: K }>) => void,
): () => void {
  if (!handlers[type]) {
    handlers[type] = new Set() as HandlerMap[typeof type]
  }
  ;(handlers[type] as Set<typeof handler>).add(handler)
  return () => {
    ;(handlers[type] as Set<typeof handler> | undefined)?.delete(handler)
  }
}

function emit(event: SseEvent): void {
  const set = handlers[event.type] as Set<(e: typeof event) => void> | undefined
  if (set) {
    set.forEach((h) => {
      try { h(event as never) } catch { /* ignore handler errors */ }
    })
  }
}

export const sseEventBus = { on, emit }
export type { SseEvent }
