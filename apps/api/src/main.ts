import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor'
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe'

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule, { rawBody: true })

  app.setGlobalPrefix('api/v1')
  app.enableCors({
    origin: [
      process.env['PORTAL_URL'] ?? 'http://localhost:3000',
      process.env['DASHBOARD_URL'] ?? 'http://localhost:3002',
    ],
    credentials: true,
  })

  app.useGlobalPipes(new ZodValidationPipe())
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new TransformResponseInterceptor())

  const port = process.env['PORT'] ?? 3001
  await app.listen(port)
  logger.log(`API running on port ${port}`)
}

bootstrap()
