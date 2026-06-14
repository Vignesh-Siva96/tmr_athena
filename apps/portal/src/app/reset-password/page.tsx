'use client'
import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import AuthCard from '@/components/auth/AuthCard'
import { api } from '@/lib/api'

const resetPasswordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type ResetPasswordData = z.infer<typeof resetPasswordSchema>

function ResetPasswordInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [done, setDone] = useState(false)
  const form = useForm<ResetPasswordData>({ resolver: zodResolver(resetPasswordSchema), mode: 'onChange' })
  const password = form.watch('password') ?? ''

  const onSubmit = async (data: ResetPasswordData) => {
    if (!token) return
    setError(null)
    setIsLoading(true)
    try {
      await api.post('/auth/reset-password', { token, password: data.password })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password')
    } finally {
      setIsLoading(false)
    }
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: '100%',
    height: 40,
    padding: '0 14px',
    border: `1px solid ${hasError ? 'var(--p-danger)' : 'var(--p-border)'}`,
    borderRadius: 'var(--r-sm)',
    fontFamily: 'inherit',
    fontSize: 14,
    color: 'var(--p-text)',
    background: '#fff',
    outline: 'none',
  })

  if (!token) {
    return (
      <div style={{ textAlign: 'center' }}>
        <XCircle size={40} style={{ color: 'var(--p-danger)', margin: '0 auto 16px', display: 'block' }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
          Invalid link
        </h2>
        <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>
          This password reset link is missing its token. Please request a new one.
        </p>
        <Link href="/forgot-password" style={{ fontSize: 13, color: 'var(--p-accent)', textDecoration: 'none' }}>
          Request a new link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <CheckCircle2 size={40} style={{ color: 'var(--p-success)', margin: '0 auto 16px', display: 'block' }} />
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
          Password updated
        </h2>
        <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>
          You can now sign in with your new password.
        </p>
        <button
          type="button"
          onClick={() => router.push('/auth')}
          style={{
            display: 'inline-flex',
            height: 40,
            alignItems: 'center',
            padding: '0 20px',
            background: 'var(--p-accent)',
            color: '#fff',
            borderRadius: 'var(--r-sm)',
            fontWeight: 600,
            fontSize: 14,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--p-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
        Choose a new password
      </h2>
      <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 28 }}>
        Enter a new password for your account.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>New password</label>
        <input {...form.register('password')} type="password" style={inputStyle(!!form.formState.errors.password)} />
        {password && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            {[
              { ok: password.length >= 8, label: 'At least 8 characters' },
              { ok: /[0-9]/.test(password), label: 'Contains a number' },
              { ok: /[^A-Za-z0-9]/.test(password), label: 'Contains a special character' },
            ].map(({ ok, label }) => (
              <p key={label} style={{ fontSize: 11, margin: 0, color: ok ? 'var(--p-success, #047857)' : 'var(--p-text-4)' }}>
                {ok ? '✓' : '○'} {label}
              </p>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>Confirm password</label>
        <input {...form.register('confirmPassword')} type="password" style={inputStyle(!!form.formState.errors.confirmPassword)} />
        {form.formState.errors.confirmPassword && (
          <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{form.formState.errors.confirmPassword.message}</p>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 13, color: 'var(--p-danger)', marginBottom: 16, padding: '10px 12px', background: 'var(--p-danger-bg)', borderRadius: 'var(--r-sm)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isLoading}
        style={{
          width: '100%',
          height: 40,
          background: isLoading ? 'rgba(37,99,235,0.7)' : 'var(--p-accent)',
          color: '#fff',
          borderRadius: 'var(--r-sm)',
          fontWeight: 600,
          fontSize: 14,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          border: 'none',
          fontFamily: 'inherit',
        }}
      >
        {isLoading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <AuthCard>
      <Suspense fallback={<p style={{ fontSize: 14, color: 'var(--p-text-3)', textAlign: 'center' }}>Loading…</p>}>
        <ResetPasswordInner />
      </Suspense>
    </AuthCard>
  )
}
