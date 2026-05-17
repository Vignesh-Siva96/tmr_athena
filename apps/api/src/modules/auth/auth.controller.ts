import { Controller, Post, Body, HttpCode } from '@nestjs/common'
import { AuthService } from './auth.service'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import {
  signupSchema,
  signinSchema,
  googleAuthSchema,
  guestSchema,
  magicLinkSchema,
  agentSigninSchema,
  agentGoogleSchema,
  type SignupDto,
  type SigninDto,
  type GoogleAuthDto,
  type GuestDto,
  type MagicLinkDto,
  type AgentSigninDto,
  type AgentGoogleDto,
} from './auth.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto) {
    return this.authService.signup(dto)
  }

  @Post('signin')
  @HttpCode(200)
  signin(@Body(new ZodValidationPipe(signinSchema)) dto: SigninDto) {
    return this.authService.signin(dto)
  }

  @Post('google')
  @HttpCode(200)
  googleAuth(@Body(new ZodValidationPipe(googleAuthSchema)) dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto)
  }

  @Post('guest')
  guestSession(@Body(new ZodValidationPipe(guestSchema)) dto: GuestDto) {
    return this.authService.guestSession(dto)
  }

  @Post('magic-link')
  @HttpCode(200)
  sendMagicLink(@Body(new ZodValidationPipe(magicLinkSchema)) dto: MagicLinkDto) {
    return this.authService.sendMagicLink(dto.email, dto.ticketId)
  }

  @Post('agent/signin')
  @HttpCode(200)
  agentSignin(@Body(new ZodValidationPipe(agentSigninSchema)) dto: AgentSigninDto) {
    return this.authService.agentSignin(dto)
  }

  @Post('agent/google')
  @HttpCode(200)
  agentGoogleAuth(@Body(new ZodValidationPipe(agentGoogleSchema)) dto: AgentGoogleDto) {
    return this.authService.agentGoogleAuth(dto)
  }
}
