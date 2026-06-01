'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { LifeBuoy, Check } from 'lucide-react'
import { useAppConfig } from '@/lib/brand'
import AuthForm from '@/components/auth/AuthForm'

const ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Please try again.',
  invalid_state: 'Sign-in request was invalid. Please try again.',
}

function AuthPageInner() {
  const config = useAppConfig()
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const initialError = errorKey ? (ERROR_MESSAGES[errorKey] ?? 'Sign-in failed.') : null

  const layout = config.portalAuthLayout ?? 'MINIMAL'
  const headline = config.portalHeroHeadline
  const subheadline = config.portalHeroSubheadline
  const features = config.portalFeatures ?? []

  if (layout === 'BRANDED' && headline) {
    return <BrandedLayout config={config} headline={headline} subheadline={subheadline} features={features} initialError={initialError} />
  }

  return <MinimalLayout config={config} initialError={initialError} />
}

// ─── MINIMAL layout ───────────────────────────────────────────────────────────

interface LayoutProps {
  config: ReturnType<typeof useAppConfig>
  initialError: string | null
}

function MinimalLayout({ config, initialError }: LayoutProps) {
  const rgb = hexToRgb(config.primaryColor)
  const gradientBg = rgb
    ? `radial-gradient(ellipse at 60% 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0.05) 0%, #FAFBFC 60%)`
    : '#FAFBFC'

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: gradientBg,
        padding: '40px 24px',
      }}
    >
      {/* Logo + app name */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        {config.logoUrl ? (
          <img
            src={config.logoUrl}
            alt={config.appName}
            style={{ height: 56, maxWidth: 200, objectFit: 'contain', display: 'block', margin: '0 auto 12px' }}
          />
        ) : (
          <LifeBuoy size={40} style={{ color: config.primaryColor, margin: '0 auto 12px', display: 'block' }} />
        )}
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--p-text)', margin: 0 }}>
          {config.appName}
        </p>
      </div>

      {/* Form card */}
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          border: '1px solid var(--p-border)',
          borderRadius: 'var(--r-lg)',
          padding: '32px 32px 28px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}
      >
        <AuthForm initialError={initialError} />
      </div>
    </div>
  )
}

// ─── BRANDED layout ───────────────────────────────────────────────────────────

interface BrandedLayoutProps {
  config: ReturnType<typeof useAppConfig>
  headline: string
  subheadline: string | null
  features: string[]
  initialError: string | null
}

function BrandedLayout({ config, headline, subheadline, features, initialError }: BrandedLayoutProps) {
  const nonEmptyFeatures = features.filter(f => f.trim())

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* Left dark panel */}
      <div
        style={{
          width: '55%',
          background: '#0D1117',
          display: 'flex',
          flexDirection: 'column',
          padding: '40px 48px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            pointerEvents: 'none',
          }}
        />

        {/* Logo + app name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1 }}>
          {config.logoUrl ? (
            <img src={config.logoUrl} alt={config.appName} style={{ height: 24, maxWidth: 120, objectFit: 'contain' }} />
          ) : (
            <LifeBuoy size={24} style={{ color: '#fff' }} />
          )}
          <span style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em' }}>
            {config.appName}
          </span>
        </div>

        {/* Hero content */}
        <div style={{ marginTop: 'auto', marginBottom: 'auto', position: 'relative', zIndex: 1 }}>
          <h1
            style={{
              fontSize: 40,
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.1,
              letterSpacing: '-0.03em',
              marginBottom: subheadline ? 16 : 32,
              fontFamily: 'var(--font-display)',
            }}
          >
            {headline}
          </h1>
          {subheadline && (
            <p style={{ fontSize: 15, color: '#A1A1AA', lineHeight: 1.6, marginBottom: 32, maxWidth: 360 }}>
              {subheadline}
            </p>
          )}
          {nonEmptyFeatures.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {nonEmptyFeatures.map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'rgba(37,99,235,0.25)',
                      border: '1px solid rgba(37,99,235,0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Check size={11} style={{ color: '#60A5FA' }} strokeWidth={2.5} />
                  </div>
                  <span style={{ fontSize: 14, color: '#fff' }}>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right form panel */}
      <div
        style={{
          width: '45%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '48px',
          background: '#fff',
        }}
      >
        <AuthForm initialError={initialError} />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

// ─── Page export (Suspense boundary for useSearchParams) ──────────────────────

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#FAFBFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--p-text-3)' }}>Loading…</p>
      </div>
    }>
      <AuthPageInner />
    </Suspense>
  )
}
