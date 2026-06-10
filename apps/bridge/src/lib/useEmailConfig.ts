'use client'
import { useState, useEffect, useCallback } from 'react'

interface EmailConfig {
  oauthConnected?: boolean
  oauthEmail?: string | null
  oauthProvider?: 'GOOGLE' | 'MICROSOFT' | null
}

let cachedPromise: Promise<EmailConfig> | null = null
const listeners = new Set<() => void>()

function fetchConfig(token: string): Promise<EmailConfig> {
  if (!cachedPromise) {
    cachedPromise = fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1/config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then((r) => r.json())
      .then((json) => (json.data ?? json) as EmailConfig)
      .catch(() => ({ oauthConnected: false }))
  }
  return cachedPromise
}

/** Clears the shared cache and notifies all active useEmailConfig instances to re-fetch. */
export function invalidateEmailConfigCache() {
  cachedPromise = null
  listeners.forEach((fn) => fn())
}

export function useEmailConfig(token: string | null) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const reload = useCallback(() => {
    if (!token) { setIsLoading(false); return }
    setIsLoading(true)
    fetchConfig(token).then((cfg) => {
      setIsConnected(!!(cfg.oauthConnected))
      setIsLoading(false)
    })
  }, [token])

  useEffect(() => {
    reload()
    listeners.add(reload)
    return () => { listeners.delete(reload) }
  }, [reload])

  const refresh = () => { invalidateEmailConfigCache() }

  return { isConnected, isLoading, refresh }
}
