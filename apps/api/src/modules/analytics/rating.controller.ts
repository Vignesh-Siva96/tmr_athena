import { Controller, Get, Post, Param, Body, BadRequestException, NotFoundException, UseGuards } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { z } from 'zod'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import { formatRef } from '../tickets/util/generate-ref'
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard'

const submitRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
})
type SubmitRatingDto = z.infer<typeof submitRatingSchema>

// Unauthenticated by design (the link is the credential) — without a cap, the token
// param is a brute-forceable surface (guess a valid ratingToken, view/submit on someone
// else's ticket). 20/minute per IP is plenty for a real customer following an email link.
const RATE_LIMIT = [20, 60_000] as const

@Controller('rate')
@UseGuards(RateLimitGuard)
export class RatingController {
  constructor(private readonly db: PrismaService) {}

  @Get(':token')
  @RateLimit(...RATE_LIMIT)
  async getRatingForm(@Param('token') token: string) {
    const rating = await this.db.ticketRating.findUnique({
      where: { ratingToken: token },
      include: { ticket: { select: { title: true, ref: true } } },
    })
    if (!rating) throw new NotFoundException('Rating link not found')
    return {
      ticketTitle: rating.ticket.title,
      ticketRef: formatRef(rating.ticket.ref),
      alreadyRated: !!rating.ratedAt,
      currentRating: rating.userRating ?? null,
    }
  }

  @Post(':token')
  @RateLimit(...RATE_LIMIT)
  async submitRating(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submitRatingSchema)) dto: SubmitRatingDto,
  ) {
    const rating = await this.db.ticketRating.findUnique({ where: { ratingToken: token } })
    if (!rating) throw new NotFoundException('Rating link not found')
    if (rating.ratedAt) {
      // Idempotent — return current state without error
      return { success: true, alreadyRated: true }
    }

    await this.db.ticketRating.update({
      where: { ratingToken: token },
      data: {
        userRating: dto.rating,
        userComment: dto.comment ?? null,
        ratedAt: new Date(),
      },
    })

    return { success: true }
  }
}
