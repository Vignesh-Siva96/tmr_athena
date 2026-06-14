'use client'
import { LifeBuoy } from 'lucide-react'
import { useAppConfig } from '@/lib/brand'

interface Props {
  children: React.ReactNode
}

/** Centered card shell shared by /auth and the standalone verify-email / forgot-password / reset-password pages. */
export default function AuthCard({ children }: Props) {
  const config = useAppConfig()
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
        {children}
      </div>
    </div>
  )
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}
