'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AgentUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  role: 'ADMIN' | 'AGENT'
}

interface AuthContextValue {
  agent: AgentUser | null
  token: string | null
  isLoading: boolean
  signIn: (token: string, agent: AgentUser) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  agent: null, token: null, isLoading: true,
  signIn: () => {}, signOut: () => {},
})

const TOKEN_KEY = 'tmr_dash_token'
const AGENT_KEY = 'tmr_dash_agent'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY)
    const a = localStorage.getItem(AGENT_KEY)
    if (t && a) {
      try { setToken(t); setAgent(JSON.parse(a) as AgentUser) } catch { /* stale/corrupt entry — ignore, user stays signed out */ }
    }
    setIsLoading(false)
  }, [])

  const signIn = (t: string, a: AgentUser) => {
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(AGENT_KEY, JSON.stringify(a))
    setToken(t); setAgent(a)
  }

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(AGENT_KEY)
    setToken(null); setAgent(null)
  }

  return <AuthContext.Provider value={{ agent, token, isLoading, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() { return useContext(AuthContext) }
