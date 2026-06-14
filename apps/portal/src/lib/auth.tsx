'use client'
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  isGuest: boolean
  isVerified: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  isLoading: boolean
  signIn: (token: string, user: AuthUser) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  signIn: () => {},
  signOut: () => {},
})

const TOKEN_KEY = 'tmr_portal_token'
const USER_KEY = 'tmr_portal_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY)
    const storedUser = localStorage.getItem(USER_KEY)
    if (storedToken && storedUser) {
      try { setToken(storedToken); setUser(JSON.parse(storedUser) as AuthUser) } catch { /* stale/corrupt entry — ignore, user stays signed out */ }
    }
    setIsLoading(false)
  }, [])

  const signIn = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  const signOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
