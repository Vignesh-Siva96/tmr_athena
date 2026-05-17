import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'

interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let code = 'INTERNAL_ERROR'
    let message = 'An unexpected error occurred'
    let details: unknown = undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>
        message = (resp['message'] as string) ?? message
        details = resp['details']
      }

      code = HttpStatus[status] ?? 'HTTP_ERROR'
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack)
    }

    const body: ErrorResponse = {
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    }

    response.status(status).json(body)
  }
}
