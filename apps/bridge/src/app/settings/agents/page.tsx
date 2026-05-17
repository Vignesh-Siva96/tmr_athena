'use client'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface AgentRow { id: string; email: string; name: string; role: 'ADMIN' | 'AGENT'; isActive: boolean; lastActiveAt: string | null; inviteAccepted: boolean }
interface AgentsResponse { data: AgentRow[] }

function initials(name: string): string {
  const p = name.trim().split(' ')
  return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase()
}

export default function AgentsSettingsPage() {
  const { token, agent: me } = useAuth()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<'AGENT' | 'ADMIN'>('AGENT')
  const [isInviting, setIsInviting] = useState(false)

  const loadAgents = () => {
    if (!token) return
    setIsLoading(true)
    api.get<AgentsResponse>('/agents', token)
      .then((res) => setAgents(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    loadAgents()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const handleInvite = async () => {
    if (!token || !inviteEmail || !inviteName) return
    setIsInviting(true)
    try {
      await api.post('/agents/invite', { email: inviteEmail, name: inviteName, role: inviteRole }, token)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('AGENT')
      setShowInviteForm(false)
      loadAgents()
    } catch (err) {
      console.error(err)
    } finally {
      setIsInviting(false)
    }
  }

  const handleRoleChange = async (agentId: string, role: 'ADMIN' | 'AGENT') => {
    if (!token) return
    try {
      await api.patch(`/agents/${agentId}`, { role }, token)
      loadAgents()
    } catch (err) { console.error(err) }
  }

  const handleToggleActive = async (agent: AgentRow) => {
    if (!token) return
    try {
      await api.patch(`/agents/${agent.id}`, { isActive: !agent.isActive }, token)
      loadAgents()
    } catch (err) { console.error(err) }
  }

  const isAdmin = me?.role === 'ADMIN'
  const colTemplate = isAdmin ? '40px 1fr 200px 140px 100px 160px' : '40px 1fr 200px 100px 100px'

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isAdmin && showInviteForm ? 16 : 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>Agents ({agents.length})</h1>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>Manage your support team.</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowInviteForm(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: showInviteForm ? 'var(--d-raised)' : 'var(--d-accent)', color: showInviteForm ? 'var(--d-text)' : '#fff', border: showInviteForm ? '1px solid var(--d-border)' : 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Plus size={14} /> {showInviteForm ? 'Cancel' : 'Invite agent'}
          </button>
        )}
      </div>

      {isAdmin && showInviteForm && (
        <div style={{ padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Email</label>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="agent@example.com"
              type="email"
              style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Name</label>
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Full name"
              style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: '0 0 120px' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'AGENT' | 'ADMIN')}
              style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="AGENT">AGENT</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => { void handleInvite() }}
              disabled={isInviting || !inviteEmail || !inviteName}
              style={{ height: 34, padding: '0 16px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: isInviting ? 'not-allowed' : 'pointer', opacity: isInviting ? 0.7 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              {isInviting ? 'Sending…' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={() => setShowInviteForm(false)}
              style={{ height: 34, padding: '0 12px', background: 'none', color: 'var(--d-text-3)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: colTemplate, gap: 0, padding: '10px 16px', borderBottom: '1px solid var(--d-border)', background: 'var(--d-surface)' }}>
          {(['', 'Name', 'Email', 'Role', 'Status', ...(isAdmin ? ['Actions'] : [])]).map((h, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
          ))}
        </div>
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 52, borderBottom: '1px solid var(--d-border-2)' }} />)
        ) : (
          agents.map((a) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: colTemplate, gap: 0, padding: '12px 16px', borderBottom: '1px solid var(--d-border-2)', alignItems: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {initials(a.name)}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--d-text)' }}>{a.name}</span>
              <span style={{ fontSize: 13, color: 'var(--d-text-3)' }}>{a.email}</span>
              {isAdmin ? (
                <select
                  value={a.role}
                  onChange={(e) => { void handleRoleChange(a.id, e.target.value as 'ADMIN' | 'AGENT') }}
                  style={{ height: 28, padding: '0 6px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer', width: 100 }}
                >
                  <option value="AGENT">AGENT</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              ) : (
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: a.role === 'ADMIN' ? 'rgba(167,139,250,0.16)' : 'var(--d-raised)', color: a.role === 'ADMIN' ? 'var(--d-purple)' : 'var(--d-text-3)', alignSelf: 'center', justifySelf: 'start' }}>
                  {a.role}
                </span>
              )}
              <span style={{ fontSize: 12, color: a.isActive ? 'var(--d-success)' : 'var(--d-text-4)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.isActive ? 'var(--d-success)' : 'var(--d-text-4)' }} />
                {a.inviteAccepted ? (a.isActive ? 'Active' : 'Inactive') : 'Invited'}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { void handleToggleActive(a) }}
                  style={{ fontSize: 12, height: 28, padding: '0 10px', background: 'none', color: a.isActive ? 'var(--d-danger)' : 'var(--d-success)', border: `1px solid ${a.isActive ? 'var(--d-danger)' : 'var(--d-success)'}`, borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit', justifySelf: 'start' }}
                >
                  {a.isActive ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
