export type SseEvent =
  | { type: 'hello'; ts: number }
  | { type: 'ticket-created'; ticketId: string; threadId?: string }
  | { type: 'ticket-updated'; ticketId: string }
  | { type: 'message-created'; ticketId: string; messageId: string }
  | { type: 'archive-progress'; processed: number; status: string }
  | { type: 'notification-created'; notificationId: string }
