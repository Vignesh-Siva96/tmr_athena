'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Cell,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiUsageData {
  today: { calls: number; totalTokens: number; costUsd: number }
  last30d: { calls: number; totalTokens: number; costUsd: number; errorRate: number }
  byOperation: { operation: string; calls: number; tokens: number; costUsd: number }[]
  dailyTrend: { day: string; costUsd: number; calls: number }[]
  recentErrors: {
    id: string; createdAt: string; operation: string; errorMessage: string | null
    ticketId: string | null; messageId: string | null
  }[]
}

// ─── Tooltip helpers ──────────────────────────────────────────────────────────

function CostTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null
  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: '0 0 4px', color: 'var(--d-text-2)', fontWeight: 600 }}>{label as string}</p>
      {payload.map((p: Record<string, unknown>) => (
        <p key={String(p.dataKey)} style={{ margin: '2px 0', color: p.color as string }}>
          {String(p.name)}: {p.dataKey === 'costUsd' ? `$${Number(p.value).toFixed(4)}` : String(p.value)}
        </p>
      ))}
    </div>
  )
}

const OP_COLORS: Record<string, string> = {
  SENTIMENT: '#3B82F6',
  TOPIC: '#A78BFA',
  CSAT: '#22C55E',
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiUsagePage() {
  const { token, agent } = useAuth()
  const [data, setData] = useState<AiUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api.get<AiUsageData>('/settings/ai-usage', token)
      .then(setData)
      .catch(() => setError('Failed to load AI usage data'))
      .finally(() => setLoading(false))
  }, [token])

  if (agent?.role !== 'ADMIN') {
    return <div style={{ padding: 40, color: 'var(--d-text-3)' }}>Admin access required.</div>
  }

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--d-text-3)' }}>Loading AI usage data…</div>
  }
  if (error || !data) {
    return <div style={{ padding: 40, color: 'var(--d-danger)' }}>{error ?? 'No data'}</div>
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, minHeight: '100vh', background: 'var(--d-bg)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px' }}>AI Usage &amp; Cost</h1>
      <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: '0 0 28px' }}>
        Gemini API consumption for sentiment analysis, topic classification, and CSAT inference.
      </p>

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: "Today's calls", value: data.today.calls.toLocaleString(), sub: `$${data.today.costUsd.toFixed(4)} today` },
          { label: 'Last 30d calls', value: data.last30d.calls.toLocaleString(), sub: `$${data.last30d.costUsd.toFixed(2)} total` },
          { label: 'Last 30d tokens', value: (data.last30d.totalTokens / 1000).toFixed(1) + 'K', sub: 'total tokens consumed' },
          { label: 'Error rate', value: `${data.last30d.errorRate}%`, sub: 'last 30 days', danger: data.last30d.errorRate > 5 },
        ].map(({ label, value, sub, danger }) => (
          <div key={label} style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px' }}>
            <p style={{ fontSize: 11, color: 'var(--d-text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>{label}</p>
            <p style={{ fontSize: 26, fontWeight: 700, color: danger ? 'var(--d-danger)' : 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.1 }}>{value}</p>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Daily cost trend ── */}
      <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 16px' }}>Daily cost trend (30 days)</p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.dailyTrend} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" vertical={false} />
            <XAxis dataKey="day" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={20} />
            <YAxis tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={v => `$${Number(v).toFixed(3)}`} width={52} />
            <Tooltip content={<CostTooltip />} />
            <Area type="monotone" dataKey="costUsd" name="Cost ($)" stroke="#3B82F6" fill="url(#costGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Per-operation breakdown ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 16px' }}>Calls by operation</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.byOperation} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} />
              <YAxis type="category" dataKey="operation" tick={{ fill: 'var(--d-text-3)', fontSize: 12 }} width={80} />
              <Tooltip content={<CostTooltip />} />
              <Bar dataKey="calls" name="Calls" radius={[0, 4, 4, 0]}>
                {data.byOperation.map(op => (
                  <Cell key={op.operation} fill={OP_COLORS[op.operation] ?? '#71717A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 16px' }}>Cost by operation (last 30d)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {data.byOperation.map(op => (
              <div key={op.operation} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: OP_COLORS[op.operation] ?? '#71717A', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--d-text-2)', width: 90 }}>{op.operation}</span>
                <div style={{ flex: 1, height: 6, background: 'var(--d-raised)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', background: OP_COLORS[op.operation] ?? '#71717A', borderRadius: 3,
                    width: `${Math.min(100, (op.costUsd / (data.last30d.costUsd || 0.0001)) * 100)}%`,
                  }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--d-text-4)', width: 60, textAlign: 'right' }}>${op.costUsd.toFixed(4)}</span>
              </div>
            ))}
            {data.byOperation.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--d-text-4)' }}>No data yet. Run the backfill script or resolve a ticket.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Recent errors ── */}
      <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 16px' }}>Recent errors</p>
        {data.recentErrors.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--d-success)', margin: 0 }}>No errors — all good.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--d-border)' }}>
                {['Time', 'Operation', 'Error'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--d-text-4)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recentErrors.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--d-border-2)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--d-text-3)', whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999, background: `${OP_COLORS[e.operation]}20`, color: OP_COLORS[e.operation] ?? '#71717A', fontWeight: 600 }}>
                      {e.operation}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', color: 'var(--d-danger)', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.errorMessage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
