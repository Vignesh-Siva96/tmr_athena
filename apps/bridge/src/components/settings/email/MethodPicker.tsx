'use client'

interface MethodPickerProps {
  onSelectGoogle: () => void
  onSelectMicrosoft: () => void
  onSelectPassword?: () => void  // kept for API compat but no longer rendered
}

const card: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '16px 20px',
  background: 'var(--d-raised)',
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--r-md)',
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s, background 0.15s',
}

const GoogleLogo = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
)

const MicrosoftLogo = () => (
  <svg width="22" height="22" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
    <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
  </svg>
)

export function MethodPicker({ onSelectGoogle, onSelectMicrosoft }: MethodPickerProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        style={card}
        onClick={onSelectGoogle}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--d-accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--d-surface)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--d-border)'; (e.currentTarget as HTMLElement).style.background = 'var(--d-raised)' }}
      >
        <GoogleLogo />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)' }}>Sign in with Google</div>
          <div style={{ fontSize: 12, color: 'var(--d-text-3)', marginTop: 2 }}>Connect Gmail or Google Workspace</div>
        </div>
      </button>

      <button
        type="button"
        style={card}
        onClick={onSelectMicrosoft}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--d-accent)'; (e.currentTarget as HTMLElement).style.background = 'var(--d-surface)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--d-border)'; (e.currentTarget as HTMLElement).style.background = 'var(--d-raised)' }}
      >
        <MicrosoftLogo />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--d-text)' }}>Sign in with Microsoft</div>
          <div style={{ fontSize: 12, color: 'var(--d-text-3)', marginTop: 2 }}>Connect Outlook or Microsoft 365</div>
        </div>
      </button>
    </div>
  )
}
