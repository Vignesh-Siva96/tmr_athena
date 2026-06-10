'use client'
import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Minus, Clock, Ticket, CheckCircle, AlertCircle } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar, LabelList,
} from 'recharts'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  kpis: {
    totalTickets: number
    openTickets: number
    resolvedTickets: number
    resolutionRate: number
    avgResolutionHours: number | null
    newThisWeek: number
    newLastWeek: number
    weekOverWeekPct: number | null
    unassigned: number
  }
  volumeByDay: { date: string; count: number }[]
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  byPriority: Record<string, number>
  byField1: { value: string; count: number }[]
  byField2: { value: string; count: number }[]
  topCustomers: {
    id: string; name: string; email: string
    total: number; open: number; lastTicket: string | null
  }[]
  agentPerformance: {
    id: string; name: string; email: string
    assigned: number; resolved: number; open: number
  }[]
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  OPEN:        { label: 'Open',        color: '#3B82F6' },
  IN_PROGRESS: { label: 'In Progress', color: '#F59E0B' },
  WAITING:     { label: 'Waiting',     color: '#A78BFA' },
  RESOLVED:    { label: 'Resolved',    color: '#22C55E' },
  CLOSED:      { label: 'Closed',      color: '#71717A' },
}
const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  BUG_REPORT:      { label: 'Bug Report',      color: '#EF4444' },
  FEATURE_REQUEST: { label: 'Feature Request', color: '#3B82F6' },
  QUESTION:        { label: 'Question',        color: '#22C55E' },
  BILLING:         { label: 'Billing',         color: '#F59E0B' },
  OTHER:           { label: 'Other',           color: '#71717A' },
}
const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  NORMAL: { label: 'Normal', color: '#60A5FA' },
  HIGH:   { label: 'High',   color: '#FB923C' },
  URGENT: { label: 'Urgent', color: '#F43F5E' },
}

function formatHours(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

// ─── Shared tooltip style ─────────────────────────────────────────────────────

const tooltipStyle: React.CSSProperties = {
  background: 'var(--d-raised-2)',
  border: '1px solid var(--d-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--d-text)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, accent, trend }: {
  label: string; value: string | number; sub?: string
  icon: React.ReactNode; accent: string
  trend?: { dir: 'up' | 'down' | 'flat'; pct: number | null; label: string }
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '16px 18px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: accent + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--d-text)', lineHeight: 1, marginBottom: 6, fontFamily: 'var(--font-display)' }}>{value}</div>
      {trend && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          {trend.dir === 'up' && <TrendingUp size={11} style={{ color: '#22C55E' }} />}
          {trend.dir === 'down' && <TrendingDown size={11} style={{ color: '#EF4444' }} />}
          {trend.dir === 'flat' && <Minus size={11} style={{ color: 'var(--d-text-4)' }} />}
          {trend.pct !== null && (
            <span style={{ fontWeight: 600, color: trend.dir === 'up' ? '#22C55E' : trend.dir === 'down' ? '#EF4444' : 'var(--d-text-4)' }}>
              {trend.dir === 'up' ? '+' : ''}{trend.pct}%
            </span>
          )}
          <span style={{ color: 'var(--d-text-4)' }}>{trend.label}</span>
        </div>
      )}
      {sub && !trend && <div style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{sub}</div>}
    </div>
  )
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ title, subtitle, children, style }: { title: string; subtitle?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', ...style }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Skeleton({ h = 32, w }: { h?: number; w?: string }) {
  return <div className="shimmer" style={{ height: h, width: w ?? '100%', borderRadius: 6 }} />
}

// ─── Custom tooltip components ────────────────────────────────────────────────

function VolumeTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <p style={{ margin: '0 0 4px', color: 'var(--d-text-3)', fontSize: 11 }}>{label}</p>
      <p style={{ margin: 0, fontWeight: 700, color: '#3B82F6' }}>{payload[0].value} tickets</p>
    </div>
  )
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: { color: string } }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: payload[0].payload.color, flexShrink: 0 }} />
        <span style={{ color: 'var(--d-text-3)', fontSize: 11 }}>{payload[0].name}</span>
      </div>
      <p style={{ margin: '4px 0 0', fontWeight: 700, color: 'var(--d-text)' }}>{payload[0].value} tickets</p>
    </div>
  )
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; fill: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <p style={{ margin: '0 0 4px', color: 'var(--d-text-3)', fontSize: 11 }}>{label}</p>
      <p style={{ margin: 0, fontWeight: 700, color: payload[0].fill }}>{payload[0].value} tickets</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { token } = useAuth()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    api.get<AnalyticsData>('/analytics', token)
      .then((res) => { setData(res); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  const kpis = data?.kpis
  const weekTrend = kpis?.weekOverWeekPct == null
    ? undefined
    : { dir: kpis.weekOverWeekPct > 0 ? 'up' as const : kpis.weekOverWeekPct < 0 ? 'down' as const : 'flat' as const, pct: kpis.weekOverWeekPct, label: 'vs last week' }

  // Recharts data shapes
  const pieData = Object.entries(data?.byStatus ?? {})
    .filter(([k]) => STATUS_LABELS[k])
    .map(([k, v]) => ({ name: STATUS_LABELS[k].label, value: v, color: STATUS_LABELS[k].color }))

  const categoryData = Object.entries(data?.byCategory ?? {})
    .filter(([k]) => CATEGORY_LABELS[k])
    .map(([k, v]) => ({ name: CATEGORY_LABELS[k].label, value: v, color: CATEGORY_LABELS[k].color }))
    .sort((a, b) => b.value - a.value)

  const field1Data = (data?.byField1 ?? []).slice(0, 8)
    .map((c) => ({ name: c.value, value: c.count, color: '#3B82F6' }))
  const field2Data = (data?.byField2 ?? []).slice(0, 8)
    .map((c) => ({ name: c.value, value: c.count, color: '#3B82F6' }))

  const priorityData = Object.entries(data?.byPriority ?? {})
    .filter(([k]) => PRIORITY_LABELS[k])
    .map(([k, v]) => ({ name: PRIORITY_LABELS[k].label, value: v, color: PRIORITY_LABELS[k].color }))

  const agentBarData = (data?.agentPerformance ?? []).map((a) => ({
    name: a.name.split(' ')[0], // first name only for axis label
    Assigned: a.assigned,
    Resolved: a.resolved,
    Open: a.open,
  }))

  const axisStyle = { fontSize: 11, fill: 'var(--d-text-4)' }
  const gridColor = 'var(--d-border)'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Analytics</h1>
            <span style={{ fontSize: 13, color: 'var(--d-text-3)', fontWeight: 400 }}>Support health — last 30 days</span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        <div>

          {/* ── Row 1: KPI cards ── */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ flex: 1, padding: 18, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
                  <Skeleton h={10} w="60%" /><div style={{ height: 8 }} /><Skeleton h={28} w="40%" />
                </div>
              ))
            ) : (
              <>
                <KpiCard label="Total tickets" value={kpis?.totalTickets ?? 0} icon={<Ticket size={13} />} accent="#3B82F6" sub={`${kpis?.unassigned ?? 0} unassigned`} />
                <KpiCard label="Open now" value={kpis?.openTickets ?? 0} icon={<AlertCircle size={13} />} accent="#F59E0B" sub={`${kpis?.unassigned ?? 0} need assignment`} />
                <KpiCard label="Resolved" value={`${kpis?.resolutionRate ?? 0}%`} icon={<CheckCircle size={13} />} accent="#22C55E" sub={`${kpis?.resolvedTickets ?? 0} tickets closed`} />
                <KpiCard label="Avg resolution" value={formatHours(kpis?.avgResolutionHours ?? null)} icon={<Clock size={13} />} accent="#A78BFA" sub="median time to close" />
                <KpiCard label="New this week" value={kpis?.newThisWeek ?? 0} icon={<TrendingUp size={13} />} accent="#3B82F6" trend={weekTrend} />
              </>
            )}
          </div>

          {/* ── Row 2: Volume + Status ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
            <Card title="Ticket volume" subtitle="New tickets per day — last 30 days">
              {loading ? <Skeleton h={160} /> : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={data?.volumeByDay ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={false}
                      tickFormatter={(v: string) => v.slice(5)}
                      interval={4}
                    />
                    <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<VolumeTooltip />} cursor={{ stroke: 'var(--d-border)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="count" stroke="#3B82F6" strokeWidth={2} fill="url(#volGrad)" dot={false} activeDot={{ r: 4, fill: '#3B82F6' }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Status breakdown">
              {loading ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  <Skeleton h={120} w="120px" /><div style={{ flex: 1 }}><Skeleton h={12} /><div style={{ height: 6 }} /><Skeleton h={12} /></div>
                </div>
              ) : pieData.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--d-text-4)' }}>No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={pieData} cx="40%" cy="50%" innerRadius={45} outerRadius={68} dataKey="value" paddingAngle={2} strokeWidth={0}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend
                      layout="vertical" align="right" verticalAlign="middle"
                      iconType="square" iconSize={8}
                      formatter={(value) => <span style={{ fontSize: 11, color: 'var(--d-text-2)' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ── Row 3: Category + Connectors + Priority ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
            <Card title="By category" subtitle="Issue type distribution">
              {loading ? <Skeleton h={140} /> : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      {categoryData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {field1Data.length > 0 && (
              <Card title="Top by field 1" subtitle="Breakdown by first configurable dropdown">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={field1Data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
            {field2Data.length > 0 && (
              <Card title="Top by field 2" subtitle="Breakdown by second configurable dropdown">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={field2Data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            <Card title="Priority mix" subtitle="Urgency distribution">
              {loading ? <Skeleton h={140} /> : (
                <>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={priorityData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                      <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={55} />
                      <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16}>
                        {priorityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {(data?.byPriority?.URGENT ?? 0) > 0 && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--d-danger-bg)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={12} style={{ color: 'var(--d-danger)', flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: 'var(--d-danger)', fontWeight: 500 }}>
                        {data?.byPriority.URGENT} urgent {data!.byPriority.URGENT === 1 ? 'ticket' : 'tickets'} need attention
                      </span>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          {/* ── Row 4: High-attention customers ── */}
          <Card title="High-attention customers" subtitle="Customers with the most open tickets — sorted by total volume" style={{ marginBottom: 14 }}>
            {loading ? <Skeleton h={120} /> : !data?.topCustomers.length ? (
              <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>No customer data yet</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Customer', 'Email', 'Total', 'Open', 'Resolution rate', 'Last ticket'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '0 12px 10px 0', fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--d-border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCustomers.map((c, i) => {
                      const resolved = c.total - c.open
                      const rate = c.total > 0 ? Math.round((resolved / c.total) * 100) : 0
                      const isHighRisk = c.open >= 3
                      return (
                        <tr key={c.id} style={{ borderBottom: i < data.topCustomers.length - 1 ? '1px solid var(--d-border-2)' : 'none' }}>
                          <td style={{ padding: '10px 12px 10px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `hsl(${(c.name.charCodeAt(0) * 47) % 360},60%,${isHighRisk ? '40%' : '55%'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                {c.name.slice(0, 1).toUpperCase()}
                              </div>
                              <span style={{ fontWeight: 500, color: 'var(--d-text)' }}>{c.name}</span>
                              {isHighRisk && <span style={{ fontSize: 10, fontWeight: 600, color: '#EF4444', background: 'rgba(239,68,68,0.12)', padding: '2px 6px', borderRadius: 999 }}>At risk</span>}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px 10px 0', color: 'var(--d-text-3)', fontSize: 12 }}>{c.email}</td>
                          <td style={{ padding: '10px 12px 10px 0', fontWeight: 700, color: 'var(--d-text)' }}>{c.total}</td>
                          <td style={{ padding: '10px 12px 10px 0' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: c.open > 0 ? '#F59E0B' : '#22C55E' }}>{c.open}</span>
                          </td>
                          <td style={{ padding: '10px 12px 10px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 60, height: 4, background: 'var(--d-surface)', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ width: `${rate}%`, height: '100%', background: rate >= 75 ? '#22C55E' : rate >= 50 ? '#F59E0B' : '#EF4444', borderRadius: 999 }} />
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--d-text-3)' }}>{rate}%</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 0 10px 0', fontSize: 12, color: 'var(--d-text-4)' }}>{timeAgo(c.lastTicket)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Row 5: Agent performance + Insights ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <Card title="Agent performance" subtitle="Ticket assignment and resolution by team member">
              {loading ? <Skeleton h={160} /> : !data?.agentPerformance.length ? (
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0 }}>No agent data</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, agentBarData.length * 48)}>
                  <BarChart data={agentBarData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 10 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={70} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend iconType="square" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: 'var(--d-text-3)' }}>{v}</span>} />
                    <Bar dataKey="Assigned" fill="#3B82F6" radius={[0, 3, 3, 0]} maxBarSize={12} />
                    <Bar dataKey="Resolved" fill="#22C55E" radius={[0, 3, 3, 0]} maxBarSize={12} />
                    <Bar dataKey="Open"     fill="#F59E0B" radius={[0, 3, 3, 0]} maxBarSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loading ? (<><Skeleton h={90} /><Skeleton h={90} /><Skeleton h={90} /></>) : data ? (
                [
                  { label: 'Tickets per customer', value: data.topCustomers.length > 0 ? (data.topCustomers.reduce((a, c) => a + c.total, 0) / data.topCustomers.length).toFixed(1) : '—', sub: 'avg across top 10 customers', color: '#3B82F6' },
                  { label: 'Backlog pressure', value: data.kpis.openTickets > 0 && data.kpis.totalTickets > 0 ? `${Math.round((data.kpis.openTickets / data.kpis.totalTickets) * 100)}%` : '0%', sub: 'open tickets vs total', color: data.kpis.openTickets / Math.max(data.kpis.totalTickets, 1) > 0.4 ? '#EF4444' : '#22C55E' },
                  { label: 'Unassigned backlog', value: data.kpis.unassigned, sub: 'open tickets with no owner', color: data.kpis.unassigned > 5 ? '#F59E0B' : '#22C55E' },
                ].map((item) => (
                  <div key={item.label} style={{ flex: 1, padding: '16px 18px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>{item.label}</p>
                    <p style={{ fontSize: 26, fontWeight: 700, color: item.color, margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>{item.value}</p>
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{item.sub}</p>
                  </div>
                ))
              ) : null}
            </div>
          </div>

          <div style={{ height: 32 }} />
        </div>
        </div>
      </main>
    </div>
  )
}
