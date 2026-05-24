import { Controller, Get, Post, Param, Body, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { z } from 'zod'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'

const submitRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
})
type SubmitRatingDto = z.infer<typeof submitRatingSchema>

@Controller('rate')
export class RatingController {
  constructor(private readonly db: PrismaService) {}

  @Get(':token')
  async getRatingForm(@Param('token') token: string) {
    const rating = await this.db.ticketRating.findUnique({
      where: { ratingToken: token },
      include: { ticket: { select: { title: true, number: true } } },
    })
    if (!rating) throw new NotFoundException('Rating link not found')
    return {
      ticketTitle: rating.ticket.title,
      ticketNumber: rating.ticket.number,
      alreadyRated: !!rating.ratedAt,
      currentRating: rating.userRating ?? null,
    }
  }

  @Post(':token')
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
