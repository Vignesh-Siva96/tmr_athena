'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import AuthCard from '@/components/auth/AuthCard'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Status = 'loading' | 'success' | 'error'

function VerifyEmailInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user, signIn, token: authToken } = useAuth()
  const [status, setStatus] = useState<Status>('loading')
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    if (!token) {
      setStatus('error')
      return
    }

    api.post<{ id: string; email: string; name: string | null; avatarUrl: string | null; isGuest: boolean; isVerified: boolean }>('/auth/verify-email', { token })
      .then((updatedUser) => {
        setStatus('success')
        if (authToken && user) {
          signIn(authToken, { ...user, isVerified: updatedUser.isVerified })
        }
      })
      .catch(() => setStatus('error'))
  }, [token, authToken, user, signIn])

  return (
    <div style={{ textAlign: 'center' }}>
      {status === 'loading' && (
        <>
          <Loader2 size={40} style={{ color: 'var(--p-accent)', margin: '0 auto 16px', display: 'block' }} className="spin" />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Verifying your email…
          </h2>
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircle2 size={40} style={{ color: 'var(--p-success)', margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Email verified
          </h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>
            Thanks — your email address has been confirmed.
          </p>
          <Link
            href={user ? '/tickets' : '/auth'}
            style={{
              display: 'inline-flex',
              height: 40,
              alignItems: 'center',
              padding: '0 20px',
              background: 'var(--p-accent)',
              color: '#fff',
              borderRadius: 'var(--r-sm)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            {user ? 'Go to my tickets' : 'Sign in'}
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <XCircle size={40} style={{ color: 'var(--p-danger)', margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Link expired or invalid
          </h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>
            This verification link is no longer valid. You can request a new one from your account.
          </p>
          <Link
            href={user ? '/tickets' : '/auth'}
            style={{
              display: 'inline-flex',
              height: 40,
              alignItems: 'center',
              padding: '0 20px',
              background: 'var(--p-accent)',
              color: '#fff',
              borderRadius: 'var(--r-sm)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            {user ? 'Go to my tickets' : 'Back to sign in'}
          </Link>
        </>
      )}
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <AuthCard>
      <Suspense fallback={<p style={{ fontSize: 14, color: 'var(--p-text-3)', textAlign: 'center' }}>Loading…</p>}>
        <VerifyEmailInner />
      </Suspense>
    </AuthCard>
  )
}
