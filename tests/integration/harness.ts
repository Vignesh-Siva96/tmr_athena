/**
 * Test harness: holds the booted Nest app + a supertest agent.
 *
 * Lifecycle is owned by setup.ts (boot in beforeAll, shutdown in afterAll).
 * Tests import { harness } and call harness.request, harness.prisma, harness.app.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, Logger } from '@nestjs/common'
import { AppModule } from '../../apps/api/src/app.module'
import { ZodValidationPipe } from '../../apps/api/src/common/pipes/zod-validation.pipe'
import { AllExceptionsFilter } from '../../apps/api/src/common/filters/all-exceptions.filter'
import { TransformResponseInterceptor } from '../../apps/api/src/common/interceptors/transform-response.interceptor'
import { PrismaService } from '../../apps/api/src/modules/database/prisma.service'
import request from 'supertest'
import type { TestAgent } from 'supertest/lib/agent'

class Harness {
  private moduleRef?: TestingModule
  private _app?: INestApplication
  private _prisma?: PrismaService

  async boot(): Promise<void> {
    if (this._app) return

    this.moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    this._app = this.moduleRef.createNestApplication({ rawBody: true })

    this._app.setGlobalPrefix('api/v1')
    this._app.useGlobalPipes(new ZodValidationPipe())
    this._app.useGlobalFilters(new AllExceptionsFilter())
    this._app.useGlobalInterceptors(new TransformResponseInterceptor())

    await this._app.init()

    this._prisma = this.moduleRef.get(PrismaService, { strict: false })
  }

  async shutdown(): Promise<void> {
    await this._app?.close()
    this._app = undefined
    this.moduleRef = undefined
  }

  get app(): INestApplication {
    if (!this._app) throw new Error('Harness not booted')
    return this._app
  }

  get prisma(): PrismaService {
    if (!this._prisma) throw new Error('Harness not booted')
    return this._prisma
  }

  /**
   * Fresh supertest agent against the booted Nest HTTP server. Use this for
   * every test so cookies / headers don't leak.
   */
  request(): TestAgent {
    return request(this.app.getHttpServer()) as unknown as TestAgent
  }

  /**
   * Resolve a Nest provider by token. Useful for grabbing services to assert
   * side-effects (e.g. spying on SseService.broadcast).
   */
  get<T>(token: any): T {
    if (!this.moduleRef) throw new Error('Harness not booted')
    return this.moduleRef.get<T>(token, { strict: false })
  }
}

export const harness = new Harness()
