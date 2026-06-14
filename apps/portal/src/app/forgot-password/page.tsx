'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Mail } from 'lucide-react'
import AuthCard from '@/components/auth/AuthCard'
import { api } from '@/lib/api'

const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
})
type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const form = useForm<ForgotPasswordData>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = async (data: ForgotPasswordData) => {
    setIsLoading(true)
    try {
      await api.post('/auth/forgot-password', data)
    } finally {
      setIsLoading(false)
      // Always show the same confirmation, regardless of outcome — no account enumeration.
      setSent(true)
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

  if (sent) {
    return (
      <AuthCard>
        <div style={{ textAlign: 'center' }}>
          <Mail size={40} style={{ color: 'var(--p-accent)', margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8, fontFamily: 'var(--font-display)' }}>
            Check your email
          </h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 24 }}>
            If an account exists for that email, we&apos;ve sent a link to reset your password.
          </p>
          <Link href="/auth" style={{ fontSize: 13, color: 'var(--p-accent)', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--p-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
          Forgot your password?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 28 }}>
          Enter the email associated with your account and we&apos;ll send you a link to reset your password.
        </p>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>
            Email address
          </label>
          <input {...form.register('email')} type="email" style={inputStyle(!!form.formState.errors.email)} />
          {form.formState.errors.email && (
            <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{form.formState.errors.email.message}</p>
          )}
        </div>

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
            marginBottom: 16,
          }}
        >
          {isLoading ? 'Sending…' : 'Send reset link'}
        </button>

        <p style={{ fontSize: 13, color: 'var(--p-text-3)', textAlign: 'center' }}>
          <Link href="/auth" style={{ color: 'var(--p-accent)', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
