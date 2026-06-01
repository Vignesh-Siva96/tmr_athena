'use client'
import { useEffect, useState } from 'react'
import { Plus, Trash2, Calendar, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Agent {
  id: string
  name: string
  email: string
  role: string
}

interface Shift {
  id: string
  primaryAgentId: string
  primaryAgent: { id: string; name: string; email: string }
  dayOfWeek: number
  startMinute: number
  endMinute: number
  active: boolean
}

interface AppConfig {
  timezone: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOURS = Array.from({ length: 25 }, (_, i) => i)

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function formatDayOfWeek(d: number): string {
  if (d === -1) return 'Every day'
  return DAYS[d] ?? String(d)
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ShiftsPage() {
  const { token } = useAuth()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // New shift form
  const [newAgentId, setNewAgentId] = useState('')
  const [newDay, setNewDay] = useState<number>(1)
  const [newStart, setNewStart] = useState('09:00')
  const [newEnd, setNewEnd] = useState('17:00')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!token) return
    setLoading(true)
    try {
      const [shiftRes, agentRes, cfg] = await Promise.all([
        api.get<Shift[]>('/shifts', token),
        api.get<{ data: Agent[] }>('/agents', token),
        api.get<AppConfig>('/config', token),
      ])
      setShifts(Array.isArray(shiftRes) ? shiftRes : [])
      const primaryAgents = (agentRes.data ?? []).filter(
        (a) => a.role === 'PRIMARY_AGENT' || a.role === 'ADMIN',
      )
      setAgents(primaryAgents)
      if (primaryAgents.length > 0 && !newAgentId) setNewAgentId(primaryAgents[0]?.id ?? '')
      setTimezone(cfg.timezone ?? 'UTC')
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token])

  const saveTimezone = async (tz: string) => {
    if (!token) return
    setTimezone(tz)
    await api.patch('/config', { timezone: tz }, token).catch(() => {})
  }

  const createShift = async () => {
    if (!token || !newAgentId) return
    setSaving(true)
    try {
      await api.post('/shifts', {
        primaryAgentId: newAgentId,
        dayOfWeek: newDay,
        startMinute: timeToMinutes(newStart),
        endMinute: timeToMinutes(newEnd),
      }, token)
      setShowForm(false)
      await load()
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const deleteShift = async (id: string) => {
    if (!token) return
    await api.delete(`/shifts/${id}`, token).catch(() => {})
    setShifts((prev) => prev.filter((s) => s.id !== id))
  }

  const toggleShift = async (shift: Shift) => {
    if (!token) return
    await api.patch(`/shifts/${shift.id}`, { active: !shift.active }, token).catch(() => {})
    setShifts((prev) => prev.map((s) => s.id === shift.id ? { ...s, active: !s.active } : s))
  }

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px',
    background: 'var(--d-raised)',
    border: '1px solid var(--d-border)',
    borderRadius: 6,
    color: 'var(--d-text)',
    fontSize: 13,
    outline: 'none',
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

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(59,130,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Calendar size={20} style={{ color: 'var(--d-accent)' }} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--d-text)' }}>Shifts</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--d-text-3)' }}>Define on-call windows for primary agent routing</p>
          </div>
        </div>
        <button
          style={{ ...btnStyle, background: 'var(--d-accent)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus size={14} />
          Add shift
        </button>
      </div>

      {/* Timezone selector */}
      <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--d-text)', marginBottom: 8 }}>Org timezone</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            list="common-timezones"
            style={{ ...inputStyle, flex: 1, maxWidth: 320 }}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            onBlur={() => void saveTimezone(timezone)}
            placeholder="UTC"
          />
          <datalist id="common-timezones">
            {['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'].map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
          <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>All shift times are in this timezone</span>
        </div>
      </div>

      {/* New shift form */}
      {showForm && (
        <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-accent)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: 'var(--d-text)' }}>New shift</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px 120px', gap: 12, marginBottom: 16, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--d-text-3)', marginBottom: 5 }}>Agent</label>
              <select style={{ ...inputStyle, width: '100%' }} value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--d-text-3)', marginBottom: 5 }}>Day of week</label>
              <select style={{ ...inputStyle, width: '100%' }} value={newDay} onChange={(e) => setNewDay(parseInt(e.target.value))}>
                <option value="-1">Every day</option>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--d-text-3)', marginBottom: 5 }}>Start</label>
              <input type="time" style={inputStyle} value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--d-text-3)', marginBottom: 5 }}>End</label>
              <input type="time" style={inputStyle} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ ...btnStyle, background: 'var(--d-accent)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => void createShift()}
              disabled={saving || !newAgentId}
            >
              {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
              Create shift
            </button>
            <button style={btnStyle} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
          {newStart > newEnd && newEnd !== '00:00' && (
            <p style={{ fontSize: 12, color: 'var(--d-accent)', marginTop: 8 }}>⚡ Overnight shift — spans midnight</p>
          )}
        </div>
      )}

      {/* Shifts list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--d-text-3)' }} />
        </div>
      ) : shifts.length === 0 ? (
        <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, padding: 40, textAlign: 'center' }}>
          <Calendar size={32} style={{ color: 'var(--d-text-4)', marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: 'var(--d-text-3)', margin: 0 }}>No shifts defined yet.</p>
          <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '4px 0 0' }}>Create a shift to control which agent receives escalated tickets.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--d-border)' }}>
                {['Agent', 'Day', 'Start', 'End', 'Active', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--d-text-4)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--d-border-2)', opacity: s.active ? 1 : 0.5 }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--d-text)' }}>
                    {s.primaryAgent.name}
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--d-text-4)' }}>{s.primaryAgent.email}</span>
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--d-text-2)' }}>{formatDayOfWeek(s.dayOfWeek)}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--d-text-2)', fontFamily: 'monospace' }}>{minutesToTime(s.startMinute)}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--d-text-2)', fontFamily: 'monospace' }}>{minutesToTime(s.endMinute)}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      role="switch"
                      aria-checked={s.active}
                      onClick={() => void toggleShift(s)}
                      style={{
                        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                        background: s.active ? 'var(--d-accent)' : 'var(--d-raised-2)',
                        position: 'relative', transition: 'background 150ms', flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2, left: s.active ? 18 : 2,
                        width: 16, height: 16, borderRadius: '50%', background: '#fff',
                        transition: 'left 150ms',
                      }} />
                    </button>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <button
                      style={{ ...btnStyle, padding: '4px 8px', color: 'var(--d-danger)', fontSize: 12 }}
                      onClick={() => void deleteShift(s.id)}
                      title="Delete shift"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
