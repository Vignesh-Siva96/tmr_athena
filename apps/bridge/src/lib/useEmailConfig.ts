'use client'
import { useState, useEffect } from 'react'

interface EmailConfig {
  oauthConnected?: boolean
  oauthEmail?: string | null
  oauthProvider?: 'GOOGLE' | 'MICROSOFT' | null
}

let cachedPromise: Promise<EmailConfig> | null = null

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

export function invalidateEmailConfigCache() {
  cachedPromise = null
}

export function useEmailConfig(token: string | null) {
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const load = (fresh = false) => {
    if (!token) { setIsLoading(false); return }
    if (fresh) cachedPromise = null
    setIsLoading(true)
    fetchConfig(token).then((cfg) => {
      setIsConnected(!!(cfg.oauthConnected))
      setIsLoading(false)
    })
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => load(true)

  return { isConnected, isLoading, refresh }
}
