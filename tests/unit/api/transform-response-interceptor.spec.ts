/**
 * transform-response-interceptor.spec — unit tests for the global { data } wrapper.
 *
 * Regression catalogue rows:
 *   R203 — the interceptor must NOT wrap @Sse handler emissions. Wrapping each
 *          SSE frame produced `data: {"data":"{\"type\":…}"}` on the wire, so the
 *          Bridge client parsed an envelope with no `type` and silently dropped
 *          every event — SSE was dead app-wide while connections looked healthy
 *          (masked by polling fallbacks). Found by E2E flow F1.
 */

// reflect-metadata and rxjs are deps of @tmr/api, not the repo root — import their copies
import '../../../apps/api/node_modules/reflect-metadata'
import { describe, it, expect } from 'vitest'
import { of, lastValueFrom } from '../../../apps/api/node_modules/rxjs'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { TransformResponseInterceptor } from '../../../apps/api/src/common/interceptors/transform-response.interceptor'

const SSE_METADATA = '__sse__' // Nest's @Sse() marker (constants.js)

function makeCtx(handler: () => void): ExecutionContext {
  return { getHandler: () => handler } as unknown as ExecutionContext
}

function makeNext(value: unknown): CallHandler {
  return { handle: () => of(value) }
}

describe('R203 — TransformResponseInterceptor', () => {
  const interceptor = new TransformResponseInterceptor()

  it('wraps plain handler responses in { data }', async () => {
    const handler = () => {}
    const out = await lastValueFrom(
      interceptor.intercept(makeCtx(handler), makeNext({ id: 't1' })),
    )
    expect(out).toEqual({ data: { id: 't1' } })
  })

  it('wraps null/undefined as { data: null }', async () => {
    const handler = () => {}
    const out = await lastValueFrom(interceptor.intercept(makeCtx(handler), makeNext(null)))
    expect(out).toEqual({ data: null })
  })

  it('passes @Sse frames through UNWRAPPED so event.type survives the wire', async () => {
    const sseHandler = () => {}
    Reflect.defineMetadata(SSE_METADATA, true, sseHandler)
    const frame = { data: JSON.stringify({ type: 'ticket-created', ticketId: 't1' }) }
    const out = await lastValueFrom(
      interceptor.intercept(makeCtx(sseHandler), makeNext(frame)),
    )
    // Must be the frame itself, not { data: frame }
    expect(out).toBe(frame)
    const parsed = JSON.parse((out as { data: string }).data) as { type: string }
    expect(parsed.type).toBe('ticket-created')
  })
})
