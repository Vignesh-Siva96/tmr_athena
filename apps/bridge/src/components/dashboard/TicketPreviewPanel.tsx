'use client'
import { Bug, Lightbulb, HelpCircle, CreditCard, Circle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'
type TicketPriority = 'NORMAL' | 'HIGH' | 'URGENT'
type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'
export type UserCategory = 'CUSTOMER' | 'MARKETING' | 'PROMOTIONAL'

export const STATUS_CLS: Record<TicketStatus, string> = { NEW: 'd-new', OPEN: 'd-open', IN_PROGRESS: 'd-prog', WAITING: 'd-wait', RESOLVED: 'd-res', CLOSED: 'd-res', DISMISSED: 'd-res' }
export const STATUS_LABEL: Record<TicketStatus, string> = { NEW: 'New', OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed', DISMISSED: 'Dismissed' }
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

const USER_CAT_LABEL: Record<UserCategory, string> = { CUSTOMER: 'Customer', MARKETING: 'Marketing', PROMOTIONAL: 'Promotional' }
const USER_CAT_COLOR: Record<UserCategory, string> = { CUSTOMER: 'var(--d-accent)', MARKETING: 'var(--d-purple, #8B5CF6)', PROMOTIONAL: 'var(--d-warning)' }
const USER_CAT_BG: Record<UserCategory, string> = { CUSTOMER: 'var(--d-accent-bg)', MARKETING: 'rgba(139,92,246,0.12)', PROMOTIONAL: 'var(--d-warning-bg)' }

export function UserCategoryBadge({ category }: { category: UserCategory }) {
  const cat = category ?? 'CUSTOMER'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4, color: USER_CAT_COLOR[cat], background: USER_CAT_BG[cat], border: `1px solid ${USER_CAT_COLOR[cat]}33`, flexShrink: 0 }}>
      {USER_CAT_LABEL[cat]}
    </span>
  )
}

export function UserCategoryControl({ userId, category, onChange }: { userId: string; category: UserCategory; onChange?: (c: UserCategory) => void }) {
  const { token } = useAuth()
  const [current, setCurrent] = React.useState<UserCategory>(category)

  const handleChange = async (next: UserCategory) => {
    const prev = current
    setCurrent(next)
    onChange?.(next)
    try {
      await api.patch(`/users/${userId}`, { category: next }, token!)
    } catch {
      setCurrent(prev)
      onChange?.(prev)
    }
  }

  return (
    <select
      value={current}
      onChange={(e) => void handleChange(e.target.value as UserCategory)}
      onClick={(e) => e.stopPropagation()}
      style={{ height: 22, padding: '0 4px', fontSize: 10, fontWeight: 600, color: USER_CAT_COLOR[current], background: USER_CAT_BG[current], border: `1px solid ${USER_CAT_COLOR[current]}33`, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none' }}
    >
      {(['CUSTOMER', 'MARKETING', 'PROMOTIONAL'] as UserCategory[]).map((c) => (
        <option key={c} value={c}>{USER_CAT_LABEL[c]}</option>
      ))}
    </select>
  )
}

// React is already in scope via JSX transform but we need it for useState
import React from 'react'
