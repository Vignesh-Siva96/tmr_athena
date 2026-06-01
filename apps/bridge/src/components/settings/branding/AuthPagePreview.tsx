'use client'
import { ExternalLink } from 'lucide-react'

type AuthLayout = 'MINIMAL' | 'BRANDED'

interface Props {
  layout: AuthLayout
  headline: string
  subheadline: string
  features: string[]
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  appName: string
}

function getContrastColor(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#fff'
  const r = parseInt(m[1], 16)
  const g = parseInt(m[2], 16)
  const b = parseInt(m[3], 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#111' : '#fff'
}

export default function AuthPagePreview({ layout, headline, subheadline, features, primaryColor, accentColor, logoUrl, appName }: Props) {
  const nonEmptyFeatures = features.filter(f => f.trim())
  const portalUrl = process.env['NEXT_PUBLIC_PORTAL_URL'] ?? 'http://localhost:3000'

  return (
    <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--d-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--d-text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Auth Page Preview</p>
        <a
          href={`${portalUrl}/auth`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 10, color: 'var(--d-accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}
        >
          Open full preview <ExternalLink size={9} />
        </a>
      </div>

      {/* Fake browser chrome */}
      <div style={{ background: '#111', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {['#EF4444', '#F59E0B', '#22C55E'].map((c) => <span key={c} style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />)}
          </div>
          <div style={{ flex: 1, height: 15, background: 'rgba(255,255,255,0.06)', borderRadius: 3, display: 'flex', alignItems: 'center', paddingLeft: 7 }}>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>…/auth</span>
          </div>
        </div>
      </div>

      {/* Preview body */}
      {layout === 'MINIMAL' ? (
        <MinimalPreview primaryColor={primaryColor} accentColor={accentColor} logoUrl={logoUrl} appName={appName} />
      ) : (
        <BrandedPreview
          primaryColor={primaryColor}
          accentColor={accentColor}
          logoUrl={logoUrl}
          appName={appName}
          headline={headline}
          subheadline={subheadline}
          features={nonEmptyFeatures}
        />
      )}
    </div>
  )
}

// ─── MINIMAL mini-preview ─────────────────────────────────────────────────────

interface MinimalPreviewProps {
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  appName: string
}

function MinimalPreview({ primaryColor, accentColor, logoUrl, appName }: MinimalPreviewProps) {
  const rgb = hexToRgb(primaryColor)
  const gradBg = rgb
    ? `radial-gradient(ellipse at 60% 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0.05) 0%, #FAFAFA 60%)`
    : '#FAFAFA'

  return (
    <div style={{ background: gradBg, padding: '18px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Logo + name */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        {logoUrl
          ? <img src={logoUrl} alt="" style={{ height: 22, maxWidth: 80, objectFit: 'contain', display: 'block', margin: '0 auto 5px' }} />
          : <div style={{ width: 22, height: 22, borderRadius: 5, background: primaryColor, margin: '0 auto 5px' }} />
        }
        <span style={{ fontSize: 9, fontWeight: 600, color: '#09090B' }}>{appName}</span>
      </div>
      {/* Form stub */}
      <div style={{ width: '100%', maxWidth: 160, background: '#fff', border: '1px solid #E4E4E7', borderRadius: 6, padding: '10px 10px 8px' }}>
        <StubTabs primaryColor={primaryColor} />
        <StubGoogleButton />
        <StubDivider />
        <StubInputs />
        <StubButton primaryColor={primaryColor} label="Sign in" />
        <StubGuestLink accentColor={accentColor} />
      </div>
    </div>
  )
}

// ─── BRANDED mini-preview ─────────────────────────────────────────────────────

interface BrandedPreviewProps {
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  appName: string
  headline: string
  subheadline: string
  features: string[]
}

function BrandedPreview({ primaryColor, accentColor, logoUrl, appName, headline, subheadline, features }: BrandedPreviewProps) {
  return (
    <div style={{ display: 'flex', minHeight: 160 }}>
      {/* Left hero */}
      <div style={{ flex: '0 0 48%', background: '#0D1117', padding: '12px 10px', display: 'flex', flexDirection: 'column' }}>
        {/* Logo + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ height: 14, maxWidth: 50, objectFit: 'contain' }} />
            : <div style={{ width: 14, height: 14, borderRadius: 3, background: '#fff' }} />
          }
          <span style={{ fontSize: 8, fontWeight: 600, color: '#fff' }}>{appName}</span>
        </div>
        {/* Headline */}
        {headline ? (
          <p style={{ fontSize: 9, fontWeight: 700, color: '#fff', lineHeight: 1.3, marginBottom: subheadline ? 4 : 6 }}>
            {headline.length > 40 ? headline.slice(0, 40) + '…' : headline}
          </p>
        ) : (
          <p style={{ fontSize: 8, color: '#555', fontStyle: 'italic', marginBottom: 4 }}>Headline…</p>
        )}
        {subheadline && (
          <p style={{ fontSize: 7, color: '#A1A1AA', lineHeight: 1.4, marginBottom: 6 }}>
            {subheadline.length > 60 ? subheadline.slice(0, 60) + '…' : subheadline}
          </p>
        )}
        {features.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {features.slice(0, 3).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(37,99,235,0.3)', border: '1px solid rgba(37,99,235,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 5, color: '#60A5FA' }}>✓</span>
                </div>
                <span style={{ fontSize: 7, color: '#fff' }}>{f.length > 22 ? f.slice(0, 22) + '…' : f}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Right form */}
      <div style={{ flex: '0 0 52%', background: '#fff', padding: '12px 10px' }}>
        <StubTabs primaryColor={primaryColor} />
        <StubGoogleButton />
        <StubDivider />
        <StubInputs />
        <StubButton primaryColor={primaryColor} label="Sign in" />
        <StubGuestLink accentColor={accentColor} />
      </div>
    </div>
  )
}

// ─── Shared stub sub-components ───────────────────────────────────────────────

function StubTabs({ primaryColor }: { primaryColor: string }) {
  return (
    <div style={{ display: 'flex', gap: 3, marginBottom: 8, background: '#F4F4F5', borderRadius: 5, padding: 2 }}>
      <div style={{ flex: 1, height: 14, background: '#fff', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 6, fontWeight: 700, color: primaryColor }}>Sign in</span>
      </div>
      <div style={{ flex: 1, height: 14, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 6, color: '#71717A' }}>Create</span>
      </div>
    </div>
  )
}

function StubGoogleButton() {
  return (
    <div style={{ height: 14, border: '1px solid #E4E4E7', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 1 }}>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#4285F4' }} />
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#34A853' }} />
      </div>
      <span style={{ fontSize: 6, color: '#09090B' }}>Continue with Google</span>
    </div>
  )
}

function StubDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
      <div style={{ flex: 1, height: 1, background: '#E4E4E7' }} />
      <span style={{ fontSize: 5, color: '#A1A1AA' }}>or</span>
      <div style={{ flex: 1, height: 1, background: '#E4E4E7' }} />
    </div>
  )
}

function StubInputs() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
      <div style={{ height: 12, background: '#F4F4F5', borderRadius: 3, border: '1px solid #E4E4E7' }} />
      <div style={{ height: 12, background: '#F4F4F5', borderRadius: 3, border: '1px solid #E4E4E7' }} />
    </div>
  )
}

function StubButton({ primaryColor, label }: { primaryColor: string; label: string }) {
  return (
    <div style={{ height: 14, background: primaryColor, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 6, fontWeight: 700, color: getContrastColor(primaryColor) }}>{label}</span>
    </div>
  )
}

function StubGuestLink({ accentColor }: { accentColor: string }) {
  return (
    <div style={{ paddingTop: 4, borderTop: '1px solid #F4F4F5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 5, color: '#71717A' }}>Just need a ticket?</span>
      <span style={{ fontSize: 5, color: accentColor }}>Guest →</span>
    </div>
  )
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}
