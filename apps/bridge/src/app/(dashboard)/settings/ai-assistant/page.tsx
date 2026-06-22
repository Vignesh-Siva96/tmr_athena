'use client'
import { useState, useEffect, useRef } from 'react'
import { Bot, BookOpen, RefreshCw, Plus, Trash2, RotateCcw, Check, X, Loader2, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppConfig {
  botProvider: string | null
  kbRootUrl: string | null
  kbPhase: string
  kbScanPagesSeen: number
  kbScanChunkCount: number
  kbScanTokenEstimate: number
  kbScanCostUsd: string | null
  kbEmbedChunksDone: number
  kbEmbedChunksTotal: number
  kbError: string | null
  kbLastRecrawledAt: string | null
  botKeySet: boolean
}

interface KbSource {
  id: string
  url: string
  title: string | null
  status: string
  errorMessage: string | null
  fetchedAt: string | null
  indexedAt: string | null
  chunkCount: number
}

interface KbStatus {
  kbPhase: string
  kbScanPagesSeen: number
  kbScanChunkCount: number
  kbScanTokenEstimate: number
  kbScanCostUsd: string | null
  kbEmbedChunksDone: number
  kbEmbedChunksTotal: number
  kbError: string | null
  kbLastRecrawledAt: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  INDEXED: 'Ready',
  SCANNED: 'Scanned',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
  PENDING: 'Processing',
  FETCHED: 'Processing',
}

function sourceStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function SourceStatusIcon({ status }: { status: string }) {
  if (status === 'INDEXED') return <span style={{ color: 'var(--d-success)', fontSize: 12 }}>✓</span>
  if (status === 'SCANNED') return <span style={{ color: 'var(--d-accent)', fontSize: 12 }}>◎</span>
  if (status === 'SKIPPED') return <span style={{ color: 'var(--d-text-4)', fontSize: 12 }}>⊘</span>
  if (status === 'FAILED') return <span style={{ color: 'var(--d-danger)', fontSize: 12 }}>✗</span>
  return <span style={{ color: 'var(--d-text-4)', fontSize: 12 }}>…</span>
}

function ProgressBar({ value, max, color = 'var(--d-accent)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 5
  return (
    <div style={{ flex: 1, background: 'var(--d-raised)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
      <div style={{ height: '100%', background: color, width: `${pct}%`, transition: 'width 0.4s' }} />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiAssistantPage() {
  const { token } = useAuth()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [kbStatus, setKbStatus] = useState<KbStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [sources, setSources] = useState<KbSource[]>([])
  const [sourcesTotal, setSourcesTotal] = useState(0)
  const [sourcesFilter, setSourcesFilter] = useState<string>('')
  const [sourcesSearch, setSourcesSearch] = useState('')
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [manualUrl, setManualUrl] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const loadConfig = async () => {
    if (!token) return
    const cfg = await api.get<AppConfig>('/config', token)
    setConfig(cfg)
  }

  const loadKbStatus = async () => {
    if (!token) return
    const s = await api.get<KbStatus>('/kb/status', token).catch(() => null)
    if (s) setKbStatus(s)
  }

  const loadSources = async () => {
    if (!token) return
    setSourcesLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' })
      if (sourcesFilter) params.set('status', sourcesFilter)
      if (sourcesSearch) params.set('search', sourcesSearch)
      const res = await api.get<{ items: KbSource[]; total: number }>(`/kb/sources?${params}`, token)
      setSources(res.items ?? [])
      setSourcesTotal(res.total ?? 0)
    } catch { /* ignore */ } finally {
      setSourcesLoading(false)
    }
  }

  useEffect(() => { void loadConfig() }, [token])
  useEffect(() => { void loadKbStatus() }, [token])
  useEffect(() => { void loadSources() }, [token, sourcesFilter, sourcesSearch])

  // Poll while scanning or embedding
  const activePhase = kbStatus?.kbPhase
  useEffect(() => {
    const busy = activePhase === 'SCANNING' || activePhase === 'EMBEDDING'
    if (busy) {
      pollRef.current = setInterval(async () => {
        if (!token) return
        const s = await api.get<KbStatus>('/kb/status', token).catch(() => null)
        if (s) setKbStatus(s)
        const isDone = s?.kbPhase !== 'SCANNING' && s?.kbPhase !== 'EMBEDDING'
        if (isDone) {
          if (pollRef.current) clearInterval(pollRef.current)
          void loadSources()
        }
      }, 3000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activePhase])

  const save = async (patch: Partial<AppConfig & { botApiKeyEnc?: string }>) => {
    if (!token || !config) return
    setSaving(true)
    try {
      await api.patch('/config', patch, token)
      setConfig({ ...config, ...patch })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return
    await save({ botApiKeyEnc: apiKeyInput.trim() })
    setApiKeyInput('')
    setShowApiKeyInput(false)
  }

  const startScan = async () => {
    if (!token) return
    await api.post('/kb/scan/start', {}, token)
    await loadKbStatus()
  }

  const cancelScan = async () => {
    if (!token) return
    await api.post('/kb/scan/cancel', {}, token)
    await loadKbStatus()
    await loadSources()
  }

  const confirmEmbed = async () => {
    if (!token) return
    await api.post('/kb/embed/confirm', {}, token)
    await loadKbStatus()
  }

  const addManualPage = async () => {
    if (!manualUrl.trim() || !token) return
    setAddingManual(true)
    try {
      await api.post('/kb/sources/manual', { url: manualUrl.trim() }, token)
      setManualUrl('')
      setTimeout(() => { void loadKbStatus(); void loadSources() }, 1500)
    } catch { /* ignore */ } finally {
      setAddingManual(false)
    }
  }

  const reindexSource = async (id: string) => {
    if (!token) return
    await api.post(`/kb/sources/${id}/reindex`, {}, token)
    await loadSources()
  }

  const deleteSource = async (id: string) => {
    if (!token) return
    await api.delete(`/kb/sources/${id}`, token)
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  const clearIndex = async () => {
    if (!token) return
    await api.delete('/kb/index', token)
    setSources([])
    setSourcesTotal(0)
    setShowClearConfirm(false)
    await loadKbStatus()
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--d-text-3)' }} />
      </div>
    )
  }

  const phase = kbStatus?.kbPhase ?? 'IDLE'

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
    marginBottom: 0,
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={20} style={{ color: '#8B5CF6' }} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--d-text)' }}>AI Assistant</h1>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--d-text-3)' }}>Configure Athena — the AI first-responder bot</p>
        </div>
        {(saving || saved) && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: saved ? 'var(--d-success)' : 'var(--d-text-3)' }}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
            {saving ? 'Saving…' : 'Saved'}
          </div>
        )}
      </div>

      {/* Card 1: AI Assistant */}
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>AI Assistant</h2>
        <p style={{ ...helperText, marginBottom: 16 }}>Athena uses this provider to read your help center and answer customer questions.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Provider</label>
            <select
              value={config.botProvider ?? 'GEMINI'}
              onChange={(e) => void save({ botProvider: e.target.value as 'GEMINI' })}
              style={{ ...inputStyle }}
            >
              <option value="GEMINI">Gemini (Google)</option>
              <option value="OPENAI" disabled>OpenAI (coming soon)</option>
              <option value="ANTHROPIC" disabled>Anthropic (coming soon)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>API Key</label>
            {showApiKeyInput ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="password"
                  placeholder="Enter API key"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveApiKey() }}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button style={primaryBtnStyle} onClick={() => void saveApiKey()}>Save</button>
                <button style={btnStyle} onClick={() => { setShowApiKeyInput(false); setApiKeyInput('') }}>
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ ...inputStyle, flex: 1, color: 'var(--d-text-3)', display: 'flex', alignItems: 'center' }}>
                  {config.botKeySet ? '•••• •••• •••• ••••' : 'Not set'}
                </div>
                <button style={btnStyle} onClick={() => setShowApiKeyInput(true)}>
                  {config.botKeySet ? 'Update' : 'Set'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card 2: Help Center Knowledge */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <BookOpen size={16} style={{ color: 'var(--d-text-3)' }} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>Help Center Knowledge</h2>
        </div>
        <p style={{ ...helperText, marginBottom: 16 }}>Athena reads your help center to answer questions. Scan documents first, review the estimated cost, then confirm to make them searchable.</p>

        {/* Root URL */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Help center URL</label>
          <input
            style={{ ...inputStyle }}
            placeholder="https://docs.example.com/help/"
            value={config.kbRootUrl ?? ''}
            onChange={(e) => setConfig({ ...config, kbRootUrl: e.target.value })}
            onBlur={() => void save({ kbRootUrl: config.kbRootUrl ?? null })}
          />
        </div>

        {/* Phase-aware status area */}
        <KbPhasePanel
          phase={phase}
          kbStatus={kbStatus}
          onScanStart={() => void startScan()}
          onScanCancel={() => void cancelScan()}
          onEmbedConfirm={() => void confirmEmbed()}
          btnStyle={btnStyle}
          primaryBtnStyle={primaryBtnStyle}
        />

        {/* Add a single page manually */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Add a single page</label>
          <div style={{ display: 'flex', gap: 6, maxWidth: 480 }}>
            <input
              style={{ ...inputStyle, flex: 1, fontSize: 12 }}
              placeholder="Paste a URL to scan and add"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addManualPage() }}
            />
            <button style={primaryBtnStyle} onClick={() => void addManualPage()} disabled={addingManual || !manualUrl.trim()}>
              {addingManual ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
            </button>
          </div>
        </div>

        {/* Documents table */}
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { value: '', label: 'All' },
                { value: 'INDEXED', label: 'Ready' },
                { value: 'SCANNED', label: 'Scanned' },
                { value: 'FAILED', label: 'Failed' },
              ].map((f) => (
                <button
                  key={f.value}
                  style={{
                    ...btnStyle,
                    padding: '4px 10px',
                    fontSize: 11,
                    background: sourcesFilter === f.value ? 'var(--d-accent)' : 'var(--d-raised)',
                    color: sourcesFilter === f.value ? '#fff' : 'var(--d-text-2)',
                    border: sourcesFilter === f.value ? 'none' : '1px solid var(--d-border)',
                  }}
                  onClick={() => setSourcesFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-4)' }} />
              <input
                style={{ ...inputStyle, paddingLeft: 28, fontSize: 12 }}
                placeholder="Search URLs…"
                value={sourcesSearch}
                onChange={(e) => setSourcesSearch(e.target.value)}
              />
            </div>
            <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{sourcesTotal} pages</span>
            {!showClearConfirm ? (
              <button style={{ ...btnStyle, padding: '4px 10px', fontSize: 11, color: 'var(--d-danger)' }} onClick={() => setShowClearConfirm(true)}>
                Remove all documents
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--d-danger)' }}>Remove all?</span>
                <button style={{ ...primaryBtnStyle, background: '#EF4444', padding: '4px 10px', fontSize: 11 }} onClick={() => void clearIndex()}>Confirm</button>
                <button style={{ ...btnStyle, padding: '4px 10px', fontSize: 11 }} onClick={() => setShowClearConfirm(false)}>Cancel</button>
              </div>
            )}
          </div>

          {sourcesLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--d-text-3)' }} />
            </div>
          ) : sources.length === 0 ? (
            <p style={{ color: 'var(--d-text-4)', fontSize: 13, textAlign: 'center', padding: 24 }}>
              No documents yet. Click &ldquo;Scan documents&rdquo; to start.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['URL', 'Title', 'Status', 'Sections', 'Last updated', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--d-text-4)', fontWeight: 600, borderBottom: '1px solid var(--d-border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--d-border-2)' }}>
                    <td style={{ padding: '7px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--d-text-2)', textDecoration: 'none' }}>{s.url.replace(/^https?:\/\//, '')}</a>
                    </td>
                    <td style={{ padding: '7px 8px', color: 'var(--d-text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title ?? '—'}</td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      <SourceStatusIcon status={s.status} />
                      <span style={{ marginLeft: 4, color: 'var(--d-text-3)' }}>{sourceStatusLabel(s.status)}</span>
                    </td>
                    <td style={{ padding: '7px 8px', color: 'var(--d-text-2)', textAlign: 'right' }}>{s.chunkCount}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--d-text-4)', whiteSpace: 'nowrap' }}>
                      {s.indexedAt ? new Date(s.indexedAt).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          title="Refresh"
                          style={{ ...btnStyle, padding: '3px 7px', fontSize: 11 }}
                          onClick={() => void reindexSource(s.id)}
                        >
                          <RotateCcw size={11} />
                        </button>
                        <button
                          title="Delete"
                          style={{ ...btnStyle, padding: '3px 7px', fontSize: 11, color: 'var(--d-danger)' }}
                          onClick={() => void deleteSource(s.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── Phase panel ──────────────────────────────────────────────────────────────

function KbPhasePanel({
  phase,
  kbStatus,
  onScanStart,
  onScanCancel,
  onEmbedConfirm,
  btnStyle,
  primaryBtnStyle,
}: {
  phase: string
  kbStatus: KbStatus | null
  onScanStart: () => void
  onScanCancel: () => void
  onEmbedConfirm: () => void
  btnStyle: React.CSSProperties
  primaryBtnStyle: React.CSSProperties
}) {
  const costStr = kbStatus?.kbScanCostUsd
    ? `$${parseFloat(kbStatus.kbScanCostUsd).toFixed(4)}`
    : '< $0.01'

  if (phase === 'SCANNING') {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: 'var(--d-accent)' }} />
          <span style={{ fontSize: 13, color: 'var(--d-text-2)' }}>
            Scanning documents — {kbStatus?.kbScanPagesSeen ?? 0} pages found
          </span>
          <button style={{ ...btnStyle, marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }} onClick={onScanCancel}>
            Cancel
          </button>
        </div>
        <ProgressBar value={kbStatus?.kbScanPagesSeen ?? 0} max={Math.max(kbStatus?.kbScanPagesSeen ?? 0, 1)} />
      </div>
    )
  }

  if (phase === 'AWAITING_CONFIRM') {
    return (
      <div style={{ marginBottom: 20, padding: 16, background: 'rgba(59,130,246,0.07)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--d-text-2)', fontWeight: 500 }}>
          Ready to embed
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--d-text-3)' }}>
          Found <strong>{kbStatus?.kbScanPagesSeen ?? 0} pages</strong> ·{' '}
          <strong>{kbStatus?.kbScanChunkCount ?? 0} sections</strong> ·{' '}
          estimated cost <strong>{costStr}</strong>
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtnStyle} onClick={onEmbedConfirm}>
            Activate knowledge base
          </button>
          <button style={{ ...btnStyle, color: 'var(--d-text-3)' }} onClick={onScanCancel}>
            Discard scan
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'EMBEDDING') {
    const done = kbStatus?.kbEmbedChunksDone ?? 0
    const total = kbStatus?.kbEmbedChunksTotal ?? 0
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: '#8B5CF6' }} />
          <span style={{ fontSize: 13, color: 'var(--d-text-2)' }}>
            Activating knowledge base — {done}{total > 0 ? ` / ${total}` : ''} sections processed
          </span>
        </div>
        <ProgressBar value={done} max={total || 1} color="#8B5CF6" />
      </div>
    )
  }

  if (phase === 'DONE') {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: 'var(--d-success)' }}>
            <Check size={11} /> Documents ready
          </span>
          {kbStatus?.kbLastRecrawledAt && (
            <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>
              Last updated {new Date(kbStatus.kbLastRecrawledAt).toLocaleString()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtnStyle} onClick={onScanStart}>
            Scan documents
          </button>
          <button style={btnStyle} onClick={onScanStart}>
            <RefreshCw size={12} style={{ marginRight: 4 }} />
            Check for updates
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'FAILED') {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--d-danger)' }}>
            Error: {kbStatus?.kbError ?? 'Unknown error'}
          </span>
        </div>
        <button style={primaryBtnStyle} onClick={onScanStart}>
          Try again
        </button>
      </div>
    )
  }

  // IDLE or CANCELLED
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      <button style={primaryBtnStyle} onClick={onScanStart}>
        Scan documents
      </button>
    </div>
  )
}
