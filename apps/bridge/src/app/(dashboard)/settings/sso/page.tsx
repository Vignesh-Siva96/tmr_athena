'use client'
import { useState, useEffect } from 'react'
import { Link2, Check, X, Loader2, Copy, CheckCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface AppConfig {
  ssoEnabled: boolean
  ssoSecretSet: boolean
}

export default function SsoSettingsPage() {
  const { token } = useAuth()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [secretInput, setSecretInput] = useState('')
  const [showSecretInput, setShowSecretInput] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadConfig = async () => {
    if (!token) return
    const cfg = await api.get<AppConfig>('/config', token)
    setConfig(cfg)
  }

  useEffect(() => { void loadConfig() }, [token])

  const save = async (patch: Partial<AppConfig & { ssoSecretEnc?: string }>) => {
    if (!token || !config) return
    setSaving(true)
    try {
      await api.patch('/config', patch, token)
      setConfig({ ...config, ...patch, ssoSecretSet: patch.ssoSecretEnc ? true : config.ssoSecretSet })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const saveSecret = async () => {
    if (!secretInput.trim()) return
    await save({ ssoSecretEnc: secretInput.trim() })
    setSecretInput('')
    setShowSecretInput(false)
  }

  const clearSecret = async () => {
    await save({ ssoSecretEnc: '' })
    setConfig((c) => c ? { ...c, ssoSecretSet: false } : c)
  }

  const copySnippet = async () => {
    await navigator.clipboard.writeText(NODE_SNIPPET)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--d-text-3)' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--d-surface)',
    border: '1px solid var(--d-border)',
    borderRadius: 10,
    padding: 24,
    marginBottom: 20,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--d-raised)',
    border: '1px solid var(--d-border)',
    borderRadius: 6,
    color: 'var(--d-text)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  const btnStyle: React.CSSProperties = {
    padding: '7px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: '1px solid var(--d-border)',
    background: 'var(--d-raised)',
    color: 'var(--d-text)',
  }

  const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: 'var(--d-accent)',
    color: '#fff',
    border: 'none',
  }

  const helperText: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--d-text-4)',
    marginTop: 4,
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Link2 size={20} style={{ color: 'var(--d-accent)' }} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--d-text)' }}>Embedded Portal (SSO)</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--d-text-3)' }}>Let users arrive in the support portal already authenticated from your app</p>
        </div>
        {(saving || saved) && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: saved ? 'var(--d-success)' : 'var(--d-text-3)' }}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
            {saving ? 'Saving…' : 'Saved'}
          </div>
        )}
      </div>

      {/* Enable / Disable */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Enable SSO handoff</h2>
            <p style={{ ...helperText, marginTop: 0 }}>
              When enabled, your app can deep-link users directly into the portal with a signed token.
            </p>
          </div>
          <button
            onClick={() => void save({ ssoEnabled: !config.ssoEnabled })}
            style={{
              ...btnStyle,
              background: config.ssoEnabled ? 'var(--d-accent)' : 'var(--d-raised)',
              color: config.ssoEnabled ? '#fff' : 'var(--d-text)',
              border: config.ssoEnabled ? 'none' : '1px solid var(--d-border)',
              minWidth: 80,
              flexShrink: 0,
            }}
          >
            {config.ssoEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Shared secret */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Shared secret</h2>
        <p style={{ ...helperText, marginBottom: 16 }}>
          Your backend signs handoff tokens with this secret (HS256). Store it securely — never expose it client-side.
        </p>
        {showSecretInput ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="password"
              placeholder="Paste a new shared secret"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveSecret() }}
              style={{ ...inputStyle, flex: 1 }}
              autoFocus
            />
            <button style={primaryBtnStyle} onClick={() => void saveSecret()}>Save</button>
            <button style={btnStyle} onClick={() => { setShowSecretInput(false); setSecretInput('') }}>
              <X size={13} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ ...inputStyle, flex: 1, color: 'var(--d-text-3)', display: 'flex', alignItems: 'center' }}>
              {config.ssoSecretSet ? '•••• •••• •••• ••••' : 'Not set'}
            </div>
            <button style={btnStyle} onClick={() => setShowSecretInput(true)}>
              {config.ssoSecretSet ? 'Replace' : 'Set'}
            </button>
            {config.ssoSecretSet && (
              <button style={{ ...btnStyle, color: 'var(--d-danger)' }} onClick={() => void clearSecret()}>
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Integration snippet */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Integration guide</h2>
        <p style={{ ...helperText, marginBottom: 16 }}>
          Mint a short-lived token on your backend and link your users directly to the portal.
          The token is consumed on first use and expires in 120 seconds.
        </p>

        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-3)', marginBottom: 8 }}>
            1. Install <code style={{ fontFamily: 'monospace', background: 'var(--d-raised)', padding: '1px 4px', borderRadius: 3 }}>jsonwebtoken</code> in your backend
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-3)', marginBottom: 8, marginTop: 16 }}>
            2. Mint a handoff token (Node.js example)
          </p>
          <div style={{ position: 'relative' }}>
            <pre style={{
              margin: 0,
              padding: '14px 16px',
              background: 'var(--d-raised)',
              borderRadius: 8,
              border: '1px solid var(--d-border)',
              fontSize: 12,
              color: 'var(--d-text-2)',
              overflowX: 'auto',
              fontFamily: 'monospace',
              lineHeight: 1.6,
            }}>
              {NODE_SNIPPET}
            </pre>
            <button
              onClick={() => void copySnippet()}
              style={{
                position: 'absolute', top: 8, right: 8,
                ...btnStyle, padding: '4px 8px', fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div style={{ padding: 12, background: 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)' }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--d-danger)', fontWeight: 500 }}>
            Security checklist
          </p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12, color: 'var(--d-text-3)', lineHeight: 1.8 }}>
            <li>Mint tokens <strong>server-side only</strong> — never in browser JavaScript.</li>
            <li>Keep TTL short (≤120 seconds). Each token is single-use.</li>
            <li>Serve the portal over <strong>HTTPS only</strong>.</li>
            <li>Rotate the shared secret immediately if it is ever exposed.</li>
          </ul>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const NODE_SNIPPET = `import { sign } from 'jsonwebtoken'
import { randomUUID } from 'crypto'

const PORTAL_SSO_SECRET = process.env.PORTAL_SSO_SECRET // shared with the portal

function mintSsoToken(user: { id: string; email: string; name?: string }) {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      email: user.email,
      name:  user.name,
      externalId: user.id,  // stable host user ID
      iat: now,
      exp: now + 120,       // 2-minute window
      jti: randomUUID(),    // single-use nonce
    },
    PORTAL_SSO_SECRET,
    { algorithm: 'HS256' }
  )
}

// Render a "Support" CTA in your UI:
// const url = \`https://<portal>/auth/sso?token=\${mintSsoToken(currentUser)}\``
