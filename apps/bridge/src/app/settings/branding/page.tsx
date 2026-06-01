'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Check, Copy, Upload, Globe, Image as ImageIcon, Sparkles, X, Loader2, RefreshCw, Plus, Trash2, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import AuthPagePreview from '@/components/settings/branding/AuthPagePreview'

type AuthLayout = 'MINIMAL' | 'BRANDED'

interface AppConfig {
  appName: string
  logoUrl: string | null
  portalTagline: string | null
  primaryColor: string
  accentColor: string
  emailDisplayName: string
  portalAuthLayout: AuthLayout
  portalHeroHeadline: string | null
  portalHeroSubheadline: string | null
  portalFeatures: string[]
}

interface ExtractedColor {
  hex: string
  source: string
  label: string
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#fff'
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return lum > 0.55 ? '#111' : '#fff'
}

/** Extract dominant colors from an image element via Canvas API */
function extractColorsFromImage(img: HTMLImageElement): string[] {
  const canvas = document.createElement('canvas')
  const MAX = 80
  const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 1)
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  // Quantise to buckets of 32 per channel and count
  const freq: Record<string, number> = {}
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 100) continue // skip transparent
    const r = Math.round(data[i] / 32) * 32
    const g = Math.round(data[i + 1] / 32) * 32
    const b = Math.round(data[i + 2] / 32) * 32
    // Skip near-black and near-white
    const brightness = (r + g + b) / 3
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
    if (brightness < 25 || brightness > 230 || maxDiff < 20) continue
    const key = `${r},${g},${b}`
    freq[key] = (freq[key] ?? 0) + 1
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(Number)
      return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ColorSwatch({ hex, label, onApply }: { hex: string; label: string; onApply: (field: 'primaryColor' | 'accentColor') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        title={hex}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 36, height: 36, borderRadius: 8,
          background: hex, border: '2px solid rgba(255,255,255,0.15)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ fontSize: 8, fontWeight: 700, color: getContrastColor(hex), fontFamily: 'var(--font-mono)', opacity: 0.8 }}>{hex.slice(1)}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 42, left: 0, zIndex: 50,
          background: 'var(--d-raised)', border: '1px solid var(--d-border)',
          borderRadius: 8, padding: 6, minWidth: 170, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          <p style={{ fontSize: 10, color: 'var(--d-text-4)', padding: '0 6px 6px', margin: 0 }}>{label} — {hex}</p>
          {(['primaryColor', 'accentColor'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => { onApply(f); setOpen(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--d-text-2)', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--d-surface)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
            >
              Use as {f === 'primaryColor' ? 'Primary color' : 'Accent color'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BrandingPage() {
  const { token } = useAuth()
  const [form, setForm] = useState({
    orgName: '',
    portalTagline: '',
    primaryColor: '#2563EB',
    accentColor: '#0EA5E9',
    emailDisplayName: '',
    logoUrl: '' as string | null,
    portalAuthLayout: 'MINIMAL' as AuthLayout,
    portalHeroHeadline: '',
    portalHeroSubheadline: '',
    portalFeatures: [''] as string[],
  })
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  // Logo upload
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Extraction
  const [extractTab, setExtractTab] = useState<'image' | 'url'>('image')
  const [extractedColors, setExtractedColors] = useState<ExtractedColor[]>([])
  const [extractUrl, setExtractUrl] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!token) return
    api.get<AppConfig>('/config', token)
      .then((res) => {
        const features = res.portalFeatures?.length ? res.portalFeatures : ['']
        setForm({
          orgName: res.appName ?? '',
          portalTagline: res.portalTagline ?? '',
          primaryColor: res.primaryColor ?? '#2563EB',
          accentColor: res.accentColor ?? '#0EA5E9',
          emailDisplayName: res.emailDisplayName ?? '',
          logoUrl: res.logoUrl ?? null,
          portalAuthLayout: res.portalAuthLayout ?? 'MINIMAL',
          portalHeroHeadline: res.portalHeroHeadline ?? '',
          portalHeroSubheadline: res.portalHeroSubheadline ?? '',
          portalFeatures: features,
        })
        if (res.logoUrl) setLogoPreview(res.logoUrl)
      }).catch(console.error)
  }, [token])

  const save = async () => {
    if (!token) return
    setIsSaving(true)
    try {
      // Upload logo first if pending
      if (logoFile) {
        setLogoUploading(true)
        const fd = new FormData()
        fd.append('logo', logoFile)
        const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
        const res = await fetch(`${apiUrl}/api/v1/config/logo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        })
        if (res.ok) {
          const json = (await res.json()) as { data: AppConfig }
          if (json.data?.logoUrl) setForm(f => ({ ...f, logoUrl: json.data.logoUrl }))
        }
        setLogoUploading(false)
        setLogoFile(null)
      }
      await api.patch('/config', {
        appName: form.orgName,
        portalTagline: form.portalTagline || null,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        emailDisplayName: form.emailDisplayName,
        portalAuthLayout: form.portalAuthLayout,
        portalHeroHeadline: form.portalHeroHeadline || null,
        portalHeroSubheadline: form.portalHeroSubheadline || null,
        portalFeatures: form.portalFeatures.filter(f => f.trim()),
      }, token)
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 3000)
    } catch (err) { console.error(err) } finally { setIsSaving(false); setLogoUploading(false) }
  }

  const copyColor = (hex: string) => {
    void navigator.clipboard.writeText(hex)
    setCopied(hex); setTimeout(() => setCopied(null), 1500)
  }

  // ─── Logo drop ────────────────────────────────────────────────────────────

  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setLogoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ─── Image color extraction ───────────────────────────────────────────────

  const extractFromImage = useCallback((file: File) => {
    setExtractError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      const img = new Image()
      img.onload = () => {
        const colors = extractColorsFromImage(img)
        setExtractedColors(colors.map((hex, i) => ({ hex: hex.toUpperCase(), source: 'image', label: `Color ${i + 1}` })))
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }, [])

  const handleExtractDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) extractFromImage(file)
  }

  const handleExtractFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) extractFromImage(file)
  }

  // ─── URL extraction ───────────────────────────────────────────────────────

  const extractFromUrl = async () => {
    if (!extractUrl.trim() || !token) return
    setExtracting(true)
    setExtractError('')
    setExtractedColors([])
    try {
      const res = await api.get<{ colors: ExtractedColor[] }>(
        `/config/extract-brand?url=${encodeURIComponent(extractUrl.trim())}`,
        token,
      )
      if (res.colors.length === 0) {
        setExtractError('No brand colors found on this page. Try a different URL.')
      } else {
        setExtractedColors(res.colors)
      }
    } catch {
      setExtractError('Could not fetch the URL. Make sure it is publicly accessible.')
    } finally {
      setExtracting(false)
    }
  }

  const applyExtracted = (hex: string, field: 'primaryColor' | 'accentColor') => {
    setForm(f => ({ ...f, [field]: hex }))
  }

  // ─── Portal auth validation ───────────────────────────────────────────────

  const brandedInvalid =
    form.portalAuthLayout === 'BRANDED' &&
    (!form.portalHeroHeadline.trim() || form.portalFeatures.filter(f => f.trim()).length < 1)

  const saveDisabled = isSaving || logoUploading || brandedInvalid

  const saveTitle = brandedInvalid
    ? 'Fill in headline + at least one feature, or switch to Minimal'
    : undefined

  // ─── Styles ───────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 36, padding: '0 12px',
    background: 'var(--d-surface)', border: '1px solid var(--d-border)',
    borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--d-text)',
    outline: 'none', fontFamily: 'inherit',
  }

  const cardStyle: React.CSSProperties = {
    padding: 20, background: 'var(--d-raised)',
    border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)',
  }

  return (
    <div style={{ maxWidth: 920 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>Branding</h1>
          <p style={{ fontSize: 13, color: 'var(--d-text-3)', margin: 0 }}>Customize how your support portal looks to customers.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isSaved && (
            <span style={{ fontSize: 12, color: 'var(--d-success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-success)' }} /> Saved ✓
            </span>
          )}
          <button type="button" onClick={() => { if (!saveDisabled) void save() }} disabled={saveDisabled} title={saveTitle}
            style={{ height: 36, padding: '0 20px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: saveDisabled ? 'not-allowed' : 'pointer', opacity: saveDisabled ? 0.5 : 1, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            {(isSaving || logoUploading) && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* ── Left column ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Identity */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Identity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Organisation name</label>
                <input value={form.orgName} onChange={(e) => setForm(f => ({ ...f, orgName: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)' }}>Portal tagline</label>
                  <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{form.portalTagline.length} / 80</span>
                </div>
                <input value={form.portalTagline} onChange={(e) => setForm(f => ({ ...f, portalTagline: e.target.value.slice(0, 80) }))} placeholder="Support that actually works." style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Logo */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Logo</h3>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 14px' }}>Shown in the portal nav and sign-in page. PNG or SVG, max 2 MB.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Preview */}
              <div style={{ width: 64, height: 64, borderRadius: 10, border: '1px solid var(--d-border)', background: 'var(--d-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {logoPreview
                  ? <img src={logoPreview} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <ImageIcon size={22} style={{ color: 'var(--d-text-4)' }} />
                }
              </div>
              <div style={{ flex: 1 }}>
                <button type="button" onClick={() => logoInputRef.current?.click()}
                  style={{ height: 34, padding: '0 14px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text-2)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Upload size={13} /> Upload logo
                </button>
                {logoPreview && (
                  <button type="button" onClick={() => { setLogoPreview(null); setLogoFile(null); setForm(f => ({ ...f, logoUrl: null })) }}
                    style={{ marginTop: 6, fontSize: 11, color: 'var(--d-danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <X size={11} /> Remove logo
                  </button>
                )}
                <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f) }} />
              </div>
            </div>
          </div>

          {/* Colors */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Colors</h3>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 16px' }}>Portal buttons, links, and accent elements.</p>
            <div style={{ display: 'flex', gap: 12 }}>
              {([['primaryColor', 'Primary'] as const, ['accentColor', 'Accent'] as const]).map(([key, label]) => (
                <div key={key} style={{ flex: 1, padding: '12px 14px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: form[key], border: '2px solid rgba(255,255,255,0.1)', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
                    {/* Native color picker overlaid */}
                    <input
                      type="color"
                      value={form[key]}
                      onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value.toUpperCase() }))}
                      style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-2)', margin: '0 0 2px' }}>{label}</p>
                    <button type="button" onClick={() => copyColor(form[key])}
                      style={{ fontSize: 11, color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {form[key]} {copied === form[key] ? <Check size={10} style={{ color: 'var(--d-success)' }} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Email */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email</h3>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 14px' }}>How outbound replies appear in your customer&apos;s inbox.</p>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Display name</label>
              <input value={form.emailDisplayName} onChange={(e) => setForm(f => ({ ...f, emailDisplayName: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          {/* ── Portal auth page ── */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portal auth page</h3>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 14px' }}>Choose how the sign-in page looks to your customers.</p>

            {/* Layout radio */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {(['MINIMAL', 'BRANDED'] as const).map((layout) => (
                <label
                  key={layout}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                    border: `1px solid ${form.portalAuthLayout === layout ? 'var(--d-accent)' : 'var(--d-border)'}`,
                    borderRadius: 'var(--r-md)', cursor: 'pointer',
                    background: form.portalAuthLayout === layout ? 'var(--d-accent-bg, rgba(37,99,235,0.08))' : 'var(--d-surface)',
                  }}
                >
                  <input
                    type="radio"
                    name="portalAuthLayout"
                    value={layout}
                    checked={form.portalAuthLayout === layout}
                    onChange={() => setForm(f => ({ ...f, portalAuthLayout: layout }))}
                    style={{ accentColor: 'var(--d-accent)' }}
                  />
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text)', margin: 0 }}>{layout === 'MINIMAL' ? 'Minimal' : 'Branded'}</p>
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: '1px 0 0' }}>
                      {layout === 'MINIMAL' ? 'Centered form, logo + name above' : 'Split left/right with hero copy'}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Branded fields (always rendered, only shown when Branded) */}
            {form.portalAuthLayout === 'BRANDED' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)' }}>
                      Hero headline <span style={{ color: 'var(--d-danger)' }}>*</span>
                    </label>
                    <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{form.portalHeroHeadline.length} / 80</span>
                  </div>
                  <input
                    value={form.portalHeroHeadline}
                    onChange={(e) => setForm(f => ({ ...f, portalHeroHeadline: e.target.value.slice(0, 80) }))}
                    placeholder="Support that actually works."
                    style={{ ...inputStyle, borderColor: brandedInvalid && !form.portalHeroHeadline.trim() ? 'var(--d-danger)' : 'var(--d-border)' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)' }}>Hero subheadline</label>
                    <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{form.portalHeroSubheadline.length} / 200</span>
                  </div>
                  <textarea
                    value={form.portalHeroSubheadline}
                    onChange={(e) => setForm(f => ({ ...f, portalHeroSubheadline: e.target.value.slice(0, 200) }))}
                    placeholder="Create a ticket in seconds, track every reply in one place."
                    rows={3}
                    style={{ ...inputStyle, height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>
                    Features <span style={{ color: 'var(--d-danger)' }}>*</span>
                    <span style={{ fontWeight: 400, color: 'var(--d-text-4)', marginLeft: 4 }}>(at least 1, max 5)</span>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {form.portalFeatures.map((feat, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={feat}
                          onChange={(e) => {
                            const next = [...form.portalFeatures]
                            next[idx] = e.target.value
                            setForm(f => ({ ...f, portalFeatures: next }))
                          }}
                          placeholder={`Feature ${idx + 1}`}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        {form.portalFeatures.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, portalFeatures: f.portalFeatures.filter((_, i) => i !== idx) }))}
                            style={{ width: 32, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', color: 'var(--d-danger)', cursor: 'pointer' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {form.portalFeatures.length < 5 && (
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, portalFeatures: [...f.portalFeatures, ''] }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', background: 'none', border: '1px dashed var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-3)', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        <Plus size={12} /> Add feature
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--d-border)' }}>
              <a
                href={`${process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3000'}/auth`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: 'var(--d-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                Open portal auth page <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {/* ── Theme extraction ── */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Sparkles size={14} style={{ color: 'var(--d-accent)' }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Extract brand colors</h3>
            </div>
            <p style={{ fontSize: 12, color: 'var(--d-text-4)', margin: '0 0 14px' }}>
              Upload your logo or paste your website URL — we&apos;ll suggest brand colors automatically.
            </p>

            {/* Tab switcher */}
            <div style={{ display: 'inline-flex', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 14 }}>
              {(['image', 'url'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => { setExtractTab(tab); setExtractedColors([]); setExtractError('') }}
                  style={{ height: 28, padding: '0 14px', borderRadius: 6, border: 'none', background: extractTab === tab ? 'var(--d-raised)' : 'transparent', color: extractTab === tab ? 'var(--d-text)' : 'var(--d-text-4)', fontSize: 12, fontWeight: extractTab === tab ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, boxShadow: extractTab === tab ? '0 1px 3px rgba(0,0,0,0.15)' : 'none' }}>
                  {tab === 'image' ? <ImageIcon size={12} /> : <Globe size={12} />}
                  {tab === 'image' ? 'From image' : 'From website'}
                </button>
              ))}
            </div>

            {extractTab === 'image' ? (
              <div>
                <div
                  ref={dropRef}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleExtractDrop}
                  onClick={() => document.getElementById('extract-file-input')?.click()}
                  style={{ border: '1.5px dashed var(--d-border)', borderRadius: 8, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: 'var(--d-surface)', transition: 'border-color 150ms' }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--d-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--d-border)')}
                >
                  <ImageIcon size={20} style={{ color: 'var(--d-text-4)', marginBottom: 6 }} />
                  <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: '0 0 2px' }}>Drop an image or <span style={{ color: 'var(--d-accent)' }}>browse</span></p>
                  <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>PNG, JPG, SVG — your logo works great</p>
                  <input id="extract-file-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleExtractFile} />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={extractUrl}
                  onChange={(e) => setExtractUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void extractFromUrl() }}
                  placeholder="https://yourcompany.com"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button type="button" onClick={() => { void extractFromUrl() }} disabled={extracting || !extractUrl.trim()}
                  style={{ height: 36, padding: '0 14px', background: 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: extracting ? 'not-allowed' : 'pointer', opacity: extracting ? 0.7 : 1, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {extracting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                  {extracting ? 'Scanning…' : 'Scan'}
                </button>
              </div>
            )}

            {/* Results */}
            {extractError && (
              <p style={{ fontSize: 12, color: 'var(--d-warning)', marginTop: 10 }}>{extractError}</p>
            )}
            {extractedColors.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 11, color: 'var(--d-text-4)', marginBottom: 8 }}>Click a color to apply it as Primary or Accent →</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {extractedColors.map((c) => (
                    <ColorSwatch key={c.hex} hex={c.hex} label={c.label} onApply={(field) => applyExtracted(c.hex, field)} />
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* ── Right column: Live preview ── */}
        <div style={{ width: 290, flexShrink: 0, position: 'sticky', top: 24 }}>
          <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--d-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Portal Preview</p>
              <span style={{ fontSize: 10, color: 'var(--d-text-4)' }}>Live</span>
            </div>

            {/* Fake browser chrome */}
            <div style={{ background: '#111', padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['#EF4444', '#F59E0B', '#22C55E'].map((c) => <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />)}
                </div>
                <div style={{ flex: 1, height: 17, background: 'rgba(255,255,255,0.06)', borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>support.{(form.orgName || 'tmr').toLowerCase()}.com</span>
                </div>
              </div>
            </div>

            {/* Portal mockup */}
            <div style={{ background: '#FAFAFA', padding: 14 }}>
              {/* Nav */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #E4E4E7' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {logoPreview
                    ? <img src={logoPreview} alt="" style={{ height: 20, maxWidth: 60, objectFit: 'contain' }} />
                    : <div style={{ width: 20, height: 20, borderRadius: 5, background: form.primaryColor }} />
                  }
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#09090B' }}>{form.orgName || 'Support'}</span>
                </div>
                <span style={{ fontSize: 9, color: form.primaryColor, fontWeight: 500 }}>My Tickets</span>
              </div>

              {/* Hero */}
              <p style={{ fontSize: 15, fontWeight: 700, color: '#09090B', margin: '0 0 3px' }}>How can we help?</p>
              {form.portalTagline
                ? <p style={{ fontSize: 10, color: '#71717A', margin: '0 0 10px' }}>{form.portalTagline}</p>
                : <p style={{ fontSize: 10, color: '#A1A1AA', margin: '0 0 10px', fontStyle: 'italic' }}>Add a tagline above…</p>
              }

              {/* Category pills */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 10 }}>
                {['Bug', 'Feature', 'Q', 'Billing', 'Other'].map((c, i) => (
                  <div key={c} style={{ padding: '5px 2px', border: `1px solid ${i === 0 ? form.primaryColor : '#E4E4E7'}`, borderRadius: 4, textAlign: 'center', background: i === 0 ? `${form.primaryColor}18` : '#fff' }}>
                    <div style={{ fontSize: 8, color: i === 0 ? form.primaryColor : '#52525B', fontWeight: i === 0 ? 600 : 400 }}>{c}</div>
                  </div>
                ))}
              </div>

              {/* Input + button */}
              <div style={{ height: 22, background: '#fff', border: '1px solid #E4E4E7', borderRadius: 4, marginBottom: 8 }} />
              <div style={{ height: 28, background: form.primaryColor, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: getContrastColor(form.primaryColor) }}>Submit ticket →</span>
              </div>

              {/* Accent bar */}
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, height: 3, borderRadius: 2, background: form.primaryColor, opacity: 0.8 }} />
                <div style={{ flex: 1, height: 3, borderRadius: 2, background: form.accentColor, opacity: 0.5 }} />
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--d-border)' }}>
              <a href={`${process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3000'}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 10, color: 'var(--d-accent)', textDecoration: 'none' }}>
                Open live portal →
              </a>
            </div>
          </div>
          {/* Auth page preview */}
          <div style={{ marginTop: 16 }}>
            <AuthPagePreview
              layout={form.portalAuthLayout}
              headline={form.portalHeroHeadline}
              subheadline={form.portalHeroSubheadline}
              features={form.portalFeatures}
              primaryColor={form.primaryColor}
              accentColor={form.accentColor}
              logoUrl={logoPreview}
              appName={form.orgName || 'Support'}
            />
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
