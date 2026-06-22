'use client'
import { useEffect, useState, useRef } from 'react'
import { Plus, X, Bold, Italic, Link as LinkIcon, List } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { ConfirmDialog, PromptDialog } from '@/components/ui/Dialog'

interface CannedResponse { id: string; name: string; body: string; updatedAt: string }

function RichEditor({
  initialHtml,
  onHtmlChange,
  placeholder,
}: {
  initialHtml: string
  onHtmlChange: (html: string) => void
  placeholder?: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const savedRangeRef = useRef<Range | null>(null)

  // Only fire when switching edit targets, not on every keystroke (E1 fix)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== initialHtml) {
      editorRef.current.innerHTML = initialHtml
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  const applyFormat = (type: 'bold' | 'italic' | 'link' | 'list') => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    if (type === 'bold') document.execCommand('bold', false)
    else if (type === 'italic') document.execCommand('italic', false)
    else if (type === 'link') {
      // E2: capture selection before dialog steals focus, then open in-app modal
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange()
      setLinkDialogOpen(true)
      return
    } else if (type === 'list') document.execCommand('insertUnorderedList', false)
    onHtmlChange(editor.innerHTML)
  }

  const insertLink = (url: string) => {
    setLinkDialogOpen(false)
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    const sel = window.getSelection()
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
    document.execCommand('createLink', false, url)
    onHtmlChange(editor.innerHTML)
  }

  return (
    <>
      {linkDialogOpen && (
        <PromptDialog
          title="Insert link"
          placeholder="https://"
          initialValue="https://"
          confirmLabel="Insert"
          onConfirm={insertLink}
          onCancel={() => setLinkDialogOpen(false)}
        />
      )}
      <div style={{ border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--d-surface)' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 1, padding: '6px 10px', borderBottom: '1px solid var(--d-border-2)', background: 'var(--d-raised)' }}>
          {([
            { Icon: Bold,     action: () => applyFormat('bold'),   title: 'Bold (⌘B)' },
            { Icon: Italic,   action: () => applyFormat('italic'), title: 'Italic (⌘I)' },
            { Icon: LinkIcon, action: () => applyFormat('link'),   title: 'Insert link' },
            { Icon: List,     action: () => applyFormat('list'),   title: 'Bullet list' },
          ] as { Icon: React.ElementType; action: () => void; title: string }[]).map(({ Icon, action, title }, i) => (
            <button key={i} type="button" title={title} onClick={action}
              style={{ width: 26, height: 26, borderRadius: 4, color: 'var(--d-text-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--d-text-2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--d-text-4)' }}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
        {/* Editor */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="rt-editor"
          data-placeholder={placeholder ?? 'Write template body…'}
          onInput={(e) => onHtmlChange((e.currentTarget as HTMLDivElement).innerHTML)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); applyFormat('bold') }
            if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); applyFormat('italic') }
          }}
          style={{ minHeight: 140, padding: '12px 14px', outline: 'none', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, color: 'var(--d-text)', background: 'transparent', wordBreak: 'break-word' }}
        />
      </div>
    </>
  )
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

function CannedForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { name: string; body: string }
  onSave: (name: string, body: string) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [body, setBody] = useState(initial?.body ?? '')

  // E3: compute disabled state and drive visual styles
  const isDisabled = saving || !name.trim() || !stripHtml(body)

  return (
    <div style={{ padding: 16, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Name <span style={{ color: 'var(--d-text-4)', fontWeight: 400 }}>(used in the /slash command)</span></label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. billing-faq, welcome"
          maxLength={80}
          style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 4 }}>Body</label>
        {/* E1: pass stable initialHtml; body state is for saving only */}
        <RichEditor
          initialHtml={initial?.body ?? ''}
          onHtmlChange={setBody}
          placeholder="Write the template body…"
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => { if (!isDisabled) onSave(name.trim(), body) }}
          disabled={isDisabled}
          style={{
            height: 34, padding: '0 16px',
            background: 'var(--d-accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            opacity: isDisabled ? 0.5 : 1,
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}
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

export default function CannedResponsesSettingsPage() {
  const { token } = useAuth()
  const [responses, setResponses] = useState<CannedResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CannedResponse | null>(null)

  const load = () => {
    if (!token) return
    setIsLoading(true)
    api.get<{ data: CannedResponse[] }>('/canned-responses', token)
      .then((res) => setResponses(res.data))
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (name: string, body: string) => {
    if (!token) return
    setSaving(true)
    try {
      await api.post('/canned-responses', { name, body }, token)
      setShowCreate(false)
      load()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const handleUpdate = async (id: string, name: string, body: string) => {
    if (!token) return
    setSaving(true)
    try {
      await api.patch(`/canned-responses/${id}`, { name, body }, token)
      setEditingId(null)
      load()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const handleDelete = async (r: CannedResponse) => {
    if (!token) return
    try {
      await api.delete(`/canned-responses/${r.id}`, token)
      load()
    } catch (err) { console.error(err) }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete template "${deleteTarget.name}"?`}
          message="This action cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => { void handleDelete(deleteTarget); setDeleteTarget(null) }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showCreate ? 16 : 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 4px', fontFamily: 'var(--font-display)' }}>Canned Responses ({responses.length})</h1>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>Pre-written reply templates. Insert in any composer with <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--d-raised)', padding: '1px 5px', borderRadius: 4 }}>/name</code>.</p>
        </div>
        {/* E4: show X icon when open, Plus when closed */}
        <button
          type="button"
          onClick={() => { setShowCreate((v) => !v); setEditingId(null) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: showCreate ? 'var(--d-raised)' : 'var(--d-accent)', color: showCreate ? 'var(--d-text)' : '#fff', border: showCreate ? '1px solid var(--d-border)' : 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Cancel' : 'New template'}
        </button>
      </div>

      {showCreate && (
        <CannedForm
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          saving={saving}
        />
      )}

      <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="shimmer" style={{ height: 64, borderBottom: '1px solid var(--d-border-2)' }} />)
        ) : responses.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--d-text-4)', fontSize: 13 }}>
            No templates yet. Create one to insert with <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>/name</code> in a reply composer.
          </div>
        ) : (
          responses.map((r) => (
            <div key={r.id} style={{ borderBottom: '1px solid var(--d-border-2)' }}>
              {editingId === r.id ? (
                <div style={{ padding: '10px 16px' }}>
                  <CannedForm
                    initial={{ name: r.name, body: r.body }}
                    onSave={(name, body) => { void handleUpdate(r.id, name, body) }}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </div>
              ) : (
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', marginBottom: 3 }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--d-raised-2)', padding: '1px 5px', borderRadius: 3, color: 'var(--d-accent)' }}>/{r.name}</code>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--d-text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stripHtml(r.body).slice(0, 120) || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => { setEditingId(r.id); setShowCreate(false) }}
                        style={{ fontSize: 12, height: 28, padding: '0 10px', background: 'none', color: 'var(--d-text-3)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        style={{ fontSize: 12, height: 28, padding: '0 10px', background: 'none', color: 'var(--d-danger)', border: '1px solid var(--d-danger)', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <X size={12} /> Delete
                      </button>
                    </div>
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
