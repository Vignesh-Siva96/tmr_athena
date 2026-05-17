'use client'
import { Bug, Sparkles, HelpCircle, CreditCard, Folder } from 'lucide-react'

export type TicketCategory = 'BUG_REPORT' | 'FEATURE_REQUEST' | 'QUESTION' | 'BILLING' | 'OTHER'

const CATEGORIES: { key: TicketCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'BUG_REPORT', label: 'Bug Report', icon: <Bug size={18} /> },
  { key: 'FEATURE_REQUEST', label: 'Feature Request', icon: <Sparkles size={18} /> },
  { key: 'QUESTION', label: 'Question', icon: <HelpCircle size={18} /> },
  { key: 'BILLING', label: 'Billing', icon: <CreditCard size={18} /> },
  { key: 'OTHER', label: 'Other', icon: <Folder size={18} /> },
]

interface CategorySelectorProps {
  value: TicketCategory | null
  onChange: (value: TicketCategory) => void
  error?: string
}

export function CategorySelector({ value, onChange, error }: CategorySelectorProps) {
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Issue category"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {CATEGORIES.map((cat) => {
          const isActive = value === cat.key
          return (
            <button
              key={cat.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(cat.key)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '16px 8px',
                minHeight: 84,
                border: isActive ? '1.5px solid var(--p-accent)' : '1px solid var(--p-border)',
                borderRadius: 'var(--r-md)',
                background: isActive ? 'var(--p-accent-bg)' : '#fff',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 120ms ease',
                boxShadow: isActive ? '0 0 0 3px rgba(37,99,235,0.08)' : 'none',
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r-sm)',
                  background: isActive ? '#fff' : 'var(--p-surface)',
                  color: isActive ? 'var(--p-accent)' : 'var(--p-text-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isActive ? '0 1px 2px rgba(37,99,235,0.18), 0 0 0 1px rgba(37,99,235,0.20)' : 'none',
                }}
              >
                {cat.icon}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--p-accent-hv)' : 'var(--p-text)',
                  lineHeight: 1.25,
                }}
              >
                {cat.label}
              </span>
            </button>
          )
        })}
      </div>
      {error && (
        <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 6 }}>{error}</p>
      )}
    </div>
  )
}
