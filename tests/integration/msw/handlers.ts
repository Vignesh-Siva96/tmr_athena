/**
 * MSW handlers aggregating all external services.
 *
 * Tests can override individual handlers per-test via mswServer.use(...).
 * Each provider has its own file under ./providers/ to keep handlers
 * focused and reduce merge conflicts.
 */

import type { HttpHandler } from 'msw'
import { gmailHandlers } from './providers/gmail'
import { graphHandlers } from './providers/graph'
import { geminiHandlers } from './providers/gemini'
import { githubHandlers } from './providers/github'
import { googleOAuthHandlers } from './providers/google-oauth'
import { microsoftOAuthHandlers } from './providers/microsoft-oauth'

export const allHandlers: HttpHandler[] = [
  ...gmailHandlers,
  ...graphHandlers,
  ...geminiHandlers,
  ...githubHandlers,
  ...googleOAuthHandlers,
  ...microsoftOAuthHandlers,
]
