'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LifeBuoy } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
type FormData = z.infer<typeof schema>

interface AgentUser { id: string; email: string; name: string; avatarUrl: string | null; role: 'ADMIN' | 'AGENT' }
interface AuthResponse { agent: AgentUser; token: string }

export default function DashAuthPage() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setError(null); setIsLoading(true)
    try {
      const res = await api.post<AuthResponse>('/auth/agent/signin', data)
      signIn(res.token, res.agent)
      router.push('/inbox')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 380, padding: '40px 36px', background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <LifeBuoy size={20} style={{ color: 'var(--d-accent)' }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--d-text)' }}>TMR Support</span>
          <span style={{ fontSize: 12, color: 'var(--d-text-4)', marginLeft: 4 }}>Agent Dashboard</span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>Sign in to your account</h1>
        <p style={{ fontSize: 13, color: 'var(--d-text-3)', marginBottom: 28 }}>Agent access only.</p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Email</label>
            <input
              {...register('email')}
              type="email"
              style={{ width: '100%', height: 38, padding: '0 12px', background: 'var(--d-raised)', border: `1px solid ${errors.email ? 'var(--d-danger)' : 'var(--d-border)'}`, borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
            />
            {errors.email && <p style={{ fontSize: 12, color: 'var(--d-danger)', marginTop: 4 }}>{errors.email.message}</p>}
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', marginBottom: 6 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                {...register('password')}
                type={showPw ? 'text' : 'password'}
                style={{ width: '100%', height: 38, padding: '0 38px 0 12px', background: 'var(--d-raised)', border: `1px solid ${errors.password ? 'var(--d-danger)' : 'var(--d-border)'}`, borderRadius: 'var(--r-sm)', fontSize: 14, color: 'var(--d-text)', outline: 'none', fontFamily: 'inherit' }}
              />
              <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer' }}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p style={{ fontSize: 12, color: 'var(--d-danger)', marginTop: 4 }}>{errors.password.message}</p>}
          </div>

          {error && <p style={{ fontSize: 13, color: 'var(--d-danger)', marginBottom: 16, padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--r-sm)' }}>{error}</p>}

          <button
            type="submit"
            disabled={isLoading}
            style={{ width: '100%', height: 38, background: isLoading ? 'rgba(59,130,246,0.5)' : 'var(--d-accent)', color: '#fff', borderRadius: 'var(--r-sm)', fontWeight: 600, fontSize: 14, cursor: isLoading ? 'not-allowed' : 'pointer', border: 'none', fontFamily: 'inherit' }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
