import { http, HttpResponse } from 'msw'

export const microsoftOAuthHandlers = [
  http.post('https://login.microsoftonline.com/:tenant/oauth2/v2.0/token', () =>
    HttpResponse.json({
      access_token: 'ms_test_access',
      refresh_token: 'ms_test_refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'Mail.ReadWrite Mail.Send offline_access',
    }),
  ),
]
