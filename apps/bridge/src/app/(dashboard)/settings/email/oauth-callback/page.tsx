'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'

function OAuthCallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, isLoading: authLoading } = useAuth()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (authLoading) return

    const oauthError = searchParams.get('oauth_error')
    if (oauthError) {
      setErrorMsg(oauthError === 'access_denied' ? 'You cancelled the authorisation.' : `OAuth error: ${oauthError}`)
      setStatus('error')
      return
    }

    // The backend callback already exchanged the code and redirected here with ?connected=1
    // Just forward to the settings page
    router.replace('/settings/email?connected=1')
  }, [authLoading, searchParams, token, router])

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--d-text)', marginBottom: 8 }}>Connection failed</h2>
          <p style={{ fontSize: 14, color: 'var(--d-text-3)', marginBottom: 24 }}>{errorMsg}</p>
          <button
            type="button"
            onClick={() => router.replace('/settings/email')}
            style={{ height: 36, padding: '0 20px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to Email settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--d-border)', borderTopColor: 'var(--d-accent)', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14, color: 'var(--d-text-3)' }}>Connecting email…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--d-text-3)' }}>Loading…</p>
      </div>
    }>
      <OAuthCallbackInner />
    </Suspense>
  )
}
