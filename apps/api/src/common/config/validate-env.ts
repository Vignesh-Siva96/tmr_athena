import { MIN_JWT_SECRET_LENGTH } from '../auth/jwt-secret'

/**
 * Boot-time env validation passed to ConfigModule.forRoot({ validate }).
 * Throwing here makes Nest refuse to start — fail fast instead of silently
 * falling back to a weak/empty JWT secret (the divergent 'dev-secret' / ''
 * fallbacks previously let auth boot in a broken or insecure state).
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const secret = env['BETTER_AUTH_SECRET']
  if (typeof secret !== 'string' || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET env var is required and must be at least ${MIN_JWT_SECRET_LENGTH} characters long`,
    )
  }
  return env
}
