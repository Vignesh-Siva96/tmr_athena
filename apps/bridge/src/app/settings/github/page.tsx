'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Copy, Eye, EyeOff, RefreshCw, Github, ExternalLink, Tag, Webhook, AlertCircle, CheckCircle2, Lock, Search, GitBranch } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface WebhookConfig {
  hasSecret: boolean
  webhookVerifiedAt: string | null
  fixDeployedLabel: string
  pendingConfirmationLabel: string
}

interface GithubStatus {
  connected: boolean
  username?: string
  defaultRepo?: string
}

const OCTOCAT_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, #141414 0%, #1a1a1a 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--r-lg)',
  marginBottom: 20,
  overflow: 'hidden',
}

const cardHeaderStyle: React.CSSProperties = {
  padding: '18px 24px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--d-text-4)',
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
  marginBottom: 8,
}

export default function GithubSettingsPage() {
  const { token } = useAuth()
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [config, setConfig] = useState<WebhookConfig | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  // Secret states
  const [secretValue, setSecretValue] = useState<string | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [regenConfirm, setRegenConfirm] = useState(false)
  const [regenTimer, setRegenTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Copy state
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Label config
  const [fixLabel, setFixLabel] = useState('')
  const [pendingLabel, setPendingLabel] = useState('')
  const [isSavingLabels, setIsSavingLabels] = useState(false)
  const [labelsSaved, setLabelsSaved] = useState(false)

  // Setup instructions
  const [showInstructions, setShowInstructions] = useState(false)

  // Default repo
  const [defaultRepo, setDefaultRepo] = useState('')
  const [savedRepo, setSavedRepo] = useState('')
  const [isSavingRepo, setIsSavingRepo] = useState(false)
  const [repoSaved, setRepoSaved] = useState(false)
  const [repoConfirming, setRepoConfirming] = useState(false)
  const [repoConfirmTimer, setRepoConfirmTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Repo dropdown
  const [repos, setRepos] = useState<{ fullName: string; private: boolean; description: string | null }[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(() => {
    if (!token) return
    api.get<GithubStatus>('/github/status', token)
      .then((res) => {
        setStatus(res)
        setDefaultRepo(res.defaultRepo ?? '')
        setSavedRepo(res.defaultRepo ?? '')
      })
      .catch(console.error)
  }, [token])

  const handleSaveRepo = async () => {
    if (!token || !defaultRepo.trim()) return
    setIsSavingRepo(true)
    setRepoConfirming(false)
    try {
      await api.patch('/github/config', { defaultRepo: defaultRepo.trim() }, token)
      setSavedRepo(defaultRepo.trim())
      setRepoSaved(true)
      setTimeout(() => setRepoSaved(false), 2500)
    } catch (err) {
      console.error(err)
    } finally {
      setIsSavingRepo(false)
    }
  }

  const handleRepoSaveClick = () => {
    if (!defaultRepo.trim()) return
    if (!repoConfirming) {
      setRepoConfirming(true)
      const t = setTimeout(() => setRepoConfirming(false), 6000)
      setRepoConfirmTimer(t)
    } else {
      if (repoConfirmTimer) clearTimeout(repoConfirmTimer)
      void handleSaveRepo()
    }
  }

  const loadConfig = useCallback(() => {
    if (!token) return
    api.get<WebhookConfig>('/github/webhook-config', token)
      .then((res) => {
        setConfig(res)
        setFixLabel(res.fixDeployedLabel)
        setPendingLabel(res.pendingConfirmationLabel)
      })
      .catch(console.error)
  }, [token])

  useEffect(() => {
    loadStatus()
    loadConfig()
  }, [loadStatus, loadConfig])

  // Fetch repos once GitHub is confirmed connected
  useEffect(() => {
    if (!token || !status?.connected) return
    setReposLoading(true)
    api.get<{ repos: { fullName: string; private: boolean; description: string | null }[] }>('/github/repos', token)
      .then((res) => setRepos(res.repos))
      .catch(() => {}) // non-fatal — fall back to manual input
      .finally(() => setReposLoading(false))
  }, [token, status?.connected])

  // Close repo dropdown on outside click
  useEffect(() => {
    if (!repoDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (!repoDropdownRef.current?.contains(e.target as Node)) setRepoDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [repoDropdownOpen])

  const handleDisconnect = async () => {
    if (!token) return
    setIsDisconnecting(true)
    try {
      await api.delete('/github/connect', token)
      loadStatus()
    } catch (err) {
      console.error(err)
    } finally {
      setIsDisconnecting(false)
    }
  }

  const handleGenerateSecret = async () => {
    if (!token) return
    setIsGenerating(true)
    try {
      const res = await api.post<{ secret: string }>('/github/webhook-secret', {}, token)
      setSecretValue(res.secret)
      setConfig((prev) => prev ? { ...prev, hasSecret: true } : prev)
    } catch (err) {
      console.error(err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = () => {
    if (!regenConfirm) {
      setRegenConfirm(true)
      const t = setTimeout(() => setRegenConfirm(false), 3000)
      setRegenTimer(t)
    } else {
      if (regenTimer) clearTimeout(regenTimer)
      setRegenConfirm(false)
      void handleGenerateSecret()
    }
  }

  const handleReveal = () => {
    setIsRevealed(true)
    if (revealTimer) clearTimeout(revealTimer)
    const t = setTimeout(() => setIsRevealed(false), 10000)
    setRevealTimer(t)
  }

  const handleCopyUrl = async () => {
    const url = `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}/api/v1/github/webhook`
    await navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleSaveLabels = async () => {
    if (!token) return
    setIsSavingLabels(true)
    try {
      await api.patch('/github/webhook-config', {
        fixDeployedLabel: fixLabel,
        pendingConfirmationLabel: pendingLabel,
      }, token)
      setLabelsSaved(true)
      setTimeout(() => setLabelsSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setIsSavingLabels(false)
    }
  }

  const webhookUrl = `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}/api/v1/github/webhook`

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>GitHub</h1>
      <p style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 28 }}>Connect GitHub to link issues to support tickets and automate workflows.</p>

      {/* Section 1 — GitHub Connection */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <svg height="20" width="20" viewBox="0 0 16 16" fill="var(--d-text)">
            <path d={OCTOCAT_PATH} />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)', flex: 1 }}>GitHub Connection</span>
          {status?.connected ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, padding: '4px 12px',
              borderRadius: 999,
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.2)',
              color: '#86EFAC',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#86EFAC', flexShrink: 0 }} />
              Connected as @{status.username}
            </span>
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, padding: '4px 12px',
              borderRadius: 999,
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.2)',
              color: '#FCD34D',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FCD34D', flexShrink: 0 }} />
              Not connected
            </span>
          )}
        </div>

        <div style={{ padding: '20px 24px' }}>
          {status?.connected ? (
            <div>
              {/* Account row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 4px' }}>@{status.username}</p>
                  <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>GitHub OAuth is active · issues can be linked from tickets</p>
                </div>
                <button
                  type="button"
                  disabled={isDisconnecting}
                  onClick={() => { void handleDisconnect() }}
                  style={{ fontSize: 12, color: 'var(--d-danger)', background: 'none', border: 'none', cursor: isDisconnecting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: isDisconnecting ? 0.6 : 1 }}
                >
                  {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>

              {/* Default repository */}
              <div style={{ paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={sectionLabelStyle}>Default repository</p>
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', marginBottom: 12 }}>
                  Issues created from tickets will open here by default.
                </p>

                {/* Repo picker + save */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                  {/* Custom searchable dropdown */}
                  <div ref={repoDropdownRef} style={{ flex: 1, position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => { setRepoDropdownOpen((o) => !o); setRepoSearch('') }}
                      style={{
                        width: '100%', height: 36, padding: '0 12px',
                        background: '#0D0D0F',
                        border: `1px solid ${repoConfirming ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: 'var(--r-sm)', fontSize: 13,
                        color: defaultRepo ? 'var(--d-text)' : 'var(--d-text-4)',
                        fontFamily: defaultRepo ? 'var(--font-mono)' : 'inherit',
                        outline: 'none', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      <GitBranch size={13} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {defaultRepo || (reposLoading ? 'Loading repos…' : 'Select a repository…')}
                      </span>
                      {repoSaved && <span style={{ fontSize: 11, color: '#86EFAC', flexShrink: 0 }}>✓</span>}
                    </button>

                    {repoDropdownOpen && (
                      <div style={{
                        position: 'absolute', top: 40, left: 0, right: 0, zIndex: 50,
                        background: 'var(--d-raised-2)', border: '1px solid var(--d-border)',
                        borderRadius: 'var(--r-md)', overflow: 'hidden',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                      }}>
                        {/* Search box */}
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--d-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Search size={12} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
                          <input
                            autoFocus
                            value={repoSearch}
                            onChange={(e) => setRepoSearch(e.target.value)}
                            placeholder="Search repos…"
                            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 12, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
                          />
                        </div>
                        {/* List */}
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                          {repos.length === 0 && !reposLoading && (
                            <p style={{ padding: '12px 14px', fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>
                              No repos found. Type a repo name manually.
                            </p>
                          )}
                          {repos
                            .filter((r) => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
                            .map((r) => (
                              <button
                                key={r.fullName}
                                type="button"
                                onClick={() => {
                                  setDefaultRepo(r.fullName)
                                  setRepoConfirming(false)
                                  setRepoDropdownOpen(false)
                                }}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                  padding: '9px 14px', border: 'none', textAlign: 'left',
                                  background: r.fullName === defaultRepo ? 'rgba(59,130,246,0.1)' : 'transparent',
                                  cursor: 'pointer', fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => { if (r.fullName !== defaultRepo) (e.currentTarget as HTMLButtonElement).style.background = 'var(--d-surface)' }}
                                onMouseLeave={(e) => { if (r.fullName !== defaultRepo) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                              >
                                {r.private
                                  ? <Lock size={12} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
                                  : <GitBranch size={12} style={{ color: 'var(--d-text-4)', flexShrink: 0 }} />
                                }
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 13, fontWeight: 500, color: r.fullName === defaultRepo ? 'var(--d-accent)' : 'var(--d-text)', margin: 0, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {r.fullName}
                                  </p>
                                  {r.description && (
                                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {r.description}
                                    </p>
                                  )}
                                </div>
                                {r.fullName === defaultRepo && <span style={{ fontSize: 10, color: 'var(--d-accent)', flexShrink: 0 }}>✓</span>}
                              </button>
                            ))
                          }
                        </div>
                        {/* Manual entry footer */}
                        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--d-border)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>Or type manually:</span>
                          <input
                            value={repoSearch.includes('/') ? repoSearch : ''}
                            onChange={(e) => setRepoSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && repoSearch.includes('/')) {
                                setDefaultRepo(repoSearch.trim())
                                setRepoDropdownOpen(false)
                              }
                            }}
                            placeholder="owner/repo"
                            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 12, color: 'var(--d-text)', outline: 'none', fontFamily: 'var(--font-mono)' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={isSavingRepo || !defaultRepo.trim()}
                    onClick={handleRepoSaveClick}
                    style={{
                      height: 36, padding: '0 16px', flexShrink: 0,
                      background: repoSaved ? 'rgba(34,197,94,0.15)' : repoConfirming ? 'rgba(245,158,11,0.15)' : defaultRepo.trim() ? 'var(--d-accent)' : 'var(--d-raised)',
                      color: repoSaved ? '#86EFAC' : repoConfirming ? '#FCD34D' : defaultRepo.trim() ? '#fff' : 'var(--d-text-4)',
                      border: repoSaved ? '1px solid rgba(34,197,94,0.3)' : repoConfirming ? '1px solid rgba(245,158,11,0.3)' : 'none',
                      borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
                      cursor: defaultRepo.trim() && !isSavingRepo ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 150ms',
                    }}
                  >
                    {repoSaved ? '✓ Saved' : isSavingRepo ? 'Saving…' : repoConfirming ? 'Confirm' : 'Save'}
                  </button>
                </div>

                {/* Confirmation strip */}
                {repoConfirming && (
                  <div style={{ padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 12, color: '#FCD34D', lineHeight: 1.5, marginBottom: 10 }}>
                    {savedRepo
                      ? <>Changing from <code style={{ fontFamily: 'var(--font-mono)' }}>{savedRepo}</code> → <code style={{ fontFamily: 'var(--font-mono)' }}>{defaultRepo.trim()}</code>. Already-linked issues are not affected.</>
                      : <>Issues created from tickets will open in <code style={{ fontFamily: 'var(--font-mono)' }}>{defaultRepo.trim()}</code>.</>
                    }
                  </div>
                )}

                {/* Improved info message */}
                {!repoConfirming && (
                  <div style={{ borderRadius: 'var(--r-md)', border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(59,130,246,0.07)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <GitBranch size={13} style={{ color: '#60A5FA', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#60A5FA' }}>What this repo is used for</span>
                    </div>
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>✅</span>
                        <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0, lineHeight: 1.5 }}>
                          When an agent clicks <strong style={{ color: 'var(--d-text-2)' }}>Create GitHub issue</strong> on a ticket, the issue opens in this repo.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>
                        <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0, lineHeight: 1.5 }}>
                          <strong style={{ color: 'var(--d-text-2)' }}>This does not set up webhooks.</strong> To receive label events (like <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>fix-deployed</code>), go to your repo on GitHub → <strong style={{ color: 'var(--d-text-2)' }}>Settings → Webhooks</strong> → add the webhook URL from the section below.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 16 }}>
                Link your GitHub account to create and link issues directly from tickets.
              </p>
              <button
                type="button"
                onClick={() => {
                  const clientId = process.env['NEXT_PUBLIC_GITHUB_CLIENT_ID']
                  if (!clientId) {
                    alert('NEXT_PUBLIC_GITHUB_CLIENT_ID is not set in your .env file.')
                    return
                  }
                  const params = new URLSearchParams({
                    client_id: clientId,
                    scope: 'repo',
                    redirect_uri: `${window.location.origin}/settings/github/callback`,
                  })
                  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`
                }}
                style={{
                  height: 36, padding: '0 18px',
                  background: '#24292e', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontFamily: 'inherit',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none' }}
              >
                <Github size={15} /> Connect with GitHub
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Section 2 — Webhook Configuration */}
      {status?.connected && (
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <Webhook size={18} style={{ color: 'var(--d-text-3)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Webhook Configuration</span>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Sub-section A — Webhook URL */}
            <div>
              <p style={sectionLabelStyle}>Your webhook URL</p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 0,
                background: '#0D0D0F',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--r-sm)',
                overflow: 'hidden',
              }}>
                <code style={{
                  flex: 1, padding: '10px 14px',
                  fontSize: 12, fontFamily: 'var(--font-mono)',
                  color: 'var(--d-text-2)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => { void handleCopyUrl() }}
                  style={{
                    height: 40, padding: '0 14px',
                    background: 'rgba(255,255,255,0.04)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                    border: 'none',
                    cursor: 'pointer', color: copiedUrl ? '#86EFAC' : 'var(--d-text-3)',
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontFamily: 'inherit', flexShrink: 0,
                    transition: 'color 0.15s',
                  }}
                >
                  {copiedUrl ? <><CheckCircle2 size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--d-text-4)', marginTop: 6 }}>
                Paste this as the Payload URL in your GitHub webhook settings
              </p>
            </div>

            {/* Sub-section B — Webhook Secret */}
            <div>
              <p style={sectionLabelStyle}>Webhook secret</p>
              {!config?.hasSecret && !secretValue ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  borderRadius: 'var(--r-sm)',
                }}>
                  <AlertCircle size={15} style={{ color: '#FCD34D', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#FCD34D', flex: 1 }}>
                    No secret configured. Generate one to secure your webhook.
                  </span>
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => { void handleGenerateSecret() }}
                    style={{
                      height: 30, padding: '0 12px',
                      background: 'rgba(245,158,11,0.15)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: 'var(--r-sm)',
                      color: '#FCD34D', fontSize: 12, fontWeight: 600,
                      cursor: isGenerating ? 'wait' : 'pointer',
                      fontFamily: 'inherit', flexShrink: 0,
                    }}
                  >
                    {isGenerating ? 'Generating…' : 'Generate secret'}
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    background: '#0D0D0F',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--r-sm)',
                    overflow: 'hidden',
                    marginBottom: 8,
                  }}>
                    <code style={{
                      flex: 1, padding: '10px 14px',
                      fontSize: 13, fontFamily: 'var(--font-mono)',
                      color: 'var(--d-text-2)',
                      letterSpacing: isRevealed ? 0 : '0.15em',
                    }}>
                      {isRevealed && secretValue ? secretValue : '••••••••••••••••••••••••'}
                    </code>
                    <div style={{ display: 'flex', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                      <button
                        type="button"
                        onClick={isRevealed ? () => { if (revealTimer) clearTimeout(revealTimer); setIsRevealed(false) } : handleReveal}
                        style={{
                          height: 40, padding: '0 12px',
                          background: 'rgba(255,255,255,0.04)',
                          border: 'none', borderRight: '1px solid rgba(255,255,255,0.08)',
                          cursor: 'pointer', color: 'var(--d-text-3)',
                          display: 'flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontFamily: 'inherit',
                        }}
                      >
                        {isRevealed ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Reveal</>}
                      </button>
                      <button
                        type="button"
                        disabled={isGenerating}
                        onClick={handleRegenerate}
                        style={{
                          height: 40, padding: '0 12px',
                          background: regenConfirm ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)',
                          border: 'none',
                          cursor: isGenerating ? 'wait' : 'pointer',
                          color: regenConfirm ? '#FCA5A5' : 'var(--d-text-3)',
                          display: 'flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
                        }}
                      >
                        <RefreshCw size={13} className={isGenerating ? 'spin' : ''} />
                        {regenConfirm ? 'Click again to confirm' : 'Regenerate'}
                      </button>
                    </div>
                  </div>

                  {/* Verification status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {config?.webhookVerifiedAt ? (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#86EFAC', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--d-text-3)' }}>
                          Verified · last received{' '}
                          <span style={{ color: '#86EFAC' }}>
                            {new Date(config.webhookVerifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FCD34D', flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>Not yet verified — paste the URL and secret into GitHub to verify</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sub-section C — Setup instructions */}
            <div>
              <button
                type="button"
                onClick={() => setShowInstructions((v) => !v)}
                style={{
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--d-text-3)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', padding: 0,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                Setup instructions
                <span style={{ fontSize: 10, transition: 'transform 0.15s', display: 'inline-block', transform: showInstructions ? 'rotate(180deg)' : 'none' }}>▾</span>
              </button>
              {showInstructions && (
                <div style={{
                  marginTop: 14, padding: '16px 20px',
                  background: '#0D0D0F',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 'var(--r-sm)',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  {[
                    { n: 1, text: <>Go to your GitHub repo → <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>Settings → Webhooks → Add webhook</code></> },
                    { n: 2, text: <>Paste the URL above as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>"Payload URL"</code></> },
                    { n: 3, text: <>Paste the secret above as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>"Secret"</code></> },
                    { n: 4, text: <>Set Content type to: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>application/json</code></> },
                    { n: 5, text: <>Under &ldquo;Which events would you like to trigger this webhook?&rdquo;<br />Select <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>&ldquo;Let me select individual events&rdquo;</code> → check <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>&ldquo;Issues&rdquo;</code> only</> },
                    { n: 6, text: <>Click <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--d-text-2)' }}>&ldquo;Add webhook&rdquo;</code></> },
                  ].map(({ n, text }) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)',
                        color: 'var(--d-accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, marginTop: 1,
                      }}>
                        {n}
                      </span>
                      <p style={{ fontSize: 13, color: 'var(--d-text-2)', margin: 0, lineHeight: 1.6 }}>{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 3 — Label Configuration */}
      {status?.connected && (
        <div style={cardStyle}>
          <div style={cardHeaderStyle}>
            <Tag size={18} style={{ color: 'var(--d-text-3)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Label Configuration</span>
          </div>

          <div style={{ padding: '20px 24px' }}>
            <p style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 20 }}>
              When a GitHub issue gets these labels, TMR Support reacts automatically.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
              {/* Row 1 — Fix Deployed */}
              <div style={{
                padding: '16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 'var(--r-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <input
                    value={fixLabel}
                    onChange={(e) => setFixLabel(e.target.value)}
                    style={{
                      flex: 1, height: 34, padding: '0 12px',
                      background: '#0D0D0F',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 'var(--r-sm)',
                      fontSize: 13, fontFamily: 'var(--font-mono)',
                      color: 'var(--d-text)',
                      outline: 'none',
                    }}
                  />
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12, fontWeight: 600,
                    background: 'rgba(34,197,94,0.12)',
                    border: '1px solid rgba(34,197,94,0.3)',
                    color: '#86EFAC',
                    flexShrink: 0,
                  }}>
                    {fixLabel || 'fix-deployed'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0, lineHeight: 1.5 }}>
                  Triggers a notification to all agents to reply to the customer
                </p>
              </div>

              {/* Row 2 — Pending Confirmation */}
              <div style={{
                padding: '16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 'var(--r-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <input
                    value={pendingLabel}
                    onChange={(e) => setPendingLabel(e.target.value)}
                    style={{
                      flex: 1, height: 34, padding: '0 12px',
                      background: '#0D0D0F',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 'var(--r-sm)',
                      fontSize: 13, fontFamily: 'var(--font-mono)',
                      color: 'var(--d-text)',
                      outline: 'none',
                    }}
                  />
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12, fontWeight: 600,
                    background: 'rgba(245,158,11,0.12)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    color: '#FCD34D',
                    flexShrink: 0,
                  }}>
                    {pendingLabel || 'pending-customer-confirmation'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0, lineHeight: 1.5 }}>
                  Added by agents after replying — tells the team this is awaiting customer response
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <button
                type="button"
                disabled={isSavingLabels}
                onClick={() => { void handleSaveLabels() }}
                style={{
                  height: 34, padding: '0 18px',
                  background: 'var(--d-accent)', color: '#fff',
                  border: 'none', borderRadius: 'var(--r-sm)',
                  fontSize: 13, fontWeight: 600,
                  cursor: isSavingLabels ? 'not-allowed' : 'pointer',
                  opacity: isSavingLabels ? 0.7 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {isSavingLabels ? 'Saving…' : 'Save label configuration'}
              </button>
              {labelsSaved && (
                <span style={{ fontSize: 12, color: '#86EFAC', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CheckCircle2 size={13} /> Saved ✓
                </span>
              )}
            </div>

            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0, lineHeight: 1.6 }}>
              Create these labels in your GitHub repo before using them. Labels are case-sensitive.{' '}
              <a
                href="https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--d-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                How to create GitHub labels <ExternalLink size={11} />
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
