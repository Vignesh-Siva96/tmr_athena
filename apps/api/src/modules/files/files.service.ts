import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as crypto from "crypto";
import * as path from "path";
import { PrismaService } from "../database/prisma.service";
import type { Attachment } from "@tmr/db";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_READ_URL_TTL = 600; // 10 minutes — read URLs are minted on click, so a short window is plenty

/**
 * Extensions that must never render inline in a browser (script/markup/executable).
 * Uploads of these are rejected; if one already exists, its download URL is forced
 * to `Content-Disposition: attachment` so it can't execute in the viewer's origin.
 */
const RISKY_EXTENSIONS = new Set([".exe", ".html", ".htm", ".svg"]);
const BLOCKED_UPLOAD_EXTENSIONS = new Set([".exe"]);

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly readUrlTtl: number;

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService
  ) {
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "tmr-support";
    this.readUrlTtl = parseInt(
      this.config.get<string>("S3_READ_URL_TTL_SECONDS") ??
        String(DEFAULT_READ_URL_TTL),
      10
    );

    // `S3_ENDPOINT` is a full URL — scheme included (`https://…` for prod E2E,
    // `http://localhost:9000` for local MinIO). The AWS SDK parses the scheme/host/
    // port itself, so transport and port are encoded in the URL (no separate
    // S3_USE_SSL/S3_PORT). A bare host or `host:port` is rejected by the SDK.
    this.s3 = new S3Client({
      endpoint: this.config.get<string>("S3_ENDPOINT") ?? "http://localhost:9000",
      // Path-style addressing (host/bucket/key) is required for MinIO and E2E,
      // and keeps presigned URLs in the shape `objectNameFromUrl` parses below.
      forcePathStyle: true,
      // S3 SDK requires a region string; MinIO/E2E ignore the value.
      region: this.config.get<string>("S3_REGION") ?? "us-east-1",
      credentials: {
        accessKeyId: this.config.get<string>("S3_ACCESS_KEY") ?? "",
        secretAccessKey: this.config.get<string>("S3_SECRET_KEY") ?? "",
      },
    });
  }

  /** True when a file must be forced to download rather than render inline. */
  private isRiskyType(filename: string): boolean {
    return RISKY_EXTENSIONS.has(path.extname(filename).toLowerCase());
  }

  private async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const message = `Object storage bucket "${this.bucket}" is not accessible. It must be provisioned ahead of time (the bucket is shared with other apps and is not auto-created).`;
      this.logger.error(message, err instanceof Error ? err.stack : undefined);
      throw new Error(message);
    }
  }

  async storeBuffer(
    buffer: Buffer,
    opts: {
      filename: string;
      mimeType: string;
      size: number;
      ticketId?: string;
      messageId?: string;
    }
  ): Promise<Attachment> {
    await this.ensureBucket();

    const ext = path.extname(opts.filename);
    const objectName = `${crypto.randomUUID()}${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectName,
        Body: buffer,
        ContentLength: opts.size,
        ContentType: opts.mimeType,
      })
    );

    // `url` stays a presigned URL for backward-compat with existing rows/consumers, but it is no
    // longer how attachments are served — clients fetch a fresh URL via `presignReadUrl` on click.
    // The durable handle is `objectKey`.
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectName }),
      { expiresIn: this.readUrlTtl }
    );

    return this.db.attachment.create({
      data: {
        ticketId: opts.ticketId ?? undefined,
        messageId: opts.messageId ?? undefined,
        filename: opts.filename,
        mimeType: opts.mimeType,
        size: opts.size,
        url,
        objectKey: objectName,
      },
    });
  }

  async uploadFile(
    file: Express.Multer.File,
    ticketId?: string
  ): Promise<{ attachment: unknown }> {
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException("File exceeds 10MB limit");
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`File type ${ext} is not allowed`);
    }

    const attachment = await this.storeBuffer(file.buffer, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      ticketId,
    });

    return { attachment };
  }

  /**
   * Mint a fresh, short-lived presigned GET URL for an attachment. Called on click (via the
   * `/files/:id/sign` endpoint) so the link is always valid regardless of how long the page sat
   * open, and a leaked URL expires quickly. Risky types (`.html`/`.svg`/`.exe`) are forced to
   * download instead of rendering inline.
   */
  async presignReadUrl(
    attachment: Pick<Attachment, "url" | "objectKey" | "filename" | "isLink">
  ): Promise<string> {
    if (attachment.isLink) {
      throw new BadRequestException("Cannot sign a link attachment");
    }
    const objectName = this.resolveObjectKey(attachment);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectName,
      ...(this.isRiskyType(attachment.filename)
        ? {
            ResponseContentDisposition: `attachment; filename="${attachment.filename.replace(/"/g, "")}"`,
          }
        : {}),
    });
    return getSignedUrl(this.s3, command, { expiresIn: this.readUrlTtl });
  }

  /**
   * Fetch the raw bytes of a stored attachment from object storage. Used by the
   * email path to attach agent-uploaded files to outbound replies.
   */
  async getAttachmentBuffer(
    attachment: Pick<Attachment, "url" | "objectKey" | "isLink">
  ): Promise<Buffer> {
    if (attachment.isLink) {
      throw new BadRequestException("Cannot fetch bytes for a link attachment");
    }
    const objectName = this.resolveObjectKey(attachment);
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectName })
    );
    if (!res.Body) {
      throw new Error(`Empty object body for "${objectName}"`);
    }
    // The SDK augments the Node stream with `transformToByteArray()`.
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * The durable object key. Prefer the stored `objectKey`; fall back to parsing it out of the
   * legacy `url` for rows created before the column existed (un-backfilled).
   */
  private resolveObjectKey(
    attachment: Pick<Attachment, "url" | "objectKey">
  ): string {
    return attachment.objectKey ?? this.objectNameFromUrl(attachment.url);
  }

  /** Recover the MinIO object key from a presigned (or plain) object URL. */
  private objectNameFromUrl(url: string): string {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(
      /^\/+/,
      ""
    );
    return pathname.startsWith(`${this.bucket}/`)
      ? pathname.slice(this.bucket.length + 1)
      : pathname;
  }

  async uploadLink(
    linkUrl: string,
    ticketId?: string
  ): Promise<{ attachment: unknown }> {
    const attachment = await this.db.attachment.create({
      data: {
        ticketId: ticketId ?? undefined,
        filename: linkUrl,
        mimeType: "text/uri-list",
        size: 0,
        url: linkUrl,
        isLink: true,
        linkUrl,
      },
    });

    return { attachment };
  }
}
