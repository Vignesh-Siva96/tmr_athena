'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { useEmailConfig } from '@/lib/useEmailConfig'
import { api } from '@/lib/api'
import { MethodPicker } from '@/components/settings/email/MethodPicker'
import { ArchiveProgressCard } from '@/components/dashboard/ArchiveProgressCard'

interface EmailConfig {
  oauthProvider: 'GOOGLE' | 'MICROSOFT' | null
  oauthEmail: string | null
  oauthConnected: boolean
}

const card: React.CSSProperties = {
  background: 'var(--d-surface)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-md)',
  padding: '24px',
  marginBottom: 20,
}

const btn = (variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary'): React.CSSProperties => ({
  height: 36,
  padding: '0 16px',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: variant === 'ghost' ? '1px solid var(--d-border)' : 'none',
  background: variant === 'primary' ? 'var(--d-accent)' : variant === 'danger' ? 'var(--d-danger)' : variant === 'secondary' ? 'var(--d-raised)' : 'transparent',
  color: variant === 'primary' || variant === 'danger' ? '#fff' : 'var(--d-text)',
  fontFamily: 'inherit',
})

const StatusDot = ({ ok }: { ok: boolean | null }) => (
  <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6,
    background: ok === null ? 'var(--d-text-4)' : ok ? 'var(--d-success)' : 'var(--d-danger)',
  }} />
)

type Mode = 'picker' | 'oauth-connected'

export default function EmailSettingsPage() {
  const { token, agent } = useAuth()
  const searchParams = useSearchParams()
  const { refresh: refreshEmailConfig } = useEmailConfig(token)

  const [cfg, setCfg] = useState<EmailConfig | null>(null)
  const [mode, setMode] = useState<Mode>('picker')
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)

  // Check for OAuth callback params
  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('oauth_error')
    if (connected === '1') {
      refreshEmailConfig()
      void loadConfig()
    }
    if (error) {
      setOauthError(decodeURIComponent(error))
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadConfig = async () => {
    if (!token) return
    try {
      const res = await api.get<EmailConfig>('/config', token)
      setCfg(res)
      if (res.oauthConnected) {
        setMode('oauth-connected')
      } else {
        setMode('picker')
      }
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (!token) return
    void loadConfig()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const startOAuth = async (provider: 'google' | 'microsoft') => {
    if (!token) return
    try {
      const res = await api.get<{ url: string }>(`/config/email/oauth/${provider}/start`, token)
      window.location.href = res.url
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : 'Failed to start OAuth flow')
    }
  }

  const handleDisconnect = async () => {
    if (!token) return
    setDisconnecting(true)
    try {
      await api.delete('/config/email/oauth/disconnect', token)
      setShowDisconnectConfirm(false)
      setMode('picker')
      refreshEmailConfig()
      await loadConfig()
    } catch (err) {
      console.error(err)
    } finally {
      setDisconnecting(false)
    }
  }

  if (!cfg) return <div style={{ color: 'var(--d-text-3)', padding: 32 }}>Loading…</div>

  const isAdmin = agent?.role === 'ADMIN'

  return (
    <div style={{ maxWidth: 580 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px' }}>Support inbox</h1>
        <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>
          Connect your Google or Microsoft mailbox. We&apos;ll import your email history and sync new messages in real time.
        </p>
      </div>

      {oauthError && (
        <div style={{ ...card, borderColor: 'var(--d-danger)', background: 'var(--d-danger-bg, rgba(239,68,68,0.08))', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-danger)' }}>OAuth connection failed</div>
          <div style={{ fontSize: 12, color: 'var(--d-text-3)', marginTop: 4 }}>{oauthError}</div>
          <button
            type="button"
            onClick={() => setOauthError(null)}
            style={{ marginTop: 10, fontSize: 12, color: 'var(--d-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* OAuth connected state */}
      {mode === 'oauth-connected' && cfg.oauthConnected && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <StatusDot ok={true} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)' }}>
              Connected via {cfg.oauthProvider === 'GOOGLE' ? 'Google' : 'Microsoft'}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 16 }}>
            Mailbox: <strong style={{ color: 'var(--d-text)' }}>{cfg.oauthEmail}</strong>
          </div>
          {token && (
            <ArchiveProgressCard token={token} />
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(true)}
              style={{ marginTop: 16, fontSize: 13, color: 'var(--d-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
            >
              Disconnect
            </button>
          )}
        </div>
      )}

      {/* Not connected: show method picker */}
      {mode === 'picker' && isAdmin && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)', marginBottom: 16 }}>Connect your mailbox</div>
          <MethodPicker
            onSelectGoogle={() => { void startOAuth('google') }}
            onSelectMicrosoft={() => { void startOAuth('microsoft') }}
          />
        </div>
      )}

      {mode === 'picker' && !isAdmin && (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--d-text-3)' }}>
            No email account connected yet. Ask your admin to connect one.
          </div>
        </div>
      )}

      {/* Disconnect confirm modal */}
      {showDisconnectConfirm && (
        <div
          onClick={() => !disconnecting && setShowDisconnectConfirm(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 440, background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 10px' }}>
              Disconnect support inbox?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', lineHeight: 1.6, margin: '0 0 8px' }}>
              We&apos;ll stop receiving new customer emails and stop sending replies from this address.
              Existing tickets and messages stay intact.
            </p>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
              OAuth tokens will be revoked.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={btn('ghost')} onClick={() => setShowDisconnectConfirm(false)} disabled={disconnecting}>
                Cancel
              </button>
              <button
                onClick={() => { void handleDisconnect() }}
                disabled={disconnecting}
                style={{ ...btn('danger'), opacity: disconnecting ? 0.7 : 1, cursor: disconnecting ? 'not-allowed' : 'pointer' }}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
