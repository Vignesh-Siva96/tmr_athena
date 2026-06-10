'use client'
import { useState, useEffect } from 'react'
import { AlertTriangle, Heart, Zap, X, Info } from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalItem {
  id: string; quote: string; reason: string | null
  customerName: string; customerEmail: string
  ticketNumber: number; ticketTitle: string; createdAt: string
}

interface CustomerInsightsData {
  kpis: {
    avgSentiment30d: number | null; csatUser: number | null; csatAI: number | null
    atRiskCount: number; reopenRatePct: number; churnSignalsCount30d: number
  }
  sentimentTrend: { date: string; avgScore: number | null; msgCount: number }[]
  sentimentByLabel: { label: string; count: number }[]
  totalAnalyzed: number
  topTopics: { topicId: string; name: string; ticketCount: number; avgSentiment: number | null; deltaWoW: number | null }[]
  topicTrend: ({ date: string } & Record<string, number>)[]
  topicMeta: { id: string; name: string; ticketCount: number }[]
  emergingTopics: { topicId: string; name: string; ticketCount: number; deltaWoW: number | null }[]
  signals: { churnCount30d: number; advocacyCount30d: number; recentChurn: SignalItem[]; recentAdvocacy: SignalItem[] }
  effort: { avgScore30d: number | null; distribution: { score: number; count: number }[]; scatterVsCsat: { ticketId: string; csat: number; effort: number }[] }
  frictionByField2: { value: string; count: number }[]
  categoryMixOverTime: ({ date: string } & Record<string, number>)[]
  convoDepthByCategory: { category: string; avgDepth: number }[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPIC_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A78BFA', '#06B6D4', '#F97316', '#EC4899']

const CATEGORY_COLORS: Record<string, string> = {
  BUG_REPORT: '#EF4444', FEATURE_REQUEST: '#3B82F6', QUESTION: '#22C55E', BILLING: '#F59E0B', OTHER: '#71717A',
}
const CATEGORY_LABELS: Record<string, string> = {
  BUG_REPORT: 'Bug', FEATURE_REQUEST: 'Feature', QUESTION: 'Question', BILLING: 'Billing', OTHER: 'Other',
}

const SENTIMENT_COLORS: Record<string, string> = { POSITIVE: '#22C55E', NEUTRAL: '#F59E0B', NEGATIVE: '#EF4444' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sentimentColor(score: number | null) {
  if (score === null) return 'var(--d-text-4)'
  return score > 0.2 ? '#22C55E' : score < -0.2 ? '#EF4444' : '#F59E0B'
}
function sentimentLabel(score: number | null) {
  if (score === null) return '—'
  return score > 0.2 ? 'Positive' : score < -0.2 ? 'Negative' : 'Neutral'
}
function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  return h < 24 ? (h <= 0 ? 'just now' : `${h}h ago`) : `${Math.floor(h / 24)}d ago`
}
function pct(n: number, total: number) {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

// ─── Tooltip components ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: Record<string, unknown>) {
  if (!active || !Array.isArray(payload) || !payload.length) return null
  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: '0 0 4px', color: 'var(--d-text-2)', fontWeight: 600 }}>{label as string}</p>
      {payload.map((p: Record<string, unknown>) => (
        <p key={String(p.dataKey)} style={{ margin: '2px 0', color: (p.color as string) ?? 'var(--d-text-3)' }}>
          {String(p.name)}: {typeof p.value === 'number' ? (Number.isInteger(p.value) ? p.value : p.value.toFixed(2)) : String(p.value)}
        </p>
      ))}
    </div>
  )
}

// ─── InfoTooltip ──────────────────────────────────────────────────────────────

function InfoTooltip({ text, direction = 'up' }: { text: string; direction?: 'up' | 'down' }) {
  const [show, setShow] = useState(false)
  const vPos = direction === 'down' ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Info size={13} color="var(--d-text-4)" style={{ cursor: 'help', flexShrink: 0 }} />
      {show && (
        <div style={{
          position: 'absolute', ...vPos, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 7,
          padding: '7px 11px', fontSize: 11, color: 'var(--d-text-3)', width: 230,
          zIndex: 200, lineHeight: 1.55, pointerEvents: 'none', whiteSpace: 'normal',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

// ─── ChartTitle ───────────────────────────────────────────────────────────────

function ChartTitle({ title, info }: { title: string; info: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--d-text)', margin: 0 }}>{title}</p>
      <InfoTooltip text={info} />
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, info }: { label: string; value: string; sub?: string; color?: string; info: string }) {
  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <p style={{ fontSize: 11, color: 'var(--d-text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{label}</p>
        <InfoTooltip text={info} direction="down" />
      </div>
      <p style={{ fontSize: 26, fontWeight: 700, color: color ?? 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>{sub}</p>}
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--d-text)', margin: 0 }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: 'var(--d-border)' }} />
    </div>
  )
}

// ─── Signal Drawer ────────────────────────────────────────────────────────────

function SignalDrawer({ items, type, onClose }: { items: SignalItem[]; type: 'churn' | 'advocacy'; onClose: () => void }) {
  const color = type === 'churn' ? '#EF4444' : '#22C55E'
  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color, margin: 0 }}>{type === 'churn' ? 'Churn risk signals' : 'Advocacy signals'}</p>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--d-text-4)', padding: 4 }}><X size={14} /></button>
      </div>
      {items.length === 0 ? <p style={{ fontSize: 13, color: 'var(--d-text-4)', margin: 0 }}>No signals in this period.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
          {items.map(s => (
            <div key={s.id} style={{ padding: '10px 14px', background: 'var(--d-raised)', borderRadius: 8, borderLeft: `3px solid ${color}` }}>
              <p style={{ fontSize: 13, color: 'var(--d-text)', fontStyle: 'italic', margin: '0 0 6px' }}>"{s.quote}"</p>
              {s.reason && <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '0 0 6px' }}>{s.reason}</p>}
              <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>
                {s.customerName} · <a href={`/tickets/${s.ticketNumber}`} style={{ color: 'var(--d-accent)', textDecoration: 'none' }}>#{s.ticketNumber}</a> · {timeAgo(s.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sentiment chart (Chatbase-style) ─────────────────────────────────────────

function SentimentChart({ trend, byLabel, totalAnalyzed, avgScore }: {
  trend: { date: string; avgScore: number | null; msgCount: number }[]
  byLabel: { label: string; count: number }[]
  totalAnalyzed: number
  avgScore: number | null
}) {
  const hasData = totalAnalyzed > 0

  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
      <ChartTitle title="Sentiment trend (30 days)" info="Average customer message sentiment each day. Score −1 = very negative, +1 = very positive. Populated by AI after each customer reply." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 20, alignItems: 'start' }}>
        {/* Chart */}
        {!hasData ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>No sentiment data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} domain={[-1, 1]} tickFormatter={v => v.toFixed(1)} width={36} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="avgScore" name="Avg sentiment" stroke="#3B82F6" strokeWidth={2}
                dot={{ r: 3, fill: '#3B82F6', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
        {/* Right panel */}
        <div>
          <p style={{ fontSize: 26, fontWeight: 700, color: sentimentColor(avgScore), margin: '0 0 2px', lineHeight: 1 }}>
            {avgScore !== null ? avgScore.toFixed(2) : '—'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 16px' }}>Avg score (30d)</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {byLabel.map(r => (
              <div key={r.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: SENTIMENT_COLORS[r.label] ?? '#71717A', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--d-text-3)', textTransform: 'capitalize' }}>{r.label.toLowerCase()}</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{r.count} <span style={{ fontSize: 10 }}>({pct(r.count, totalAnalyzed)}%)</span></span>
                </div>
                <div style={{ height: 4, background: 'var(--d-raised)', borderRadius: 2 }}>
                  <div style={{ width: `${pct(r.count, totalAnalyzed)}%`, height: '100%', background: SENTIMENT_COLORS[r.label] ?? '#71717A', borderRadius: 2 }} />
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '4px 0 0' }}>{totalAnalyzed} messages analyzed</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Topic trend chart (Chatbase-style) ───────────────────────────────────────

function TopicTrendChart({ trend, meta, topTopics }: {
  trend: ({ date: string } & Record<string, number>)[]
  meta: { id: string; name: string; ticketCount: number }[]
  topTopics: { topicId: string; name: string; ticketCount: number; avgSentiment: number | null }[]
}) {
  const hasData = meta.length > 0
  const totalTopics = topTopics.length
  const totalTickets = topTopics.reduce((s, t) => s + t.ticketCount, 0)

  return (
    <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
      <ChartTitle title="Topics (30 days)" info="Daily ticket volume per AI-classified topic cluster. Topics are assigned when a ticket is resolved." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 20, alignItems: 'start' }}>
        {/* Chart */}
        {!hasData ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>No topic data yet — resolve a ticket to classify it</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} width={28} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              {meta.map((t, i) => (
                <Line key={t.id} type="monotone" dataKey={t.id} name={t.name}
                  stroke={TOPIC_COLORS[i % TOPIC_COLORS.length]}
                  strokeWidth={1.5} dot={{ r: 2.5, strokeWidth: 0, fill: TOPIC_COLORS[i % TOPIC_COLORS.length] }}
                  activeDot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        {/* Right panel */}
        <div>
          <p style={{ fontSize: 26, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 2px', lineHeight: 1 }}>{totalTopics}</p>
          <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 14px' }}>Total topics</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {topTopics.slice(0, 8).map((t, i) => (
              <div key={t.topicId} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: TOPIC_COLORS[i % TOPIC_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--d-text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.name}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0 }}>{t.ticketCount}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '10px 0 0' }}>{totalTickets} tickets total</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerInsightsPage() {
  const { token } = useAuth()
  const [data, setData] = useState<CustomerInsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openDrawer, setOpenDrawer] = useState<'churn' | 'advocacy' | null>(null)

  useEffect(() => {
    if (!token) return
    api.get<CustomerInsightsData>('/analytics/customers', token)
      .then(setData)
      .catch(() => setError('Failed to load customer insights'))
      .finally(() => setLoading(false))
  }, [token])

  const hasAiData = data ? (data.kpis.avgSentiment30d !== null || data.kpis.csatAI !== null) : false

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, letterSpacing: '-0.01em' }}>Customer Insights</h1>
            <span style={{ fontSize: 13, color: 'var(--d-text-3)', fontWeight: 400 }}>
              Voice of the customer, satisfaction trends
              {!hasAiData && ' — run the backfill script to populate AI analytics'}
            </span>
          </div>
        </header>

        {loading && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-3)' }}>Loading…</div>}
        {!loading && (error || !data) && <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-danger)' }}>{error ?? 'No data'}</div>}
        {!loading && data && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div>

          {/* ── 1. KPI strip ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 32 }}>
            <KpiCard label="Avg sentiment (30d)" value={data.kpis.avgSentiment30d !== null ? data.kpis.avgSentiment30d.toFixed(2) : '—'} sub={sentimentLabel(data.kpis.avgSentiment30d)} color={sentimentColor(data.kpis.avgSentiment30d)} info="Average sentiment score of all analyzed customer messages in the last 30 days. Scale: −1 (very negative) to +1 (very positive)." />
            <KpiCard label="CSAT (user)" value={data.kpis.csatUser !== null ? `${data.kpis.csatUser}/5` : '—'} sub="avg user rating" info="Average star rating submitted by customers via the post-resolution CSAT email. 1 = very dissatisfied, 5 = very satisfied." />
            <KpiCard label="CSAT (AI inferred)" value={data.kpis.csatAI !== null ? `${data.kpis.csatAI}/5` : '—'} sub="avg AI rating" info="AI-inferred satisfaction score based on the full ticket conversation. Useful when customers don't respond to the rating email." />
            <KpiCard label="At-risk customers" value={String(data.kpis.atRiskCount)} sub="health score < 0" color={data.kpis.atRiskCount > 0 ? '#EF4444' : undefined} info="Customers whose composite health score is below zero. Score weighs sentiment, urgent tickets, reopens, and churn signals." />
            <KpiCard label="Reopen rate" value={`${data.kpis.reopenRatePct}%`} sub="tickets reopened (30d)" color={data.kpis.reopenRatePct > 15 ? '#F59E0B' : undefined} info="Percentage of tickets created in the last 30 days that were reopened after being resolved. High rates indicate unresolved root causes." />
            <KpiCard label="Churn signals (30d)" value={String(data.kpis.churnSignalsCount30d)} sub="detected in messages" color={data.kpis.churnSignalsCount30d > 0 ? '#EF4444' : undefined} info="Number of customer messages where AI detected explicit cancellation intent, switching intent, or a serious threat to leave." />
          </div>

          {/* ── 2. Voice of the customer ── */}
          <SectionHeader title="Voice of the customer" />

          {/* Signals strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 12 }}>
            <button onClick={() => setOpenDrawer(openDrawer === 'churn' ? null : 'churn')} style={{ background: 'var(--d-surface)', border: `1px solid ${data.signals.churnCount30d > 0 ? '#EF4444' : 'var(--d-border)'}`, borderRadius: 10, padding: '16px 20px', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <AlertTriangle size={14} color="#EF4444" />
                <p style={{ fontSize: 11, color: 'var(--d-text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Churn risk (30d)</p>
                <InfoTooltip text="Customer messages where AI detected explicit cancellation intent or threats to leave. Each triggers a priority bump and notification." direction="down" />
              </div>
              <p style={{ fontSize: 28, fontWeight: 700, color: data.signals.churnCount30d > 0 ? '#EF4444' : 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.1 }}>{data.signals.churnCount30d}</p>
              <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>signals detected · click to view</p>
            </button>

            <button onClick={() => setOpenDrawer(openDrawer === 'advocacy' ? null : 'advocacy')} style={{ background: 'var(--d-surface)', border: `1px solid ${data.signals.advocacyCount30d > 0 ? '#22C55E' : 'var(--d-border)'}`, borderRadius: 10, padding: '16px 20px', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Heart size={14} color="#22C55E" />
                <p style={{ fontSize: 11, color: 'var(--d-text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Advocacy (30d)</p>
                <InfoTooltip text="Customer messages with genuine praise or recommendation intent. Passive signal — no notification, used to find testimonial candidates." direction="down" />
              </div>
              <p style={{ fontSize: 28, fontWeight: 700, color: data.signals.advocacyCount30d > 0 ? '#22C55E' : 'var(--d-text)', margin: '0 0 4px', lineHeight: 1.1 }}>{data.signals.advocacyCount30d}</p>
              <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>positive signals · click to view</p>
            </button>

            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Zap size={14} color="#F59E0B" />
                <p style={{ fontSize: 11, color: 'var(--d-text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Avg effort (30d)</p>
                <InfoTooltip text="AI-inferred Customer Effort Score (1 = effortless, 5 = very frustrating). The bar shows % of tickets at Low (1–2), Medium (3), or High (4–5) effort." direction="down" />
              </div>
              <p style={{ fontSize: 28, fontWeight: 700, color: (data.effort.avgScore30d ?? 0) > 3.5 ? '#EF4444' : 'var(--d-text)', margin: '0 0 10px', lineHeight: 1.1 }}>
                {data.effort.avgScore30d !== null ? `${data.effort.avgScore30d.toFixed(1)}/5` : '—'}
              </p>
              {(() => {
                const dist = data.effort.distribution
                const lowC = dist.filter(d => d.score <= 2).reduce((s, d) => s + d.count, 0)
                const midC = dist.find(d => d.score === 3)?.count ?? 0
                const highC = dist.filter(d => d.score >= 4).reduce((s, d) => s + d.count, 0)
                const total = lowC + midC + highC
                if (total === 0) return <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>No effort data yet</p>
                return (
                  <>
                    <div style={{ height: 8, borderRadius: 4, display: 'flex', overflow: 'hidden', gap: 1, background: 'var(--d-raised)' }}>
                      {lowC > 0 && <div style={{ width: `${pct(lowC, total)}%`, background: '#22C55E', borderRadius: '4px 0 0 4px' }} />}
                      {midC > 0 && <div style={{ width: `${pct(midC, total)}%`, background: '#F59E0B' }} />}
                      {highC > 0 && <div style={{ width: `${pct(highC, total)}%`, background: '#EF4444', borderRadius: '0 4px 4px 0' }} />}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 5 }}>
                      <span style={{ color: '#22C55E' }}>Low {pct(lowC, total)}%</span>
                      <span style={{ color: '#F59E0B' }}>Med {pct(midC, total)}%</span>
                      <span style={{ color: '#EF4444' }}>High {pct(highC, total)}%</span>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>

          {openDrawer === 'churn' && <SignalDrawer items={data.signals.recentChurn} type="churn" onClose={() => setOpenDrawer(null)} />}
          {openDrawer === 'advocacy' && <SignalDrawer items={data.signals.recentAdvocacy} type="advocacy" onClose={() => setOpenDrawer(null)} />}
          <div style={{ marginBottom: 16 }} />

          {/* Sentiment + Topics (Chatbase-style) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <SentimentChart trend={data.sentimentTrend} byLabel={data.sentimentByLabel} totalAnalyzed={data.totalAnalyzed} avgScore={data.kpis.avgSentiment30d} />
            <TopicTrendChart trend={data.topicTrend} meta={data.topicMeta} topTopics={data.topTopics} />
          </div>

          {/* Emerging topics */}
          {data.emergingTopics.length > 0 && (
            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
              <ChartTitle title="Emerging topics" info="Topics with the biggest week-over-week ticket volume increase. Early warning for rising customer pain points." />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data.emergingTopics.map(t => (
                  <div key={t.topicId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--d-text-2)' }}>{t.name}</span>
                    <span style={{ fontSize: 11, color: '#22C55E', fontWeight: 700 }}>+{t.deltaWoW}% WoW</span>
                    <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{t.ticketCount} tickets</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent signals feed + Effort × CSAT scatter */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '16px 20px' }}>
              <ChartTitle title="Recent signals" info="Latest churn-risk and advocacy quotes extracted from customer messages. Real words, not aggregates." />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Churn risk</p>
                  {data.signals.recentChurn.length === 0 ? <p style={{ fontSize: 12, color: 'var(--d-text-4)', fontStyle: 'italic' }}>None detected</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.signals.recentChurn.slice(0, 5).map(s => (
                        <div key={s.id} style={{ padding: '8px 10px', background: 'var(--d-raised)', borderRadius: 7, borderLeft: '3px solid #EF4444' }}>
                          <p style={{ fontSize: 12, color: 'var(--d-text)', fontStyle: 'italic', margin: '0 0 4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{s.quote}"</p>
                          <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{s.customerName} · <a href={`/tickets/${s.ticketNumber}`} style={{ color: 'var(--d-accent)', textDecoration: 'none' }}>#{s.ticketNumber}</a> · {timeAgo(s.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>Advocacy</p>
                  {data.signals.recentAdvocacy.length === 0 ? <p style={{ fontSize: 12, color: 'var(--d-text-4)', fontStyle: 'italic' }}>None detected</p> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.signals.recentAdvocacy.slice(0, 5).map(s => (
                        <div key={s.id} style={{ padding: '8px 10px', background: 'var(--d-raised)', borderRadius: 7, borderLeft: '3px solid #22C55E' }}>
                          <p style={{ fontSize: 12, color: 'var(--d-text)', fontStyle: 'italic', margin: '0 0 4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{s.quote}"</p>
                          <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{s.customerName} · <a href={`/tickets/${s.ticketNumber}`} style={{ color: 'var(--d-accent)', textDecoration: 'none' }}>#{s.ticketNumber}</a> · {timeAgo(s.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
              <ChartTitle title="Effort × CSAT" info="Per-ticket effort score vs satisfaction. Lower-right quadrant (high effort, high CSAT) = issue resolved but customer had to work hard for it." />
              {data.effort.scatterVsCsat.length === 0 ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>No effort data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <ScatterChart margin={{ top: 5, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" />
                    <XAxis type="number" dataKey="effort" name="Effort" domain={[0.5, 5.5]} tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} label={{ value: 'Effort (1–5)', position: 'insideBottom', offset: -8, fill: 'var(--d-text-4)', fontSize: 10 }} />
                    <YAxis type="number" dataKey="csat" name="CSAT" domain={[0.5, 5.5]} tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} label={{ value: 'CSAT', angle: -90, position: 'insideLeft', fill: 'var(--d-text-4)', fontSize: 10 }} />
                    <ZAxis range={[25, 50]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                      if (!payload?.length) return null
                      const d = payload[0]?.payload as { csat: number; effort: number }
                      return <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}><p style={{ margin: 0, color: 'var(--d-text-3)' }}>Effort: {d.effort}/5 · CSAT: {d.csat}/5</p></div>
                    }} />
                    <Scatter data={data.effort.scatterVsCsat} fill="#F59E0B" fillOpacity={0.55} />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Avg conversation depth — VoC */}
          <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px', marginBottom: 32 }}>
            <ChartTitle title="Avg conversation depth by category" info="Average number of messages exchanged per ticket, by category. Higher depth often means more complex or frustrating resolution — a direct customer effort signal." />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.convoDepthByCategory} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" vertical={false} />
                <XAxis dataKey="category" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={c => CATEGORY_LABELS[c] ?? c} />
                <YAxis tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} width={28} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="avgDepth" name="Avg messages" radius={[4, 4, 0, 0]}>
                  {data.convoDepthByCategory.map(r => <Cell key={r.category} fill={CATEGORY_COLORS[r.category] ?? '#71717A'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── 3. Product experience ── */}
          <SectionHeader title="Product experience" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
              <ChartTitle title="Bug reports by field 2" info="Number of bug report tickets per value in the second configurable dropdown. Highlights which options cause the most friction." />
              {data.frictionByField2.length === 0 ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>No bug report data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.frictionByField2.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} />
                    <YAxis type="category" dataKey="value" tick={{ fill: 'var(--d-text-3)', fontSize: 10 }} width={110} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Bug reports" fill="#EF4444" fillOpacity={0.75} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 10, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: '20px 24px' }}>
              <ChartTitle title="Category mix (90 days)" info="Daily ticket volume stacked by category over the last 90 days. Reveals seasonal patterns and category shifts over time." />
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.categoryMixOverTime.filter((_, i) => i % 3 === 0)} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--d-border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} tickFormatter={d => d.slice(5)} minTickGap={20} />
                  <YAxis tick={{ fill: 'var(--d-text-4)', fontSize: 10 }} width={28} />
                  <Tooltip content={<ChartTooltip />} />
                  {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                    <Area key={cat} type="monotone" dataKey={cat} name={CATEGORY_LABELS[cat]} stackId="1" stroke={color} fill={color} fillOpacity={0.6} strokeWidth={1} dot={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ background: 'var(--d-surface)', border: '1px dashed var(--d-border)', borderRadius: 10, padding: '28px 24px', textAlign: 'center', marginBottom: 32 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text-3)', margin: '0 0 6px' }}>More analytics coming soon</p>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>Reopen rate by connector, friction heatmap, and resolution SLA charts are planned for a future release.</p>
          </div>

          {/* ── 4. Customer health ── */}
          <SectionHeader title="Customer health" />
          <div style={{ background: 'var(--d-surface)', border: '1px dashed var(--d-border)', borderRadius: 10, padding: '28px 24px', textAlign: 'center', marginBottom: 32 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text-3)', margin: '0 0 6px' }}>More analytics coming soon</p>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>CSAT comparison, cohort retention, and revenue impact charts are planned for a future release.</p>
          </div>

          </div>
        </div>
        )}
      </main>
    </div>
  )
}
