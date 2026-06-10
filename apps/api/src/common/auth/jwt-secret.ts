import type { ConfigService } from '@nestjs/config'

export const MIN_JWT_SECRET_LENGTH = 32

/**
 * Single source of truth for the JWT signing/verification secret.
 * `validateEnv` (wired into ConfigModule.forRoot in app.module.ts) guarantees
 * BETTER_AUTH_SECRET is present and long enough by the time this runs — no
 * fallback is needed or wanted (divergent fallbacks silently weaken auth).
 */
export function getJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('BETTER_AUTH_SECRET')
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`,
    )
  }
  return secret
}
