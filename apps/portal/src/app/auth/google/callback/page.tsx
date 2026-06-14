'use client'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { verifyAndConsumeState } from '@/lib/googleOAuth'

interface AuthResponse {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; isGuest: boolean; isVerified: boolean }
  token: string
}

function GoogleCallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn, isLoading: authLoading } = useAuth()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  // Prevents double-execution in React 18 Strict Mode (effect mount → unmount → remount)
  const handledRef = useRef(false)

  useEffect(() => {
    if (authLoading) return
    if (handledRef.current) return
    handledRef.current = true

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error) {
      if (error === 'access_denied') {
        router.replace('/auth?error=google_cancelled')
      } else {
        router.replace(`/auth?error=google_failed`)
      }
      return
    }

    if (!code || !state) {
      setErrorMsg('No authorisation code received from Google.')
      setStatus('error')
      return
    }

    if (!verifyAndConsumeState(state)) {
      router.replace('/auth?error=invalid_state')
      return
    }

    let cancelled = false

    const timeout = setTimeout(() => {
      if (!cancelled) {
        setErrorMsg('Sign-in timed out. Please try again.')
        setStatus('error')
      }
    }, 15_000)

    const redirectUri = `${window.location.origin}/auth/google/callback`
    api.post<AuthResponse>('/auth/google', { code, redirectUri })
      .then((res) => {
        if (!cancelled) {
          signIn(res.token, res.user)
          router.replace('/tickets')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.')
          setStatus('error')
        }
      })
      .finally(() => clearTimeout(timeout))

    return () => { cancelled = true; clearTimeout(timeout) }
  }, [authLoading, searchParams, signIn, router])

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--p-text)', marginBottom: 8 }}>Sign-in failed</h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>{errorMsg}</p>
          <a
            href="/auth"
            style={{ height: 36, padding: '8px 20px', background: 'var(--p-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}
          >
            Back to sign in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--p-border)', borderTopColor: 'var(--p-accent)', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14, color: 'var(--p-text-3)' }}>Signing you in with Google…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--p-text-3)' }}>Loading…</p>
      </div>
    }>
      <GoogleCallbackInner />
    </Suspense>
  )
}
