const STATE_KEY = 'google_oauth_state'

function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function redirectToGoogle(): void {
  const clientId = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']
  if (!clientId) {
    console.error('NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set')
    return
  }

  const nonce = generateNonce()
  sessionStorage.setItem(STATE_KEY, nonce)

  const redirectUri = `${window.location.origin}/auth/google/callback`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: nonce,
    prompt: 'select_account',
  })

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function verifyAndConsumeState(state: string): boolean {
  const stored = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  return stored !== null && stored === state
}
