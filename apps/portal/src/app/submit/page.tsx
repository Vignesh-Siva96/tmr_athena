'use client'
import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Bold, Italic, Code, Link as LinkIcon, List, ChevronDown, Check, Copy } from 'lucide-react'
import { PortalNav } from '@/components/portal/PortalNav'
import { CategorySelector, type TicketCategory } from '@/components/portal/CategorySelector'
import { FileDropzone } from '@/components/portal/FileDropzone'
import { ConnectorSelect } from '@/components/portal/ConnectorSelect'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

const DESTINATIONS = ['Hub', 'Google Sheets', 'Google Data Studio']

const schema = z.object({
  category: z.enum(['BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'BILLING', 'OTHER'], {
    required_error: 'Please select a category',
  }),
  title: z.string().min(1, 'Title is required').max(120, 'Max 120 characters'),
  product: z.string().optional(),
  connector: z.string().optional(),
  description: z.string().optional(),
  guestEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
})

type FormData = z.infer<typeof schema>

interface SubmittedTicket {
  ticket: { id: string }
  displayId: string
}

export default function SubmitPage() {
  const { user, token } = useAuth()
  const [files, setFiles] = useState<{ name: string; size: number; file?: File }[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [submitted, setSubmitted] = useState<SubmittedTicket | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { category: undefined, title: '', description: '' },
  })

  const titleValue = watch('title') ?? ''

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)
    try {
      // If not logged in, get a guest token first
      let authToken = token
      if (!authToken) {
        const email = data.guestEmail
        if (!email) { setIsSubmitting(false); return }
        const guestRes = await api.post<{ guestToken: string }>('/auth/guest', { email })
        authToken = guestRes.guestToken
      }

      // Upload files and collect attachment IDs before creating the ticket
      const attachmentIds: string[] = []
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
      for (const f of files) {
        if (!f.file) continue
        const formData = new FormData()
        formData.append('file', f.file)
        const res = await fetch(`${apiUrl}/api/v1/files/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        })
        if (res.ok) {
          const json = await res.json() as { data: { attachment: { id: string } } }
          attachmentIds.push(json.data.attachment.id)
        }
      }
      if (linkUrl) {
        const res = await fetch(`${apiUrl}/api/v1/files/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ linkUrl }),
        })
        if (res.ok) {
          const json = await res.json() as { data: { attachment: { id: string } } }
          attachmentIds.push(json.data.attachment.id)
        }
      }

      const result = await api.post<SubmittedTicket>('/tickets', {
        title: data.title,
        category: data.category,
        product: data.product || undefined,
        connector: data.connector || undefined,
        description: data.description || undefined,
        ...(attachmentIds.length > 0 && { attachmentIds }),
      }, authToken)
      setSubmitted(result)
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const copyId = () => {
    if (submitted?.displayId) {
      void navigator.clipboard.writeText(submitted.displayId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const resetForm = () => {
    setSubmitted(null)
    reset()
    setFiles([])
    setLinkUrl('')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--p-bg)' }}>
      <PortalNav />

      <main
        style={{
          maxWidth: 680,
          margin: '0 auto',
          padding: '48px 24px 80px',
        }}
      >
        {submitted ? (
          /* Confirmation state */
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--p-accent-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}
            >
              <Check size={28} style={{ color: 'var(--p-accent)' }} strokeWidth={2.5} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--p-text)', marginBottom: 8 }}>
              Your ticket has been submitted.
            </h2>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <button
                type="button"
                onClick={copyId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  background: 'var(--p-accent-bg)',
                  color: 'var(--p-accent)',
                  border: '1px solid rgba(37,99,235,0.2)',
                  borderRadius: 'var(--r-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {submitted.displayId}
                <Copy size={13} />
              </button>
              {copied && (
                <span style={{ fontSize: 12, color: 'var(--p-success)', marginLeft: 8, alignSelf: 'center' }}>
                  Copied!
                </span>
              )}
            </div>
            <p style={{ fontSize: 14, color: 'var(--p-text-3)', marginBottom: 28 }}>
              We&apos;ll be in touch shortly. Check your email for updates.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <a
                href={`/tickets/${submitted.ticket.id}`}
                style={{
                  display: 'inline-block',
                  padding: '10px 24px',
                  background: 'var(--p-accent)',
                  color: '#fff',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                View your ticket →
              </a>
              <button
                type="button"
                onClick={resetForm}
                style={{
                  fontSize: 13,
                  color: 'var(--p-text-3)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Submit another ticket
              </button>
            </div>
          </div>
        ) : (
          /* Form state */
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Header */}
            <div style={{ marginBottom: 40 }}>
              <h1
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  lineHeight: 1.1,
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--p-text)',
                }}
              >
                How can we help?
              </h1>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--p-text-3)', marginTop: 12, maxWidth: 560 }}>
                Describe your issue and we&apos;ll get back to you as soon as possible. Most tickets get a first
                response in under 2 hours.
              </p>
            </div>

            {/* Category */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                Issue category
              </label>
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <CategorySelector
                    value={field.value as TicketCategory ?? null}
                    onChange={field.onChange}
                    error={errors.category?.message}
                  />
                )}
              />
            </div>

            {/* Title */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-text)' }}>Title</label>
                {titleValue.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--p-text-4)', fontVariantNumeric: 'tabular-nums' }}>
                    {titleValue.length} / 120
                  </span>
                )}
              </div>
              <input
                {...register('title')}
                placeholder="Briefly describe your issue"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 14px',
                  border: `1px solid ${errors.title ? 'var(--p-danger)' : 'var(--p-border)'}`,
                  borderRadius: 'var(--r-sm)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  color: 'var(--p-text)',
                  background: '#fff',
                  outline: 'none',
                }}
              />
              {errors.title && (
                <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{errors.title.message}</p>
              )}
            </div>

            {/* Destination + Connector */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                  Which destination?
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    {...register('product')}
                    style={{
                      width: '100%', height: 40, padding: '0 32px 0 14px',
                      border: '1px solid var(--p-border)', borderRadius: 'var(--r-sm)',
                      fontFamily: 'inherit', fontSize: 14, color: 'var(--p-text)',
                      background: '#fff', outline: 'none', appearance: 'none',
                    }}
                  >
                    <option value="">Select a destination</option>
                    {DESTINATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <ChevronDown size={16} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--p-text-3)', pointerEvents: 'none' }} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                  Connector{' '}
                  <span style={{ color: 'var(--p-text-4)', fontWeight: 400 }}>(optional)</span>
                </label>
                <Controller
                  name="connector"
                  control={control}
                  render={({ field }) => (
                    <ConnectorSelect value={field.value ?? ''} onChange={field.onChange} />
                  )}
                />
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                Description{' '}
                <span style={{ color: 'var(--p-text-4)', fontWeight: 400 }}>(optional)</span>
              </label>
              <div
                style={{
                  border: '1px solid var(--p-border)',
                  borderRadius: 'var(--r-sm)',
                  background: '#fff',
                  overflow: 'hidden',
                }}
              >
                <textarea
                  {...register('description')}
                  placeholder="Describe the issue in detail…"
                  style={{
                    width: '100%',
                    minHeight: 160,
                    padding: '12px 14px',
                    border: 'none',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--p-text)',
                    background: 'transparent',
                    display: 'block',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderTop: '1px solid var(--p-border-2)',
                    background: 'var(--p-surface-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {[{ Icon: Bold, label: 'Bold' }, { Icon: Italic, label: 'Italic' }, { Icon: Code, label: 'Code' }, { Icon: LinkIcon, label: 'Link' }, { Icon: List, label: 'List' }].map(({ Icon, label }) => (
                      <button
                        key={label}
                        type="button"
                        aria-label={label}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 'var(--r-xs)',
                          color: 'var(--p-text-3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon size={14} />
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--p-text-4)' }}>Markdown supported</span>
                </div>
              </div>
            </div>

            {/* Guest email (only if not logged in) */}
            {!user && (
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                  Your email address
                </label>
                <input
                  {...register('guestEmail')}
                  type="email"
                  placeholder="you@example.com"
                  style={{
                    width: '100%',
                    height: 40,
                    padding: '0 14px',
                    border: `1px solid ${errors.guestEmail ? 'var(--p-danger)' : 'var(--p-border)'}`,
                    borderRadius: 'var(--r-sm)',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    color: 'var(--p-text)',
                    background: '#fff',
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: 12, color: 'var(--p-text-3)', marginTop: 4 }}>
                  We&apos;ll email you updates and you can reply directly from your inbox.
                </p>
                {errors.guestEmail && (
                  <p style={{ fontSize: 12, color: 'var(--p-danger)', marginTop: 4 }}>{errors.guestEmail.message}</p>
                )}
              </div>
            )}

            {/* Attachments */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--p-text)', marginBottom: 8 }}>
                Attachments{' '}
                <span style={{ color: 'var(--p-text-4)', fontWeight: 400 }}>(optional)</span>
              </label>
              <FileDropzone
                files={files}
                onFilesChange={setFiles}
                linkUrl={linkUrl}
                onLinkUrlChange={setLinkUrl}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                width: '100%',
                height: 44,
                background: isSubmitting ? 'rgba(37,99,235,0.7)' : 'var(--p-accent)',
                color: '#fff',
                borderRadius: 'var(--r-sm)',
                fontWeight: 600,
                fontSize: 14,
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'background 120ms',
              }}
            >
              {isSubmitting ? (
                <>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff',
                      display: 'inline-block',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                  Submitting…
                </>
              ) : (
                'Submit ticket'
              )}
            </button>

            {user && (
              <p style={{ fontSize: 12, color: 'var(--p-text-4)', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
                Replies will be sent to <strong style={{ color: 'var(--p-text)' }}>{user.email}</strong>.
              </p>
            )}
          </form>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
