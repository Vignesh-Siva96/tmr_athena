import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard'
import { AuthGuard } from '../../common/guards/auth.guard'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { User } from '@tmr/types'
import {
  signupSchema,
  signinSchema,
  googleAuthSchema,
  guestSchema,
  agentSigninSchema,
  agentGoogleSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  ssoSchema,
  type SignupDto,
  type SigninDto,
  type GoogleAuthDto,
  type GuestDto,
  type AgentSigninDto,
  type AgentGoogleDto,
  type VerifyEmailDto,
  type ForgotPasswordDto,
  type ResetPasswordDto,
  type SsoDto,
  acceptInviteSchema,
  type AcceptInviteDto,
} from './auth.dto'

// Auth endpoints are unauthenticated by nature (that's the point) — without a cap,
// signin/agent-signin become a user-enumeration + credential-brute-force surface, and
// guest is an open account-creation faucet. 10 attempts/minute per IP is generous for
// a real user, punishing for a brute-force loop.
const AUTH_RATE_LIMIT = [10, 60_000] as const

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @RateLimit(...AUTH_RATE_LIMIT)
  signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto) {
    return this.authService.signup(dto)
  }

  @Post('signin')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  signin(@Body(new ZodValidationPipe(signinSchema)) dto: SigninDto) {
    return this.authService.signin(dto)
  }

  @Post('google')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  googleAuth(@Body(new ZodValidationPipe(googleAuthSchema)) dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto)
  }

  @Post('guest')
  @RateLimit(...AUTH_RATE_LIMIT)
  guestSession(@Body(new ZodValidationPipe(guestSchema)) dto: GuestDto) {
    return this.authService.guestSession(dto)
  }

  @Post('agent/signin')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  agentSignin(@Body(new ZodValidationPipe(agentSigninSchema)) dto: AgentSigninDto) {
    return this.authService.agentSignin(dto)
  }

  @Post('agent/google')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  agentGoogleAuth(@Body(new ZodValidationPipe(agentGoogleSchema)) dto: AgentGoogleDto) {
    return this.authService.agentGoogleAuth(dto)
  }

  @Post('verify-email')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token)
  }

  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @RateLimit(...AUTH_RATE_LIMIT)
  resendVerification(@CurrentUser() user: User) {
    return this.authService.resendVerification(user.id)
  }

  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email)
    return { message: 'If an account exists for this email, a reset link has been sent.' }
  }

  @Post('reset-password')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password)
    return { message: 'Password updated successfully.' }
  }

  @Post('sso')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  ssoAuth(@Body(new ZodValidationPipe(ssoSchema)) dto: SsoDto) {
    return this.authService.ssoAuth(dto)
  }

  @Post('agent/accept-invite')
  @HttpCode(200)
  @RateLimit(...AUTH_RATE_LIMIT)
  acceptAgentInvite(@Body(new ZodValidationPipe(acceptInviteSchema)) dto: AcceptInviteDto) {
    return this.authService.acceptAgentInvite(dto)
  }
}
