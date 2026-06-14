'use client'
import { useState } from 'react'
import { Mail } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

export function VerificationBanner() {
  const { user, token } = useAuth()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  if (!user || user.isVerified || user.isGuest) return null

  const handleResend = async () => {
    setState('sending')
    try {
      await api.post('/auth/resend-verification', {}, token)
      setState('sent')
    } catch {
      setState('idle')
    }
  }

  return (
    <div
      data-testid="verification-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '10px 16px',
        background: 'var(--p-warning-bg)',
        borderBottom: '1px solid var(--p-border)',
        fontSize: 13,
        color: 'var(--p-text-2)',
      }}
    >
      <Mail size={14} style={{ color: 'var(--p-warning)', flexShrink: 0 }} />
      <span>Please verify your email address.</span>
      {state === 'sent' ? (
        <span style={{ color: 'var(--p-success)', fontWeight: 500 }}>Verification email sent!</span>
      ) : (
        <button
          type="button"
          data-testid="resend-verification-btn"
          onClick={handleResend}
          disabled={state === 'sending'}
          style={{
            color: 'var(--p-accent)',
            background: 'none',
            border: 'none',
            cursor: state === 'sending' ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          {state === 'sending' ? 'Sending…' : 'Resend'}
        </button>
      )}
    </div>
  )
}
