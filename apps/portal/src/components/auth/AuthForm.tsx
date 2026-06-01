'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { redirectToGoogle } from '@/lib/googleOAuth'

const signinSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
type SigninData = z.infer<typeof signinSchema>

const signupSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
  name: z.string().optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type SignupData = z.infer<typeof signupSchema>

interface AuthResponse {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; isGuest: boolean }
  token: string
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

interface Props {
  /** Error message to show (e.g. from OAuth redirect, query param) */
  initialError?: string | null
}

export default function AuthForm({ initialError }: Props) {
  const router = useRouter()
  const { signIn } = useAuth()
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [isLoading, setIsLoading] = useState(false)

  const signinForm = useForm<SigninData>({ resolver: zodResolver(signinSchema) })
  const signupForm = useForm<SignupData>({ resolver: zodResolver(signupSchema) })

  const handleSignin = async (data: SigninData) => {
    setError(null)
    setIsLoading(true)
    try {
      const res = await api.post<AuthResponse>('/auth/signin', data)
      signIn(res.token, res.user)
      router.push('/tickets')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignup = async (data: SignupData) => {
    setError(null)
    setIsLoading(true)
    try {
      const res = await api.post<AuthResponse>('/auth/signup', {
        email: data.email,
        password: data.password,
        name: data.name,
      })
      signIn(res.token, res.user)
      router.push('/tickets')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account creation failed')
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

  const googleButtonStyle: React.CSSProperties = {
    width: '100%',
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    border: '1px solid var(--p-border)',
    borderRadius: 'var(--r-sm)',
    background: '#fff',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--p-text)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginBottom: 20,
  }

  return (
    <div>
      {/* Tab switcher */}
      <div
        style={{
          display: 'inline-flex',
          background: 'var(--p-surface)',
          borderRadius: 'var(--r-md)',
          padding: 4,
          marginBottom: 32,
          alignSelf: 'flex-start',
        }}
      >
        {(['signin', 'signup'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setError(null) }}
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--r-sm)',
              fontSize: 13,
              fontWeight: 500,
              color: tab === t ? 'var(--p-text)' : 'var(--p-text-3)',
              background: tab === t ? '#fff' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 120ms',
              fontFamily: 'inherit',
            }}
          >
            {t === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      {tab === 'signin' ? (
        <form onSubmit={signinForm.handleSubmit(handleSignin)} noValidate>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--p-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 28 }}>
            Sign in to view and reply to your tickets.
          </p>

          <button type="button" onClick={redirectToGoogle} style={googleButtonStyle}>
            <GoogleIcon />
            Continue with Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--p-border)' }} />
            <span style={{ fontSize: 12, color: 'var(--p-text-4)', whiteSpace: 'nowrap' }}>or sign in with email</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--p-border)' }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>
              Email address
            </label>
            <input {...signinForm.register('email')} type="email" style={inputStyle(!!signinForm.formState.errors.email)} />
            {signinForm.formState.errors.email && (
              <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{signinForm.formState.errors.email.message}</p>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)' }}>Password</label>
              <button type="button" style={{ fontSize: 12, color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Forgot password?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                {...signinForm.register('password')}
                type={showPassword ? 'text' : 'password'}
                style={{ ...inputStyle(!!signinForm.formState.errors.password), paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--p-text-4)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {signinForm.formState.errors.password && (
              <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{signinForm.formState.errors.password.message}</p>
            )}
          </div>

          {error && (
            <p style={{ fontSize: 13, color: 'var(--p-danger)', marginBottom: 16, padding: '10px 12px', background: 'var(--p-danger-bg, #FCE9E9)', borderRadius: 'var(--r-sm)' }}>
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
              marginBottom: 16,
            }}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>

          <p style={{ fontSize: 13, color: 'var(--p-text-3)', textAlign: 'center', marginBottom: 24 }}>
            Don&apos;t have an account?{' '}
            <button type="button" onClick={() => setTab('signup')} style={{ color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              Sign up
            </button>
          </p>

          {/* Guest card */}
          <div
            style={{
              border: '1px solid var(--p-border)',
              borderRadius: 'var(--r-md)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--p-surface)',
            }}
          >
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)', margin: 0 }}>
                Just need to submit a ticket?
              </p>
              <p style={{ fontSize: 12, color: 'var(--p-text-3)', margin: '2px 0 0' }}>No account required</p>
            </div>
            <a
              href="/submit"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--p-accent)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Continue as guest →
            </a>
          </div>
        </form>
      ) : (
        <form onSubmit={signupForm.handleSubmit(handleSignup)} noValidate>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--p-text)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
            Create your account
          </h2>
          <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 28 }}>
            Start tracking your support tickets in one place.
          </p>

          <button type="button" onClick={redirectToGoogle} style={googleButtonStyle}>
            <GoogleIcon />
            Continue with Google
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--p-border)' }} />
            <span style={{ fontSize: 12, color: 'var(--p-text-4)', whiteSpace: 'nowrap' }}>or create with email</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--p-border)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>Email address</label>
              <input {...signupForm.register('email')} type="email" style={inputStyle(!!signupForm.formState.errors.email)} />
              {signupForm.formState.errors.email && <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{signupForm.formState.errors.email.message}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>Password</label>
              <input {...signupForm.register('password')} type="password" style={inputStyle(!!signupForm.formState.errors.password)} />
              {signupForm.formState.errors.password && <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{signupForm.formState.errors.password.message}</p>}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 6 }}>Confirm password</label>
              <input {...signupForm.register('confirmPassword')} type="password" style={inputStyle(!!signupForm.formState.errors.confirmPassword)} />
              {signupForm.formState.errors.confirmPassword && <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{signupForm.formState.errors.confirmPassword.message}</p>}
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: 'var(--p-danger)', marginBottom: 16, padding: '10px 12px', background: 'var(--p-danger-bg, #FCE9E9)', borderRadius: 'var(--r-sm)' }}>
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
              marginBottom: 16,
            }}
          >
            {isLoading ? 'Creating account…' : 'Create account'}
          </button>

          <p style={{ fontSize: 11, color: 'var(--p-text-4)', textAlign: 'center', marginBottom: 16 }}>
            By creating an account, you agree to our Terms of Service.
          </p>

          <p style={{ fontSize: 13, color: 'var(--p-text-3)', textAlign: 'center' }}>
            Already have an account?{' '}
            <button type="button" onClick={() => setTab('signin')} style={{ color: 'var(--p-accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              Sign in
            </button>
          </p>
        </form>
      )}
    </div>
  )
}
