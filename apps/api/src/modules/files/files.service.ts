import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'
import * as crypto from 'crypto'
import * as path from 'path'
import { PrismaService } from '../database/prisma.service'

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

  async uploadFile(
    file: Express.Multer.File,
    ticketId?: string,
  ): Promise<{ attachment: unknown }> {
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('File exceeds 10MB limit')
    }

    await this.ensureBucket()

    const ext = path.extname(file.originalname)
    const objectName = `${crypto.randomUUID()}${ext}`

    await this.minioClient.putObject(
      this.bucket,
      objectName,
      file.buffer,
      file.size,
      { 'Content-Type': file.mimetype },
    )

    // Generate presigned URL (7 days)
    const url = await this.minioClient.presignedGetObject(this.bucket, objectName, 7 * 24 * 60 * 60)

    const attachment = await this.db.attachment.create({
      data: {
        ticketId: ticketId ?? undefined,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url,
      },
    })

    return { attachment }
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
