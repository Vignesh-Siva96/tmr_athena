'use client'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LifeBuoy } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

const schema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type FormData = z.infer<typeof schema>

interface AgentUser { id: string; email: string; name: string; avatarUrl: string | null; role: 'ADMIN' | 'PRIMARY_AGENT' | 'SECONDARY_AGENT' }
interface AcceptResponse { agent: AgentUser; token: string }

export default function AcceptInvitePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signIn } = useAuth()

  const token = searchParams.get('token')

  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, watch, formState: { errors, isValid } } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
  })

  const password = watch('password') ?? ''

  const onSubmit = async (data: FormData) => {
    if (!token) return
    setError(null)
    setIsLoading(true)
    try {
      const res = await api.post<AcceptResponse>('/auth/agent/accept-invite', {
        token,
        password: data.password,
      })
      signIn(res.token, res.agent)
      router.push('/inbox')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password. The link may have expired.')
    } finally {
      setIsLoading(false)
    }
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: '100%',
    height: 40,
    padding: '0 14px',
    border: `1px solid ${hasError ? 'var(--d-danger)' : 'var(--d-border)'}`,
    borderRadius: 'var(--r-sm)',
    fontFamily: 'inherit',
    fontSize: 14,
    color: 'var(--d-text)',
    background: 'var(--d-surface)',
    outline: 'none',
    boxSizing: 'border-box' as const,
  })

  if (!token) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--d-bg)', padding: 24,
      }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--d-danger-bg, rgba(239,68,68,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <span style={{ fontSize: 22 }}>⚠</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>Invalid invite link</h1>
          <p style={{ fontSize: 14, color: 'var(--d-text-3)', marginBottom: 24 }}>
            This invite link is missing or malformed. Please ask your admin to re-send the invite.
          </p>
          <a href="/auth" style={{ fontSize: 14, color: 'var(--d-accent)', textDecoration: 'none' }}>← Back to sign in</a>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--d-bg)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--d-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LifeBuoy size={20} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 18, color: 'var(--d-text)', fontFamily: 'var(--font-display)' }}>Support Dashboard</span>
        </div>

        <div style={{ background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-xl, 16px)', padding: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--d-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
            Set your password
          </h1>
          <p style={{ fontSize: 14, color: 'var(--d-text-3)', marginBottom: 28 }}>
            Create a password to activate your account and sign in to the dashboard.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--d-text)', marginBottom: 6 }}>New password</label>
              <div style={{ position: 'relative' }}>
                <input
                  {...register('password')}
                  type={showPw ? 'text' : 'password'}
                  style={{ ...inputStyle(!!errors.password), paddingRight: 40 }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                  {[
                    { ok: password.length >= 8, label: 'At least 8 characters' },
                    { ok: /[0-9]/.test(password), label: 'Contains a number' },
                    { ok: /[^A-Za-z0-9]/.test(password), label: 'Contains a special character' },
                  ].map(({ ok, label }) => (
                    <p key={label} style={{ fontSize: 11, margin: 0, color: ok ? 'var(--d-success, #16a34a)' : 'var(--d-text-4)' }}>
                      {ok ? '✓' : '○'} {label}
                    </p>
                  ))}
                </div>
              )}
              {errors.password && <p style={{ fontSize: 12, color: 'var(--d-danger)', marginTop: 4 }}>{errors.password.message}</p>}
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--d-text)', marginBottom: 6 }}>Confirm password</label>
              <div style={{ position: 'relative' }}>
                <input
                  {...register('confirmPassword')}
                  type={showConfirm ? 'text' : 'password'}
                  style={{ ...inputStyle(!!errors.confirmPassword), paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--d-text-4)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && <p style={{ fontSize: 12, color: 'var(--d-danger)', marginTop: 4 }}>{errors.confirmPassword.message}</p>}
            </div>

            {error && (
              <div style={{ padding: '10px 12px', background: 'var(--d-danger-bg, rgba(239,68,68,0.1))', border: '1px solid var(--d-danger)', borderRadius: 'var(--r-sm)', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: 'var(--d-danger)', margin: 0 }}>{error}</p>
                <p style={{ fontSize: 12, color: 'var(--d-text-3)', margin: '4px 0 0' }}>
                  If this keeps happening, ask your admin to re-send the invite. <a href="/auth" style={{ color: 'var(--d-accent)', textDecoration: 'none' }}>Sign in instead →</a>
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !isValid}
              style={{
                width: '100%',
                height: 40,
                background: (isLoading || !isValid) ? 'rgba(var(--d-accent-rgb, 37,99,235),0.5)' : 'var(--d-accent)',
                color: '#fff',
                borderRadius: 'var(--r-sm)',
                fontWeight: 600,
                fontSize: 14,
                cursor: (isLoading || !isValid) ? 'not-allowed' : 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                opacity: (isLoading || !isValid) ? 0.7 : 1,
              }}
            >
              {isLoading ? 'Activating account…' : 'Activate account'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--d-text-4)' }}>
          Already have a password? <a href="/auth" style={{ color: 'var(--d-accent)', textDecoration: 'none' }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
