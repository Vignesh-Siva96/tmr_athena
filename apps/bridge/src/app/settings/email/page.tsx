'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface EmailConfig {
  imapUser: string | null
  imapPasswordSet: boolean
  smtpPasswordSet: boolean
  inboundEnabled: boolean
}

interface TestResult {
  imap: 'ok' | 'fail' | null
  smtp: 'ok' | 'fail' | null
  errors: string[]
}

const card: React.CSSProperties = {
  background: 'var(--d-surface)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-md)',
  padding: '24px',
  marginBottom: 20,
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--d-text-3)',
  marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--d-raised)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-sm)',
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--d-text)',
  boxSizing: 'border-box',
}

const btn = (variant: 'primary' | 'secondary' | 'ghost' = 'primary'): React.CSSProperties => ({
  height: 36,
  padding: '0 16px',
  borderRadius: 'var(--r-sm)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: variant === 'ghost' ? '1px solid var(--d-border)' : 'none',
  background: variant === 'primary' ? 'var(--d-accent)' : variant === 'secondary' ? 'var(--d-raised)' : 'transparent',
  color: variant === 'primary' ? '#fff' : 'var(--d-text)',
})

const StatusDot = ({ ok }: { ok: boolean | null }) => (
  <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6,
    background: ok === null ? 'var(--d-text-4)' : ok ? 'var(--d-success)' : 'var(--d-danger)',
  }} />
)

export default function EmailSettingsPage() {
  const { token } = useAuth()
  const [cfg, setCfg] = useState<EmailConfig | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    if (!token) return
    api.get<EmailConfig>('/config', token)
      .then((res) => {
        setCfg(res)
        setEmail(res.imapUser ?? '')
      })
      .catch(console.error)
  }, [token])

  const handleSave = async () => {
    if (!token || !email) return
    setSaving(true)
    try {
      await api.patch('/config', {
        imapUser: email,
        smtpUser: email,
        smtpFrom: email,
        ...(password ? { imapPassword: password, smtpPassword: password } : {}),
        inboundEnabled: true,
      }, token)
      setSaved(true)
      setPassword('')
      // Refresh config to update `(set)` indicators
      const fresh = await api.get<EmailConfig>('/config', token)
      setCfg(fresh)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!token || !email || !password) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post<{ imap: 'ok' | 'fail'; smtp: 'ok' | 'fail'; errors: string[] }>(
        '/config/email/test',
        {
          imapHost: 'imap.gmail.com',
          imapPort: 993,
          imapUser: email,
          imapPassword: password,
          imapUseTls: true,
          smtpHost: 'smtp.gmail.com',
          smtpPort: 587,
          smtpUser: email,
          smtpPassword: password,
        },
        token,
      )
      setTestResult(res)
    } catch {
      setTestResult({ imap: 'fail', smtp: 'fail', errors: ['Request failed'] })
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!token) return
    setDisconnecting(true)
    try {
      await api.delete('/config/email', token)
      setShowDisconnectConfirm(false)
      setEmail('')
      setPassword('')
      setTestResult(null)
      setSaved(false)
      const fresh = await api.get<EmailConfig>('/config', token)
      setCfg(fresh)
    } catch (err) {
      console.error(err)
    } finally {
      setDisconnecting(false)
    }
  }

  if (!cfg) return <div style={{ color: 'var(--d-text-3)', padding: 32 }}>Loading…</div>

  const isConfigured = cfg.imapUser && cfg.imapPasswordSet && cfg.inboundEnabled

  return (
    <div style={{ maxWidth: 580 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px' }}>Support inbox</h1>
        <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>
          Connect the email address your customers write to. We&apos;ll send and receive support mail from this inbox.
        </p>
      </div>

      <div style={card}>
        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>Support email address</span>
          <input
            style={inputStyle}
            type="email"
            placeholder="support@yourcompany.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSaved(false) }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={labelStyle}>
            App password {cfg.imapPasswordSet && <span style={{ fontWeight: 400, color: 'var(--d-text-4)' }}>(set — leave blank to keep)</span>}
          </span>
          <input
            style={inputStyle}
            type="password"
            placeholder={cfg.imapPasswordSet ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setSaved(false) }}
          />
        </div>

        <div style={{
          fontSize: 12,
          color: 'var(--d-text-3)',
          background: 'var(--d-raised)',
          borderRadius: 'var(--r-sm)',
          padding: '10px 12px',
          lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--d-text-2)' }}>Tip:</strong> Gmail requires an{' '}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--d-accent)', textDecoration: 'underline' }}
          >
            app password
          </a>
          {' '}— your normal password won&apos;t work. This same email and password are used to both
          send replies and receive customer mail.
        </div>

        {isConfigured && (
          <div style={{ fontSize: 12, color: 'var(--d-text-3)', marginTop: 12 }}>
            <StatusDot ok={true} />
            Inbox connected — listening for new mail
          </div>
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div style={{ ...card, background: 'var(--d-raised)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', marginBottom: 8 }}>Connection test</div>
          <div style={{ display: 'flex', gap: 24, marginBottom: testResult.errors.length ? 12 : 0 }}>
            <div style={{ fontSize: 13 }}>
              <StatusDot ok={testResult.imap === 'ok'} />
              Receiving: <strong>{testResult.imap === 'ok' ? 'Connected' : 'Failed'}</strong>
            </div>
            <div style={{ fontSize: 13 }}>
              <StatusDot ok={testResult.smtp === 'ok'} />
              Sending: <strong>{testResult.smtp === 'ok' ? 'Connected' : 'Failed'}</strong>
            </div>
          </div>
          {testResult.errors.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--d-danger)', fontFamily: 'monospace' }}>
              {testResult.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={btn('primary')} onClick={handleSave} disabled={saving || !email}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        <button style={btn('ghost')} onClick={handleTest} disabled={testing || !email || !password}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {isConfigured && (
          <button
            type="button"
            onClick={() => setShowDisconnectConfirm(true)}
            style={{
              marginLeft: 'auto',
              fontSize: 13,
              color: 'var(--d-danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '8px 12px',
            }}
          >
            Disconnect
          </button>
        )}
      </div>

      {showDisconnectConfirm && (
        <div
          onClick={() => !disconnecting && setShowDisconnectConfirm(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 440,
              background: 'var(--d-surface)',
              border: '1px solid var(--d-border)',
              borderRadius: 'var(--r-md)',
              padding: 24,
              boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 10px' }}>
              Disconnect support inbox?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', lineHeight: 1.6, margin: '0 0 8px' }}>
              We&apos;ll stop receiving new customer emails and stop sending replies from this address.
              Existing tickets and messages stay intact.
            </p>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', lineHeight: 1.6, margin: '0 0 20px' }}>
              The stored email and app password will be cleared. You&apos;ll need to re-enter them to reconnect.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                style={btn('ghost')}
                onClick={() => setShowDisconnectConfirm(false)}
                disabled={disconnecting}
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleDisconnect() }}
                disabled={disconnecting}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: disconnecting ? 'not-allowed' : 'pointer',
                  border: 'none',
                  background: 'var(--d-danger)',
                  color: '#fff',
                  opacity: disconnecting ? 0.7 : 1,
                }}
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
