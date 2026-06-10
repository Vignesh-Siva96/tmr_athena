'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { X, Edit2, Plus, Trash2, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { UserCategoryControl, STATUS_CLS, STATUS_LABEL } from './TicketPreviewPanel'
import type { UserCategory } from './TicketPreviewPanel'

type TicketStatus = 'NEW' | 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED' | 'DISMISSED'

interface UserProfile {
  id: string; email: string; name: string | null; avatarUrl: string | null
  isGuest: boolean; category: UserCategory; lastActiveAt: string | null; createdAt: string
}
interface TicketRow {
  id: string; displayId: string; title: string; status: TicketStatus; isTicket: boolean; updatedAt: string
}
interface CustomerNote { id: string; body: string; createdAt: string; agent: { id: string; name: string; avatarUrl: string | null } }
interface ProfileData {
  user: UserProfile
  stats: { totalTickets: number; openTickets: number; avgReplyTime?: number }
  recentTickets: TicketRow[]
  notes: CustomerNote[]
}

function initials(name: string | null, email: string): string {
  if (name) { const p = name.trim().split(' '); return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase() }
  return email.slice(0, 2).toUpperCase()
}

interface Props { userId: string; onClose: () => void; currentTicketId?: string }

export function CustomerProfilePanel({ userId, onClose, currentTicketId }: Props) {
  const router = useRouter()
  const { agent, token } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [noteBody, setNoteBody] = useState('')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const load = useCallback(() => {
    if (!token) return
    api.get<ProfileData>(`/users/${userId}`, token)
      .then(setProfile).catch(console.error).finally(() => setIsLoading(false))
  }, [token, userId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const addNote = async () => {
    if (!noteBody.trim() || !token) return
    setIsAddingNote(true)
    try {
      await api.post(`/users/${userId}/notes`, { body: noteBody }, token)
      setNoteBody('')
      load()
    } catch (err) { console.error(err) } finally { setIsAddingNote(false) }
  }

  const saveEditNote = async (noteId: string) => {
    if (!editingBody.trim() || !token) return
    try {
      await api.patch(`/users/${userId}/notes/${noteId}`, { body: editingBody }, token)
      setEditingNoteId(null)
      load()
    } catch (err) { console.error(err) }
  }

  const deleteNote = async (noteId: string) => {
    if (!token) return
    try {
      await api.delete(`/users/${userId}/notes/${noteId}`, token)
      load()
    } catch (err) { console.error(err) }
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50 }} />

      {/* Panel */}
      <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 480, background: 'var(--d-surface)', borderLeft: '1px solid var(--d-border)', zIndex: 51, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--d-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Customer Profile</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" style={{ width: 28, height: 28, borderRadius: 'var(--r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
              <Edit2 size={14} />
            </button>
            <button type="button" onClick={onClose} style={{ width: 28, height: 28, borderRadius: 'var(--r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {isLoading || !profile ? (
          <div style={{ padding: 20 }}>
            {[...Array(4)].map((_, i) => <div key={i} className="shimmer" style={{ height: 60, borderRadius: 8, marginBottom: 12 }} />)}
          </div>
        ) : (
          <>
            {/* User info */}
            <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--d-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #7C3AED, #3B82F6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
                  {initials(profile.user.name, profile.user.email)}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)' }}>{profile.user.name ?? 'Guest'}</p>
                    <UserCategoryControl userId={profile.user.id} category={profile.user.category ?? 'CUSTOMER'} />
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>{profile.user.email}</p>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  { value: profile.stats.totalTickets, label: 'Total tickets' },
                  { value: profile.stats.openTickets, label: 'Open', warn: profile.stats.openTickets > 0 },
                  { value: profile.stats.avgReplyTime ? `${profile.stats.avgReplyTime}h` : '—', label: 'Avg reply' },
                  { value: '—', label: 'Satisfaction' },
                ].map(({ value, label, warn }) => (
                  <div key={label} style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: warn ? 'rgba(245,158,11,0.08)' : 'var(--d-raised)', border: '1px solid var(--d-border)' }}>
                    <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}>{value}</p>
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{label}</p>
                  </div>
                ))}
              </div>

              {profile.user.lastActiveAt && (
                <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-success)' }} />
                  Last active {new Date(profile.user.lastActiveAt).toLocaleDateString()}
                </p>
              )}
            </div>

            {/* Conversation & ticket history */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--d-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Conversations &amp; Tickets</p>
                <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{profile.recentTickets.length} shown</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {profile.recentTickets.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--d-text-4)', fontStyle: 'italic', margin: 0 }}>No conversations yet.</p>
                ) : profile.recentTickets.map((t) => {
                  const isCurrent = t.id === currentTicketId
                  return (
                    <div key={t.id}
                      onClick={() => router.push(`/tickets/${t.id}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: isCurrent ? 'rgba(59,130,246,0.08)' : 'transparent', transition: 'background 80ms' }}
                      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'var(--d-raised)' }}
                      onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent' }}
                    >
                      {t.isTicket && <span className="mono" style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0 }}>{t.displayId}</span>}
                      {isCurrent && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'rgba(59,130,246,0.2)', color: 'var(--d-accent)', flexShrink: 0 }}>CURRENT</span>}
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--d-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      <span className={`pill ${STATUS_CLS[t.status]}`} style={{ flexShrink: 0 }}><span className="dot" />{STATUS_LABEL[t.status]}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Internal notes */}
            <div style={{ padding: '16px 20px', flex: 1 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Internal Notes</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {profile.notes.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--d-text-4)', fontStyle: 'italic' }}>No notes yet.</p>
                ) : (
                  profile.notes.map((note) => (
                    <div key={note.id} style={{ padding: 12, background: 'var(--d-raised)', borderRadius: 'var(--r-md)', border: '1px solid var(--d-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--d-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                          {initials(note.agent.name, '')}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--d-text)' }}>{note.agent.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{new Date(note.createdAt).toLocaleDateString()}</span>
                        {note.agent.id === agent?.id && (
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                            <button type="button" onClick={() => { setEditingNoteId(note.id); setEditingBody(note.body) }}
                              style={{ width: 22, height: 22, borderRadius: 'var(--r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              <Edit2 size={11} />
                            </button>
                            <button type="button" onClick={() => deleteNote(note.id)}
                              style={{ width: 22, height: 22, borderRadius: 'var(--r-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                      {editingNoteId === note.id ? (
                        <div>
                          <textarea
                            value={editingBody}
                            onChange={(e) => setEditingBody(e.target.value)}
                            autoFocus
                            style={{ width: '100%', minHeight: 64, padding: '8px 10px', border: '1px solid var(--d-accent)', borderRadius: 'var(--r-sm)', background: 'var(--d-surface)', color: 'var(--d-text)', fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'none' }}
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                            <button type="button" onClick={() => saveEditNote(note.id)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                              <Check size={11} /> Save
                            </button>
                            <button type="button" onClick={() => setEditingNoteId(null)}
                              style={{ height: 26, padding: '0 10px', background: 'var(--d-raised)', color: 'var(--d-text-3)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.5, margin: 0 }}>{note.body}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
              {/* Add note */}
              <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Add a note about this customer…"
                  style={{ width: '100%', minHeight: 72, padding: '10px 12px', border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: 13, color: 'var(--d-text)', background: 'transparent' }}
                />
                {noteBody.trim() && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', borderTop: '1px solid var(--d-border-2)' }}>
                    <button type="button" onClick={addNote} disabled={isAddingNote}
                      style={{ height: 28, padding: '0 12px', background: 'var(--d-accent)', color: '#fff', borderRadius: 'var(--r-sm)', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={12} /> {isAddingNote ? 'Adding…' : 'Add note'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
