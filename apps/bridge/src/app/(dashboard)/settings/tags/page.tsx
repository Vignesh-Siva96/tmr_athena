'use client'
import { useEffect, useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/Dialog'

const TAG_PALETTE = [
  '#71717A', '#3B82F6', '#22C55E', '#F59E0B',
  '#EF4444', '#A78BFA', '#EC4899', '#14B8A6',
] as const

interface Tag { id: string; name: string; color: string; _count: { tickets: number } }

function TagForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { name: string; color: string }
  onSave: (name: string, color: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? TAG_PALETTE[0])

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', marginBottom: 16 }}>
      <div style={{ flex: '1 1 180px' }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. billing, urgent"
          maxLength={40}
          style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Color</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {TAG_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                outline: color === c ? `2px solid ${c}` : 'none',
                outlineOffset: 2,
              }}
            >
              {color === c && <Check size={12} color="#fff" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => { if (name.trim()) onSave(name.trim(), color) }}
          disabled={saving || !name.trim()}
          style={{ height: 34, padding: '0 16px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: saving || !name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !name.trim() ? 0.7 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ height: 34, padding: '0 12px', background: 'none', color: 'var(--d-text-3)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function TagsSettingsPage() {
  const { token } = useAuth()
  const [tags, setTags] = useState<Tag[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)

  const load = () => {
    if (!token) return
    setIsLoading(true)
    api.get<{ data: Tag[] }>('/tags', token)
      .then((res) => setTags(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (name: string, color: string) => {
    if (!token) return
    setSaving(true)
    try {
      await api.post('/tags', { name, color }, token)
      setShowCreate(false)
      load()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const handleUpdate = async (tagId: string, name: string, color: string) => {
    if (!token) return
    setSaving(true)
    try {
      await api.patch(`/tags/${tagId}`, { name, color }, token)
      setEditingId(null)
      load()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const handleDelete = async (tag: Tag) => {
    if (!token) return
    try {
      await api.delete(`/tags/${tag.id}`, token)
      load()
    } catch (err) { console.error(err) }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete tag "${deleteTarget.name}"?`}
          message={
            deleteTarget._count.tickets > 0
              ? `It is assigned to ${deleteTarget._count.tickets} ticket${deleteTarget._count.tickets !== 1 ? 's' : ''}. Deleting will remove it from those tickets.`
              : 'This action cannot be undone.'
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => { void handleDelete(deleteTarget); setDeleteTarget(null) }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showCreate ? 16 : 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>Tags ({tags.length})</h1>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>Reusable labels for triage and filtering.</p>
        </div>
        {/* E4: show X icon when open, Plus when closed */}
        <button
          type="button"
          onClick={() => { setShowCreate((v) => !v); setEditingId(null) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: showCreate ? 'var(--d-raised)' : 'var(--d-accent)', color: showCreate ? 'var(--d-text)' : '#fff', border: showCreate ? '1px solid var(--d-border)' : 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showCreate ? <X size={14} /> : <Plus size={14} />} {showCreate ? 'Cancel' : 'New tag'}
        </button>
      </div>

      {showCreate && (
        <TagForm
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          saving={saving}
        />
      )}

      <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 52, borderBottom: '1px solid var(--d-border-2)' }} />)
        ) : tags.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>No tags yet. Create one above.</div>
        ) : (
          tags.map((tag) => (
            <div key={tag.id} style={{ borderBottom: '1px solid var(--d-border-2)' }}>
              {editingId === tag.id ? (
                <div style={{ padding: '10px 16px' }}>
                  <TagForm
                    initial={{ name: tag.name, color: tag.color }}
                    onSave={(name, color) => { void handleUpdate(tag.id, name, color) }}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--d-text)', flex: 1 }}>{tag.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--d-text-4)' }}>{tag._count.tickets} ticket{tag._count.tickets !== 1 ? 's' : ''}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => { setEditingId(tag.id); setShowCreate(false) }}
                      style={{ fontSize: 12, height: 28, padding: '0 10px', background: 'none', color: 'var(--d-text-3)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(tag)}
                      style={{ fontSize: 12, height: 28, padding: '0 10px', background: 'none', color: 'var(--d-danger)', border: '1px solid var(--d-danger)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <X size={12} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
