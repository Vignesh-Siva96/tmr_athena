'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type AuthLayout = 'MINIMAL' | 'BRANDED'

export interface AppConfig {
  id: string
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

const defaultConfig: AppConfig = {
  id: '',
  appName: 'Support',
  logoUrl: null,
  portalTagline: null,
  primaryColor: '#2563EB',
  accentColor: '#0EA5E9',
  emailDisplayName: 'Support',
  portalAuthLayout: 'MINIMAL',
  portalHeroHeadline: null,
  portalHeroSubheadline: null,
  portalFeatures: [],
}

const ConfigContext = createContext<AppConfig>(defaultConfig)

/** Convert #RRGGBB to {r, g, b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

/** Darken or lighten a hex color by `amount` (negative = darker) */
function shadeHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)))
  const r = clamp(rgb.r + amount).toString(16).padStart(2, '0')
  const g = clamp(rgb.g + amount).toString(16).padStart(2, '0')
  const b = clamp(rgb.b + amount).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

/** Apply brand colors as CSS custom properties on <html> */
function applyBrandVars(primary: string, accent: string) {
  const root = document.documentElement
  const rgb = hexToRgb(primary)
  root.style.setProperty('--p-accent', primary)
  root.style.setProperty('--p-accent-hv', shadeHex(primary, -20))
  root.style.setProperty('--p-accent-bg', rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)` : '#EFF4FE')

  const rgb2 = hexToRgb(accent)
  root.style.setProperty('--p-accent-2', accent)
  root.style.setProperty('--p-accent-2-bg', rgb2 ? `rgba(${rgb2.r},${rgb2.g},${rgb2.b},0.08)` : '#E0F2FE')
}

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig)

  useEffect(() => {
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
    fetch(`${apiUrl}/api/v1/config`)
      .then((r) => r.json())
      .then((json: { data: AppConfig }) => {
        if (!json.data) return
        setConfig(json.data)
        applyBrandVars(json.data.primaryColor, json.data.accentColor)
      })
      .catch(() => {})
  }, [])

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
}

export function useAppConfig() {
  return useContext(ConfigContext)
}
