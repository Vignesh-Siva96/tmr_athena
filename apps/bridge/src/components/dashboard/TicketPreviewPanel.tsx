'use client'
import { Bug, Lightbulb, HelpCircle, CreditCard, Circle } from 'lucide-react'

type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

export const STATUS_CLS: Record<TicketStatus, string> = { OPEN: 'd-open', IN_PROGRESS: 'd-prog', WAITING: 'd-wait', RESOLVED: 'd-res', CLOSED: 'd-res' }
export const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed' }
export const CAT_LABEL: Record<TicketCategory, string> = { BUG_REPORT: 'Bug', FEATURE_REQUEST: 'Feature', QUESTION: 'Question', BILLING: 'Billing', OTHER: 'Other' }
export const CAT_COLOR: Record<TicketCategory, string> = { BUG_REPORT: '#EF4444', FEATURE_REQUEST: '#3B82F6', QUESTION: '#22C55E', BILLING: '#F59E0B', OTHER: '#71717A' }
export const PRIO_LABEL: Record<TicketPriority, string> = { NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }

export const CAT_ICON: Record<TicketCategory, React.ReactNode> = {
  BUG_REPORT:      <Bug size={10} />,
  FEATURE_REQUEST: <Lightbulb size={10} />,
  QUESTION:        <HelpCircle size={10} />,
  BILLING:         <CreditCard size={10} />,
  OTHER:           <Circle size={10} />,
}

export function CategoryPill({ category, size = 'sm' }: { category: TicketCategory; size?: 'sm' | 'xs' }) {
  const fontSize = size === 'xs' ? 10 : 11
  const padding = size === 'xs' ? '1px 5px' : '1px 6px'
  return (
    <span style={{ fontSize, fontWeight: 500, padding, borderRadius: 4, color: CAT_COLOR[category], background: `${CAT_COLOR[category]}20`, display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      {CAT_ICON[category]}{CAT_LABEL[category]}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === 'NORMAL') return null
  const color = priority === 'URGENT' ? 'var(--d-danger)' : 'var(--d-warning)'
  const bg = priority === 'URGENT' ? 'var(--d-danger-bg)' : 'var(--d-warning-bg)'
  const icon = priority === 'URGENT' ? '⚑' : '↑'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, color, background: bg, border: `1px solid ${color}33` }}>
      {icon} {PRIO_LABEL[priority]}
    </span>
  )
}
