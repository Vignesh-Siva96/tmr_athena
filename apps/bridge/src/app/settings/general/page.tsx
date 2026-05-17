'use client'
import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Upload, Image as ImageIcon, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { api } from '@/lib/api'

interface AppConfig { appName: string; logoUrl: string | null; supportEmail?: string }

export default function GeneralSettingsPage() {
  const { agent, token } = useAuth()
  const { theme, setTheme } = useTheme()
  const isAdmin = agent?.role === 'ADMIN'

  const [orgName, setOrgName] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!token) return
    api.get<AppConfig>('/config', token)
      .then((res) => { setOrgName(res.appName ?? ''); setLogoPreview(res.logoUrl ?? null) })
      .catch(console.error)
  }, [token])

  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setLogoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!token || !isAdmin) return
    setIsSaving(true)
    try {
      // Convert file to base64 data URI and save via PATCH
      const logoUrl = logoFile
        ? await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = (e) => resolve(e.target?.result as string)
            reader.readAsDataURL(logoFile)
          })
        : logoPreview // keep existing or null if removed

      await api.patch('/config', { appName: orgName, logoUrl: logoUrl ?? null }, token)
      setLogoFile(null)
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 2000)

      // Notify sidebar to update immediately
      window.dispatchEvent(new CustomEvent('app-config-updated', {
        detail: { appName: orgName, logoUrl: logoUrl ?? null },
      }))
    } catch (err) { console.error(err) } finally { setIsSaving(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 38, padding: '0 12px',
    background: 'var(--d-raised)', border: '1px solid var(--d-border)',
    borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--d-text)',
    outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>General</h1>
      <p style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 28 }}>Workspace settings for your organisation.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* App identity — admin only */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>App identity</p>
            {!isAdmin && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: 'var(--d-raised-2)', color: 'var(--d-text-4)', border: '1px solid var(--d-border)' }}>Admin only</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* App icon */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 8 }}>App icon</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 60, height: 60, borderRadius: 12, border: '1px solid var(--d-border)', background: 'var(--d-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                  {logoPreview
                    ? <img src={logoPreview} alt="icon" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <ImageIcon size={22} style={{ color: 'var(--d-text-4)' }} />
                  }
                </div>
                {isAdmin && (
                  <div>
                    <button type="button" onClick={() => logoInputRef.current?.click()}
                      style={{ height: 32, padding: '0 14px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text-2)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={13} /> Upload icon
                    </button>
                    {logoPreview && (
                      <button type="button" onClick={() => { setLogoPreview(null); setLogoFile(null) }}
                        style={{ marginTop: 6, fontSize: 11, color: 'var(--d-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <X size={11} /> Remove
                      </button>
                    )}
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', marginTop: 6 }}>PNG or SVG, shown in the portal nav. Max 2 MB.</p>
                    <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f) }} />
                  </div>
                )}
              </div>
            </div>

            {/* App name */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>App name</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="TMR Support"
                readOnly={!isAdmin}
                style={{ ...inputStyle, ...(!isAdmin ? { cursor: 'not-allowed', opacity: 0.6 } : {}) }}
              />
              <p style={{ fontSize: 11, color: 'var(--d-text-4)', marginTop: 4 }}>Shown in the browser tab and email headers.</p>
            </div>
          </div>

          {/* Save — admin only */}
          {isAdmin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button type="button" onClick={() => { void handleSave() }} disabled={isSaving}
                style={{ height: 36, padding: '0 20px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1, fontFamily: 'inherit' }}>
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
              {isSaved && (
                <span style={{ fontSize: 12, color: 'var(--d-success)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-success)' }} /> Saved ✓
                </span>
              )}
            </div>
          )}
        </div>

        {/* Appearance */}
        <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Appearance</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)' }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--d-text)', margin: '0 0 3px' }}>Theme</p>
              <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0 }}>Choose between dark and light interface</p>
            </div>
            <div style={{ display: 'inline-flex', background: 'var(--d-raised-2)', border: '1px solid var(--d-border)', borderRadius: 999, padding: 3, gap: 2 }}>
              {(['dark', 'light'] as const).map((t) => {
                const active = theme === t
                return (
                  <button key={t} type="button" onClick={() => setTheme(t)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', borderRadius: 999, border: 'none', background: active ? 'var(--d-raised)' : 'transparent', color: active ? 'var(--d-text)' : 'var(--d-text-4)', fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none', transition: 'all 150ms' }}>
                    {t === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
