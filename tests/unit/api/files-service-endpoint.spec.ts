/**
 * files-service-endpoint.spec — unit tests for FilesService S3 endpoint config.
 *
 * Regression guard for R265: the API failed to bootstrap because the storage client
 * was passed a malformed endpoint. The old `minio` client required a bare host and
 * threw `InvalidEndpointError` when given a full URL — which, under NestFactory's
 * default `abortOnError: true`, exited the process silently. Storage now uses
 * `@aws-sdk/client-s3`, which takes `S3_ENDPOINT` as a **full URL** (scheme encodes
 * transport + port) and is passed straight through. The AWS SDK rejects a bare host
 * or `host:port`, so the contract is "always a full URL"; these tests pin that the
 * configured endpoint reaches the client verbatim, with a sane localhost default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the config the S3 client is constructed with.
const s3Args: Array<Record<string, unknown>> = []
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg: Record<string, unknown>) {
      s3Args.push(cfg)
    }
  },
  HeadBucketCommand: class {},
  PutObjectCommand: class {},
  GetObjectCommand: class {},
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))

async function makeService(env: Record<string, string>) {
  const { FilesService } = await import('../../../apps/api/src/modules/files/files.service')
  const config = { get: (key: string): string | undefined => env[key] }
  // PrismaService is unused by the constructor path under test.
  return new FilesService({} as never, config as never)
}

describe('R265 — FilesService S3 endpoint config', () => {
  beforeEach(() => {
    s3Args.length = 0
  })

  it('passes a full https URL through to the client (the bootstrap-crash env shape)', async () => {
    await makeService({
      S3_ENDPOINT: 'https://objectstore.e2enetworks.net',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
      S3_BUCKET: 'tmrcms',
    })
    expect(s3Args).toHaveLength(1)
    expect(s3Args[0].endpoint).toBe('https://objectstore.e2enetworks.net')
    expect(s3Args[0].forcePathStyle).toBe(true)
  })

  it('passes a local http://host:port URL through unchanged', async () => {
    await makeService({ S3_ENDPOINT: 'http://localhost:9000' })
    expect(s3Args[0].endpoint).toBe('http://localhost:9000')
  })

  it('defaults to http://localhost:9000 and us-east-1 when unset', async () => {
    await makeService({})
    expect(s3Args[0].endpoint).toBe('http://localhost:9000')
    expect(s3Args[0].region).toBe('us-east-1')
  })
})
