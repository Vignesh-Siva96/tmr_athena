'use client'
import { useState } from 'react'
import { Info } from 'lucide-react'

export function InfoTooltip({ text, direction = 'up' }: { text: string; direction?: 'up' | 'down' }) {
  const [show, setShow] = useState(false)
  const vPos = direction === 'down' ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Info size={13} color="var(--d-text-4)" style={{ cursor: 'help', flexShrink: 0 }} />
      {show && (
        <div style={{
          position: 'absolute', ...vPos, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 7,
          padding: '7px 11px', fontSize: 11, color: 'var(--d-text-3)', width: 230,
          zIndex: 200, lineHeight: 1.55, pointerEvents: 'none', whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}
