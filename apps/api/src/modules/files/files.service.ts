import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'
import * as crypto from 'crypto'
import * as path from 'path'
import { PrismaService } from '../database/prisma.service'
import type { Attachment } from '@tmr/db'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name)
  private readonly minioClient: Client
  private readonly bucket: string

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('MINIO_BUCKET') ?? 'tmr-support'
    this.minioClient = new Client({
      endPoint: this.config.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: parseInt(this.config.get<string>('MINIO_PORT') ?? '9000', 10),
      useSSL: false,
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY') ?? '',
      secretKey: this.config.get<string>('MINIO_SECRET_KEY') ?? '',
    })
  }

  private async ensureBucket(): Promise<void> {
    try {
      const exists = await this.minioClient.bucketExists(this.bucket)
      if (!exists) {
        await this.minioClient.makeBucket(this.bucket, 'us-east-1')
        this.logger.log(`Created bucket: ${this.bucket}`)
      }
    } catch (err) {
      this.logger.warn(`Could not ensure bucket: ${String(err)}`)
    }
  }

  async storeBuffer(
    buffer: Buffer,
    opts: { filename: string; mimeType: string; size: number; ticketId?: string; messageId?: string },
  ): Promise<Attachment> {
    await this.ensureBucket()

    const ext = path.extname(opts.filename)
    const objectName = `${crypto.randomUUID()}${ext}`

    await this.minioClient.putObject(
      this.bucket,
      objectName,
      buffer,
      opts.size,
      { 'Content-Type': opts.mimeType },
    )

    const url = await this.minioClient.presignedGetObject(this.bucket, objectName, 7 * 24 * 60 * 60)

    return this.db.attachment.create({
      data: {
        ticketId: opts.ticketId ?? undefined,
        messageId: opts.messageId ?? undefined,
        filename: opts.filename,
        mimeType: opts.mimeType,
        size: opts.size,
        url,
      },
    })
  }

  async uploadFile(
    file: Express.Multer.File,
    ticketId?: string,
  ): Promise<{ attachment: unknown }> {
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File exceeds 10MB limit')
    }

    const attachment = await this.storeBuffer(file.buffer, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      ticketId,
    })

    return { attachment }
  }

  /**
   * Fetch the raw bytes of a stored attachment from MinIO. Used by the email path
   * to attach agent-uploaded files to outbound replies.
   *
   * The MinIO object key isn't stored on the row — only the presigned `url` is — so
   * we recover the key from the URL path (`/<bucket>/<objectName>`), which is how
   * `storeBuffer` wrote it (path-style addressing).
   */
  async getAttachmentBuffer(attachment: Pick<Attachment, 'url' | 'isLink'>): Promise<Buffer> {
    if (attachment.isLink) {
      throw new BadRequestException('Cannot fetch bytes for a link attachment')
    }
    const objectName = this.objectNameFromUrl(attachment.url)
    const stream = await this.minioClient.getObject(this.bucket, objectName)
    const chunks: Buffer[] = []
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  /** Recover the MinIO object key from a presigned (or plain) object URL. */
  private objectNameFromUrl(url: string): string {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '')
    return pathname.startsWith(`${this.bucket}/`)
      ? pathname.slice(this.bucket.length + 1)
      : pathname
  }

  async uploadLink(linkUrl: string, ticketId?: string): Promise<{ attachment: unknown }> {
    const attachment = await this.db.attachment.create({
      data: {
        ticketId: ticketId ?? undefined,
        filename: linkUrl,
        mimeType: 'text/uri-list',
        size: 0,
        url: linkUrl,
        isLink: true,
        linkUrl,
      },
    })

    return { attachment }
  }
}
