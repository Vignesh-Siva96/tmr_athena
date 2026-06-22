'use client'
import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

function GitHubCallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, isLoading: authLoading } = useAuth()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (authLoading) return // wait for localStorage read to complete

    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      setErrorMsg(error === 'access_denied' ? 'You cancelled the GitHub authorisation.' : `GitHub error: ${error}`)
      setStatus('error')
      return
    }

    if (!code) {
      setErrorMsg('No authorisation code received from GitHub.')
      setStatus('error')
      return
    }

    if (!token) {
      setErrorMsg('You must be signed in as an Admin to connect GitHub.')
      setStatus('error')
      return
    }

    let cancelled = false

    // Safety net — never spin forever
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setErrorMsg('Connection timed out. The server may not be running or the GitHub credentials may be misconfigured.')
        setStatus('error')
      }
    }, 15_000)

    api.post('/github/connect', { code }, token)
      .then(() => { if (!cancelled) router.replace('/settings/github') })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to connect GitHub.')
          setStatus('error')
        }
      })
      .finally(() => clearTimeout(timeout))

    return () => { cancelled = true; clearTimeout(timeout) }
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
            onClick={() => router.replace('/settings/github')}
            style={{ height: 36, padding: '0 20px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to GitHub settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--d-border)', borderTopColor: 'var(--d-accent)', animation: 'spin 0.7s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ fontSize: 14, color: 'var(--d-text-3)' }}>Connecting GitHub…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--d-text-3)' }}>Loading…</p>
      </div>
    }>
      <GitHubCallbackInner />
    </Suspense>
  )
}
