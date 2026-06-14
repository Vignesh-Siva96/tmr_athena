'use client'
import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Minus, Clock, Ticket, CheckCircle, AlertCircle, Users, RefreshCw, Bot, ShieldCheck, Timer } from 'lucide-react'
import { motion, useMotionValue, animate, useReducedMotion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Label,
  BarChart, Bar, LabelList,
} from 'recharts'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { Skeleton } from '@/components/Skeleton'
import { InfoTooltip } from '@/components/InfoTooltip'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  kpis: {
    totalTickets: number
    openTickets: number
    resolvedTickets: number
    resolutionRate: number
    resolutionTimeP50: number | null
    resolutionTimeP90: number | null
    frtP50: number | null
    frtP90: number | null
    slaCompliancePct: number | null
    newThisWeek: number
    newLastWeek: number
    weekOverWeekPct: number | null
    unassigned: number
    reopenRate: number
  }
  triage: {
    newBacklog: number
    oldestNewAgeHours: number | null
    timeToTriageMedianHours: number | null
  }
  bot: {
    enabled: boolean
    deflectionRate: number | null
    escalated: number
    interactions: number
  }
  createdVsResolved: { date: string; created: number; resolved: number }[]
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  byPriority: Record<string, number>
  byField1: { value: string; count: number }[]
  byField2: { value: string; count: number }[]
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

// ─── Shared tooltip style ─────────────────────────────────────────────────────

const tooltipStyle: React.CSSProperties = {
  background: 'var(--d-raised-2)',
  border: '1px solid var(--d-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--d-text)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
}

// ─── Animated count-up number ─────────────────────────────────────────────────

function CountUp({ target, suffix = '' }: { target: number; suffix?: string }) {
  const prefersReduced = useReducedMotion()
  const motionVal = useMotionValue(prefersReduced ? target : 0)
  const [display, setDisplay] = useState(prefersReduced ? target : 0)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || prefersReduced) { setDisplay(target); return }
    ran.current = true
    const controls = animate(motionVal, target, { duration: 0.8, ease: 'easeOut' })
    const unsub = motionVal.on('change', (v) => setDisplay(Math.round(v)))
    return () => { controls.stop(); unsub() }
  }, [target, motionVal, prefersReduced])

  return <>{display}{suffix}</>
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, accent, trend, info, raw }: {
  label: string; value: string | number; sub?: string
  icon: React.ReactNode; accent: string
  trend?: { dir: 'up' | 'down' | 'flat'; pct: number | null; label: string }
  info?: string
  raw?: number // if provided, shows count-up on the numeric part
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0, height: '100%', minHeight: 112, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      background: 'var(--d-raised)', border: '1px solid var(--d-border)',
      borderRadius: 'var(--r-lg)', borderTop: `2px solid ${accent}`,
      transition: 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
    }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.transform = 'translateY(-2px)'
        el.style.boxShadow = `var(--d-shadow-lg), 0 0 0 1px ${accent}33`
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.transform = ''
        el.style.boxShadow = 'var(--d-shadow-card)'
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
            {info && <InfoTooltip text={info} direction="down" />}
          </div>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: accent + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}>
            {icon}
          </div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--d-text)', lineHeight: 1, fontFamily: 'var(--font-display)' }}>
          {raw !== undefined ? <CountUp target={raw} /> : value}
        </div>
      </div>
      <div style={{ marginTop: 6, minHeight: 15 }}>
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
    </div>
  )
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ title, subtitle, info, children, style }: {
  title: string; subtitle?: string; info?: string; children: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <div style={{
      padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)',
      borderRadius: 'var(--r-lg)',
      transition: 'transform 120ms ease, box-shadow 120ms ease',
      ...style,
    }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.transform = 'translateY(-2px)'
        el.style.boxShadow = 'var(--d-shadow-lg)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.transform = ''
        el.style.boxShadow = 'var(--d-shadow-card)'
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</h3>
          {info && <InfoTooltip text={info} />}
        </div>
        {subtitle && <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '3px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', paddingTop: 4 }}>
      {children}
    </p>
  )
}

// ─── Staggered motion row ─────────────────────────────────────────────────────

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}
const fadeRise = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
}

// ─── Custom tooltip components ────────────────────────────────────────────────

function NetFlowTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ ...tooltipStyle, padding: '8px 12px' }}>
      <p style={{ margin: '0 0 6px', color: 'var(--d-text-3)', fontSize: 11 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ margin: '2px 0', fontWeight: 600, color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
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

// ─── Insight mini-card ────────────────────────────────────────────────────────

function InsightCard({ label, value, sub, color, info }: {
  label: string; value: string | number; sub: string; color: string; info?: string
}) {
  return (
    <div
      style={{ flex: 1, minHeight: 90, padding: '16px 18px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', display: 'flex', flexDirection: 'column', justifyContent: 'center', transition: 'transform 120ms ease, box-shadow 120ms ease' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--d-shadow-lg)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--d-shadow-card)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{label}</p>
        {info && <InfoTooltip text={info} />}
      </div>
      <p style={{ fontSize: 26, fontWeight: 700, color, margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>{value}</p>
      <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>{sub}</p>
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

  const pieData = Object.entries(data?.byStatus ?? {})
    .filter(([k]) => STATUS_LABELS[k])
    .map(([k, v]) => ({ name: STATUS_LABELS[k].label, value: v, color: STATUS_LABELS[k].color }))

  const categoryData = Object.entries(data?.byCategory ?? {})
    .filter(([k]) => CATEGORY_LABELS[k])
    .map(([k, v]) => ({ name: CATEGORY_LABELS[k].label, value: v, color: CATEGORY_LABELS[k].color }))
    .sort((a, b) => b.value - a.value)

  const field1Data = (data?.byField1 ?? []).slice(0, 8).map((c) => ({ name: c.value, value: c.count, color: '#3B82F6' }))
  const field2Data = (data?.byField2 ?? []).slice(0, 8).map((c) => ({ name: c.value, value: c.count, color: '#3B82F6' }))

  const priorityData = Object.entries(data?.byPriority ?? {})
    .filter(([k]) => PRIORITY_LABELS[k])
    .map(([k, v]) => ({ name: PRIORITY_LABELS[k].label, value: v, color: PRIORITY_LABELS[k].color }))

  const pieTotal = pieData.reduce((sum, d) => sum + d.value, 0)

  // Dynamic column count: always category + priority; field1/field2 only when they have data
  const breakdownCols = loading
    ? 4
    : 2 + (field1Data.length > 0 ? 1 : 0) + (field2Data.length > 0 ? 1 : 0)

  const agentBarData = (data?.agentPerformance ?? []).map((a) => ({
    name: a.name.split(' ')[0],
    Assigned: a.assigned,
    Resolved: a.resolved,
    Open: a.open,
  }))

  const axisStyle = { fontSize: 11, fill: 'var(--d-text-4)' }
  const gridColor = 'var(--d-border)'

  const kpiSkeleton = (
    Array.from({ length: 5 }).map((_, i) => (
      <div key={i} style={{ flex: 1, padding: 18, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
        <Skeleton h={10} w="60%" /><div style={{ height: 8 }} /><Skeleton h={28} w="40%" />
      </div>
    ))
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Analytics</h1>
            <span style={{ fontSize: 13, color: 'var(--d-text-3)', fontWeight: 400 }}>Operations — last 30 days · real tickets only</span>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

          {/* ── Responsiveness ── */}
          <SectionLabel>Responsiveness</SectionLabel>
          <motion.div
            variants={container} initial="hidden" animate={loading ? 'hidden' : 'show'}
            style={{ display: 'flex', gap: 14, marginBottom: 20 }}
          >
            {loading ? kpiSkeleton : (
              <>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Open backlog" value={kpis?.openTickets ?? 0} raw={kpis?.openTickets}
                    icon={<AlertCircle size={13} />} accent="#F59E0B"
                    sub={`${kpis?.unassigned ?? 0} unassigned`}
                    info="Real tickets in OPEN, IN_PROGRESS, or WAITING status right now."
                  />
                </motion.div>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Agent FRT (P50)" value={formatHours(kpis?.frtP50 ?? null)}
                    icon={<Timer size={13} />} accent="#3B82F6"
                    sub={kpis?.frtP90 != null ? `P90 ${formatHours(kpis.frtP90)}` : undefined}
                    info="Median time from ticket arrival to first human-agent reply. Clock starts at bot escalation if the bot engaged, otherwise at ticket creation."
                  />
                </motion.div>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Resolution time (P50)" value={formatHours(kpis?.resolutionTimeP50 ?? null)}
                    icon={<Clock size={13} />} accent="#A78BFA"
                    sub={kpis?.resolutionTimeP90 != null ? `P90 ${formatHours(kpis.resolutionTimeP90)}` : undefined}
                    info="Median time from ticket creation to first resolution (uses firstResolvedAt). Counts real tickets resolved in the last 30 days."
                  />
                </motion.div>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Resolution rate" value={`${kpis?.resolutionRate ?? 0}%`}
                    raw={kpis?.resolutionRate}
                    icon={<CheckCircle size={13} />} accent="#22C55E"
                    sub={`${kpis?.resolvedTickets ?? 0} of ${kpis?.totalTickets ?? 0} tickets closed`}
                    info="Percentage of all real tickets that are in RESOLVED or CLOSED status. Conversations and dismissed rows are excluded."
                  />
                </motion.div>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="SLA compliance"
                    value={kpis?.slaCompliancePct != null ? `${kpis.slaCompliancePct}%` : '—'}
                    icon={<ShieldCheck size={13} />} accent="#22C55E"
                    sub="FRT within SLA target"
                    info="Share of real tickets where the agent first responded within the configured SLA target (default: 4 hours). Based on last 30 days."
                  />
                </motion.div>
              </>
            )}
          </motion.div>

          {/* ── Triage & Automation ── */}
          <SectionLabel>Triage &amp; Automation</SectionLabel>
          <motion.div
            variants={container} initial="hidden" animate={loading ? 'hidden' : 'show'}
            style={{ display: 'flex', gap: 14, marginBottom: 20 }}
          >
            {loading ? Array.from({ length: data?.bot.enabled !== false ? 4 : 3 }).map((_, i) => (
              <div key={i} style={{ flex: 1, padding: 18, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
                <Skeleton h={10} w="60%" /><div style={{ height: 8 }} /><Skeleton h={28} w="40%" />
              </div>
            )) : (
              <>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Triage backlog" value={data?.triage.newBacklog ?? 0} raw={data?.triage.newBacklog}
                    icon={<Ticket size={13} />} accent="#FB923C"
                    sub={data?.triage.oldestNewAgeHours != null ? `Oldest ${formatHours(data.triage.oldestNewAgeHours)} ago` : 'No unread conversations'}
                    info="Inbound email conversations waiting to be triaged (status NEW, isTicket=false). These are not yet visible to customers as tickets."
                  />
                </motion.div>
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Time to triage (P50)" value={formatHours(data?.triage.timeToTriageMedianHours ?? null)}
                    icon={<Clock size={13} />} accent="#FB923C"
                    sub="Median time to convert"
                    info="Median time between an email arriving and an agent converting it into a real ticket. Measured on converted tickets in the last 30 days."
                  />
                </motion.div>
                {data?.bot.enabled && (
                  <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                    <KpiCard
                      label="Bot deflection"
                      value={data.bot.deflectionRate != null ? `${data.bot.deflectionRate}%` : '—'}
                      icon={<Bot size={13} />} accent="#A78BFA"
                      sub={`${data.bot.escalated} escalated to agent`}
                      info="Percentage of bot-engaged tickets where Athena answered without escalating to a human agent. Last 30 days."
                    />
                  </motion.div>
                )}
                <motion.div variants={fadeRise} style={{ flex: 1, minWidth: 0 }}>
                  <KpiCard
                    label="Reopen rate" value={`${kpis?.reopenRate ?? 0}%`}
                    icon={<RefreshCw size={13} />} accent="#EF4444"
                    sub="of resolved tickets reopened"
                    info="Percentage of resolved real tickets that were reopened at least once (reopenCount > 0 ÷ resolved count)."
                  />
                </motion.div>
              </>
            )}
          </motion.div>

          {/* ── Volume & Mix ── */}
          <SectionLabel>Volume &amp; Mix</SectionLabel>

          {/* Created vs Resolved + Status pie */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
            <Card
              title="Created vs Resolved" subtitle="Real tickets per day — last 30 days"
              info="Daily count of new real tickets created vs tickets resolved. A widening gap means backlog is growing."
            >
              {loading ? <Skeleton h={160} /> : (data?.createdVsResolved ?? []).length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', textAlign: 'center', margin: '60px 0', fontStyle: 'italic' }}>No ticket data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={data?.createdVsResolved ?? []} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="resolvedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22C55E" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#22C55E" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="date" tick={axisStyle} tickLine={false} axisLine={false}
                      tickFormatter={(v: string) => v.slice(5)} interval={4}
                    />
                    <YAxis tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<NetFlowTooltip />} cursor={{ stroke: 'var(--d-border)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="created" name="Created" stroke="#3B82F6" strokeWidth={2} fill="url(#createdGrad)" dot={false} activeDot={{ r: 4, fill: '#3B82F6' }} isAnimationActive animationDuration={600} />
                    <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22C55E" strokeWidth={2} fill="url(#resolvedGrad)" dot={false} activeDot={{ r: 4, fill: '#22C55E' }} isAnimationActive animationDuration={600} />
                    <Legend iconType="square" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: 'var(--d-text-3)' }}>{v}</span>} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Status breakdown" info="Distribution of real tickets across workflow states.">
              {loading ? (
                <Skeleton h={160} />
              ) : pieData.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--d-text-4)' }}>No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={45} outerRadius={68} dataKey="value" paddingAngle={2} strokeWidth={0} isAnimationActive animationDuration={500}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <Label
                        content={(props) => {
                          const vb = (props as { viewBox?: { cx?: number; cy?: number } }).viewBox
                          const cx = vb?.cx ?? 0
                          const cy = vb?.cy ?? 0
                          return (
                            <g>
                              <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--d-text)" fontSize="18" fontWeight="700">{pieTotal}</text>
                              <text x={cx} y={cy + 13} textAnchor="middle" fill="var(--d-text-4)" fontSize="10">tickets</text>
                            </g>
                          )
                        }}
                      />
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend layout="horizontal" align="center" verticalAlign="bottom" iconType="square" iconSize={8}
                      formatter={(value) => <span style={{ fontSize: 11, color: 'var(--d-text-2)' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* Category + field1 + field2 + Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${breakdownCols}, 1fr)`, gap: 14, marginBottom: 14 }}>
            <Card title="By category" subtitle="Issue type distribution" info="Breakdown of real tickets by support category.">
              {loading ? <Skeleton h={140} /> : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive animationDuration={500}>
                      {categoryData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            {loading ? (
              <Card title="Top by field 1"><Skeleton h={140} /></Card>
            ) : field1Data.length > 0 ? (
              <Card title="Top by field 1" subtitle="Breakdown by first configurable dropdown" info="Ticket distribution by the first configurable dropdown (field1), rendered only when data exists.">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={field1Data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            ) : null}
            {loading ? (
              <Card title="Top by field 2"><Skeleton h={140} /></Card>
            ) : field2Data.length > 0 ? (
              <Card title="Top by field 2" subtitle="Breakdown by second configurable dropdown" info="Ticket distribution by the second configurable dropdown (field2), rendered only when data exists.">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={field2Data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                    <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={80} />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive>
                      <LabelList dataKey="value" position="right" style={{ fontSize: 11, fill: 'var(--d-text-4)' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            ) : null}

            <Card title="Priority mix" subtitle="Urgency distribution" info="Breakdown of real tickets by priority level. Urgent tickets are flagged.">
              {loading ? <Skeleton h={140} /> : (
                <>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={priorityData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 10 }}>
                      <XAxis type="number" tick={axisStyle} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} width={55} />
                      <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive>
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

          {/* ── Team ── */}
          <SectionLabel>Team</SectionLabel>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <Card title="Agent performance" subtitle="Real ticket assignment and resolution by team member" info="Each agent's assigned, open, and resolved real ticket counts for the current period.">
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
                    <Bar dataKey="Assigned" fill="#3B82F6" radius={[0, 3, 3, 0]} maxBarSize={12} isAnimationActive />
                    <Bar dataKey="Resolved" fill="#22C55E" radius={[0, 3, 3, 0]} maxBarSize={12} isAnimationActive />
                    <Bar dataKey="Open"     fill="#F59E0B" radius={[0, 3, 3, 0]} maxBarSize={12} isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {loading ? (<><Skeleton h={90} /><Skeleton h={90} /></>) : data ? (
                <>
                  <InsightCard
                    label="Backlog pressure"
                    value={data.kpis.openTickets > 0 && data.kpis.totalTickets > 0
                      ? `${Math.round((data.kpis.openTickets / data.kpis.totalTickets) * 100)}%`
                      : '0%'}
                    sub="open real tickets vs total"
                    color={data.kpis.openTickets / Math.max(data.kpis.totalTickets, 1) > 0.4 ? '#EF4444' : '#22C55E'}
                    info="Open tickets as a percentage of all real tickets. Above 40% signals a growing backlog."
                  />
                  <InsightCard
                    label="Unassigned backlog"
                    value={data.kpis.unassigned}
                    sub="open tickets with no owner"
                    color={data.kpis.unassigned > 5 ? '#F59E0B' : '#22C55E'}
                    info="Real tickets that are open but have no agent assigned."
                  />
                  <InsightCard
                    label="New this week"
                    value={data.kpis.newThisWeek}
                    sub={data.kpis.weekOverWeekPct != null
                      ? `${data.kpis.weekOverWeekPct > 0 ? '+' : ''}${data.kpis.weekOverWeekPct}% vs last week`
                      : 'real tickets created'}
                    color="#3B82F6"
                    info="Real tickets created in the last 7 days, compared to the prior 7-day window."
                  />
                </>
              ) : null}
            </div>
          </div>

          <div style={{ height: 32 }} />
        </div>
      </main>
    </div>
  )
}
