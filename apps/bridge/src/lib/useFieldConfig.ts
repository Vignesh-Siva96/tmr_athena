'use client'
import { useEffect, useState } from 'react'
import { api } from './api'

/** One option in a configurable ticket dropdown (field1/field2). `value` is the
 * stable key stored on tickets and grouped by analytics; `label` is display-only. */
export interface DropdownOption {
  value: string
  label: string
  icon?: string
}

export interface FieldConfig {
  field1Label: string | null
  field1Options: DropdownOption[]
  field2Label: string | null
  field2Options: DropdownOption[]
}

/** Resolve a stored field value to its display label. Falls back to the raw value
 * when no matching option is configured (legacy data, or an option since deleted). */
export function labelForValue(value: string, options: DropdownOption[]): string {
  return options.find((o) => o.value === value)?.label ?? value
}

/** Fetches the configurable dropdown labels + options from AppConfig.
 * Returns null until loaded. Shared by the ticket sidebar and analytics dashboards
 * so a label rename in settings is reflected everywhere without touching ticket data. */
export function useFieldConfig(token: string | null): FieldConfig | null {
  const [config, setConfig] = useState<FieldConfig | null>(null)

  useEffect(() => {
    if (!token) return
    api.get<Partial<FieldConfig>>('/config', token)
      .then((cfg) => setConfig({
        field1Label: cfg.field1Label ?? null,
        field1Options: cfg.field1Options ?? [],
        field2Label: cfg.field2Label ?? null,
        field2Options: cfg.field2Options ?? [],
      }))
      .catch(() => {})
  }, [token])

  return config
}
