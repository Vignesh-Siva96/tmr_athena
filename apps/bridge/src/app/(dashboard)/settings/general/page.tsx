'use client'
import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Upload, Image as ImageIcon, X } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { api } from '@/lib/api'
import { Skeleton } from '@/components/Skeleton'

interface AppConfig {
  appName: string
  logoUrl: string | null
  supportEmail?: string
  maintenanceMode: boolean
  featConfirmationEmail: boolean
  featBotReply: boolean
  featAiAnalysis: boolean
  featCsatSurvey: boolean
  featGithubIssueCreation: boolean
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--d-accent)' : 'var(--d-text-4)',
        position: 'relative', transition: 'background 150ms', flexShrink: 0,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 150ms',
      }} />
    </button>
  )
}

export default function GeneralSettingsPage() {
  const { agent, token } = useAuth()
  const { theme, setTheme } = useTheme()
  const isAdmin = agent?.role === 'ADMIN'

  const [orgName, setOrgName] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Maintenance mode state
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [featConfirmationEmail, setFeatConfirmationEmail] = useState(true)
  const [featBotReply, setFeatBotReply] = useState(true)
  const [featAiAnalysis, setFeatAiAnalysis] = useState(true)
  const [featCsatSurvey, setFeatCsatSurvey] = useState(true)
  const [featGithubIssueCreation, setFeatGithubIssueCreation] = useState(true)
  const [showMaintenanceConfirm, setShowMaintenanceConfirm] = useState(false)
  const [pendingMaintenanceValue, setPendingMaintenanceValue] = useState(false)
  const [isTogglingFeature, setIsTogglingFeature] = useState(false)

  useEffect(() => {
    if (!token) return
    api.get<AppConfig>('/config', token)
      .then((res) => {
        setOrgName(res.appName ?? '')
        setLogoPreview(res.logoUrl ?? null)
        setMaintenanceMode(res.maintenanceMode ?? false)
        setFeatConfirmationEmail(res.featConfirmationEmail ?? true)
        setFeatBotReply(res.featBotReply ?? true)
        setFeatAiAnalysis(res.featAiAnalysis ?? true)
        setFeatCsatSurvey(res.featCsatSurvey ?? true)
        setFeatGithubIssueCreation(res.featGithubIssueCreation ?? true)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
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
      const logoUrl = logoFile
        ? await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = (e) => resolve(e.target?.result as string)
            reader.readAsDataURL(logoFile)
          })
        : logoPreview

      await api.patch('/config', { appName: orgName, logoUrl: logoUrl ?? null }, token)
      setLogoFile(null)
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 2000)

      window.dispatchEvent(new CustomEvent('app-config-updated', {
        detail: { appName: orgName, logoUrl: logoUrl ?? null },
      }))
    } catch (err) { console.error(err) } finally { setIsSaving(false) }
  }

  const patchFlag = async (data: Partial<AppConfig>) => {
    if (!token || !isAdmin || isTogglingFeature) return
    setIsTogglingFeature(true)
    try {
      await api.patch('/config', data, token)
    } catch (err) { console.error(err) } finally { setIsTogglingFeature(false) }
  }

  const handleMasterToggleRequest = (value: boolean) => {
    setPendingMaintenanceValue(value)
    setShowMaintenanceConfirm(true)
  }

  const confirmMasterToggle = async () => {
    setShowMaintenanceConfirm(false)
    setMaintenanceMode(pendingMaintenanceValue)
    await patchFlag({ maintenanceMode: pendingMaintenanceValue })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 38, padding: '0 12px',
    background: 'var(--d-raised)', border: '1px solid var(--d-border)',
    borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--d-text)',
    outline: 'none', fontFamily: 'inherit',
  }

  const featureRows: { key: keyof AppConfig; label: string; description: string; state: boolean; setState: (v: boolean) => void }[] = [
    { key: 'featConfirmationEmail', label: 'Confirmation emails', description: 'Send an email to customers when a ticket is created.', state: featConfirmationEmail, setState: setFeatConfirmationEmail },
    { key: 'featBotReply', label: 'AI bot auto-reply', description: 'Athena first-responder bot replies to new tickets using the knowledge base.', state: featBotReply, setState: setFeatBotReply },
    { key: 'featAiAnalysis', label: 'AI ticket analysis', description: 'Sentiment analysis, topic classification, and CSAT scoring via Gemini.', state: featAiAnalysis, setState: setFeatAiAnalysis },
    { key: 'featCsatSurvey', label: 'CSAT survey emails', description: 'Send a satisfaction survey to customers when a ticket is resolved.', state: featCsatSurvey, setState: setFeatCsatSurvey },
    { key: 'featGithubIssueCreation', label: 'GitHub issue creation', description: 'Allow agents to create GitHub issues from tickets.', state: featGithubIssueCreation, setState: setFeatGithubIssueCreation },
  ]

  if (loading) {
    return (
      <div style={{ maxWidth: 600 }}>
        <Skeleton h={28} w="120px" radius={6} style={{ marginBottom: 10 }} />
        <Skeleton h={13} w="280px" radius={4} style={{ marginBottom: 28 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* App identity skeleton */}
          <div>
            <Skeleton h={11} w="90px" radius={4} style={{ marginBottom: 14 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <Skeleton h={60} w="60px" radius={12} />
              <div style={{ flex: 1 }}>
                <Skeleton h={11} w="80px" radius={4} style={{ marginBottom: 6 }} />
                <Skeleton h={32} radius={6} />
              </div>
            </div>
            <Skeleton h={11} w="60%" radius={4} style={{ marginBottom: 8 }} />
            <Skeleton h={38} radius={6} />
          </div>
          {/* Appearance skeleton */}
          <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: 20 }}>
            <Skeleton h={11} w="100px" radius={4} style={{ marginBottom: 14 }} />
            <Skeleton h={52} radius={8} />
          </div>
          {/* Feature flags skeleton */}
          <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: 20 }}>
            <Skeleton h={11} w="140px" radius={4} style={{ marginBottom: 14 }} />
            <Skeleton h={56} radius={8} style={{ marginBottom: 2 }} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} h={44} radius={6} style={{ marginBottom: 2 }} />
            ))}
          </div>
        </div>
      </div>
    )
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

        {/* Maintenance mode — admin only */}
        {isAdmin && (
          <div style={{ borderTop: '1px solid var(--d-border)', paddingTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--d-text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>Maintenance mode</p>
              {maintenanceMode && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: 'var(--d-warning, #92400e)', color: '#fff' }}>Active</span>
              )}
            </div>

            {/* Master toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: maintenanceMode ? 'rgba(239,68,68,0.06)' : 'var(--d-raised)', border: `1px solid ${maintenanceMode ? 'var(--d-danger)' : 'var(--d-border)'}`, borderRadius: 'var(--r-md)', marginBottom: 2 }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)', margin: '0 0 3px' }}>Maintenance mode</p>
                <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: 0 }}>
                  {maintenanceMode
                    ? 'All automated actions are paused. Turn off to resume normal operation.'
                    : 'Pause all automated emails, AI, and GitHub actions at once.'}
                </p>
              </div>
              <Switch checked={maintenanceMode} onChange={handleMasterToggleRequest} />
            </div>

            {/* Individual feature flags */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 8 }}>
              {featureRows.map((row) => (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: 'var(--d-surface)', border: '1px solid var(--d-border-2)', borderRadius: 'var(--r-sm)' }}>
                  <div style={{ opacity: maintenanceMode ? 0.5 : 1 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--d-text)', margin: '0 0 2px' }}>{row.label}</p>
                    <p style={{ fontSize: 11, color: 'var(--d-text-4)', margin: 0 }}>
                      {maintenanceMode ? 'Overridden by maintenance mode' : row.description}
                    </p>
                  </div>
                  <Switch
                    checked={row.state}
                    disabled={maintenanceMode}
                    onChange={async (v) => {
                      row.setState(v)
                      await patchFlag({ [row.key]: v } as Partial<AppConfig>)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Maintenance mode confirm modal */}
      {showMaintenanceConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--d-text)', margin: '0 0 10px', fontFamily: 'var(--font-display)' }}>
              {pendingMaintenanceValue ? 'Enable maintenance mode?' : 'Disable maintenance mode?'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--d-text-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
              {pendingMaintenanceValue
                ? 'Confirmation emails, the AI bot, AI analysis, CSAT surveys and GitHub issue creation will pause until you turn this off.'
                : 'Automated actions will resume according to their individual feature flags.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowMaintenanceConfirm(false)}
                style={{ height: 34, padding: '0 16px', background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--d-text-2)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button type="button" onClick={() => { void confirmMasterToggle() }}
                style={{ height: 34, padding: '0 16px', background: pendingMaintenanceValue ? 'var(--d-danger)' : 'var(--d-accent)', color: '#fff', border: 'none', borderRadius: 'var(--r-sm)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {pendingMaintenanceValue ? 'Enable' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
