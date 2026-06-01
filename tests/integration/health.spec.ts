/**
 * Smoke test — proves the entire harness works end-to-end:
 *   Testcontainers Postgres + MinIO boot, Prisma migrations apply, Nest module
 *   compiles, supertest can hit /health, the response is wrapped by the
 *   TransformResponseInterceptor (regression R21).
 *
 * If this test passes, the integration framework is operational.
 */

import { harness } from './harness'
import './setup'

describe('integration harness smoke', () => {
  it('GET /api/v1/health returns wrapped { data } payload', async () => {
    const res = await harness.request().get('/api/v1/health')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.data).toMatchObject({ status: expect.any(String), db: expect.any(String) })
  })

  it('TransformResponseInterceptor wraps exactly once (R21)', async () => {
    const res = await harness.request().get('/api/v1/health')

    // If the interceptor double-wrapped, body.data would itself contain a `data` field.
    expect(res.body.data).not.toHaveProperty('data')
  })

  it('Prisma is connected and tables are queryable', async () => {
    const count = await harness.prisma.user.count()
    expect(count).toBe(0) // truncated in beforeEach
  })
})
