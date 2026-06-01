import { http, HttpResponse } from 'msw'

// Two endpoints: token exchange + userinfo (used by both regular OAuth and email-sync OAuth).
export const googleOAuthHandlers = [
  http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
    const body = new URLSearchParams(await request.text())
    if (body.get('client_id') === 'invalid') {
      return HttpResponse.json(
        { error: 'invalid_client', error_description: 'Client not registered' },
        { status: 401 },
      )
    }
    if (body.get('refresh_token') === 'revoked') {
      return HttpResponse.json(
        { error: 'invalid_grant', error_description: 'Token has been revoked' },
        { status: 401 },
      )
    }
    return HttpResponse.json({
      access_token: 'google_test_access',
      refresh_token: body.get('grant_type') === 'authorization_code' ? 'google_test_refresh' : undefined,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: body.get('scope') ?? 'openid email profile',
    })
  }),

  http.get('https://www.googleapis.com/oauth2/v3/userinfo', () =>
    HttpResponse.json({
      sub: 'google_user_123',
      email: 'test.user@example.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/avatar.png',
    }),
  ),

  http.get('https://openidconnect.googleapis.com/v1/userinfo', () =>
    HttpResponse.json({
      sub: 'google_user_123',
      email: 'test.user@example.com',
      email_verified: true,
      name: 'Test User',
    }),
  ),
]
