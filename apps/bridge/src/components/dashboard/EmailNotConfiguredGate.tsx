'use client'
import { useRouter } from 'next/navigation'
import { Mail, Inbox, Reply, Sparkles } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export function EmailNotConfiguredGate() {
  const router = useRouter()
  const { agent } = useAuth()
  const isAdmin = agent?.role === 'ADMIN'

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
    }}>
      <div style={{
        maxWidth: 480,
        width: '100%',
        background: 'var(--d-surface)',
        border: '1px solid var(--d-border)',
        borderRadius: 'var(--r-lg)',
        padding: '40px 36px',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        {/* Icon */}
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'rgba(99,102,241,0.12)',
          border: '1px solid rgba(99,102,241,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Mail size={24} style={{ color: 'var(--d-accent)' }} />
        </div>

        {/* Headline */}
        <h2 style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--d-text)',
          margin: '0 0 10px',
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.01em',
        }}>
          {isAdmin
            ? 'Connect your support inbox to start receiving tickets'
            : 'Email isn\'t connected yet'}
        </h2>

        {/* Description */}
        <p style={{
          fontSize: 14,
          color: 'var(--d-text-3)',
          lineHeight: 1.6,
          margin: '0 0 28px',
        }}>
          {isAdmin
            ? 'Link your Gmail or email inbox once and tickets will flow in automatically — no forwarding rules or MX changes needed.'
            : 'Your admin needs to connect a support inbox before tickets can flow in. Reach out to your admin to get this set up.'}
        </p>

        {/* Feature list — admin only */}
        {isAdmin && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            marginBottom: 28,
            textAlign: 'left',
          }}>
            {[
              { icon: Inbox, text: 'Inbound parsing — every customer email becomes a ticket' },
              { icon: Sparkles, text: 'Auto-ticket creation — no manual entry required' },
              { icon: Reply, text: 'Outbound replies — send from your support address directly in Bridge' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'var(--d-raised)',
                  border: '1px solid var(--d-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={13} style={{ color: 'var(--d-accent)' }} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--d-text-2)', lineHeight: 1.4 }}>{text}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => router.push('/settings/email')}
            style={{
              height: 40,
              padding: '0 24px',
              background: 'var(--d-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--r-sm)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Mail size={15} />
            Connect email
          </button>
        ) : (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'var(--d-raised)',
            border: '1px solid var(--d-border)',
            borderRadius: 'var(--r-sm)',
            fontSize: 13,
            color: 'var(--d-text-3)',
          }}>
            Waiting for an admin to connect the inbox
          </div>
        )}
      </div>
    </div>
  )
}
