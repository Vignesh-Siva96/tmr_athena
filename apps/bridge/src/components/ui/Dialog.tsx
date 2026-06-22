'use client'
import { useEffect, useRef, useState } from 'react'

// ─── Shared overlay + panel ───────────────────────────────────────────────────

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      {/* stop propagation so backdrop click only closes when clicking the overlay */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--d-surface)',
        border: '1px solid var(--d-border)',
        borderRadius: 'var(--r-lg)',
        padding: 24,
        width: '100%',
        maxWidth: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {children}
      </div>
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, color: 'var(--d-text)',
  marginBottom: 8, fontFamily: 'var(--font-display)',
}
const messageStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--d-text-3)', lineHeight: 1.6, marginBottom: 20,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end',
}
const cancelBtnStyle: React.CSSProperties = {
  height: 34, padding: '0 14px',
  background: 'none', color: 'var(--d-text-3)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
}

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Overlay onClose={onCancel}>
      <p style={titleStyle}>{title}</p>
      <p style={messageStyle}>{message}</p>
      <div style={rowStyle}>
        <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
        <button
          type="button"
          onClick={onConfirm}
          autoFocus
          style={{
            height: 34, padding: '0 16px',
            background: danger ? 'var(--d-danger)' : 'var(--d-accent)',
            color: '#fff', border: 'none',
            borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Overlay>
  )
}

// ─── PromptDialog ─────────────────────────────────────────────────────────────

interface PromptDialogProps {
  title: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title, placeholder = '', initialValue = '', confirmLabel = 'OK',
  onConfirm, onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.trim()) onConfirm(value.trim())
  }

  return (
    <Overlay onClose={onCancel}>
      <p style={titleStyle}>{title}</p>
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', height: 36, padding: '0 10px',
            background: 'var(--d-surface-2, var(--d-surface))',
            border: '1px solid var(--d-border)',
            borderRadius: 'var(--r-sm)', fontSize: 13,
            color: 'var(--d-text)', outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
            marginBottom: 16,
          }}
        />
        <div style={rowStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>Cancel</button>
          <button
            type="submit"
            disabled={!value.trim()}
            style={{
              height: 34, padding: '0 16px',
              background: 'var(--d-accent)', color: '#fff', border: 'none',
              borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              opacity: value.trim() ? 1 : 0.5,
              fontFamily: 'inherit',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Overlay>
  )
}
