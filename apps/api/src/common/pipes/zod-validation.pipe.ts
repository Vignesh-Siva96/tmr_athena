import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common'
import { ZodSchema, ZodError } from 'zod'

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown): unknown {
    if (!this.schema) return value

    const result = this.schema.safeParse(value)
    if (!result.success) {
      const error = result.error as ZodError
      throw new BadRequestException({
        message: 'Validation failed',
        details: error.flatten(),
      })
    }
    return result.data
  }
}
