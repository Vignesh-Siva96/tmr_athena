import { LoggerService as NestLoggerService } from '@nestjs/common'
import * as winston from 'winston'
import { createLogger, format, Logger, transports } from 'winston'
import {
  LoggingWinston,
  Options as LoggingWinstonOptions,
} from '@google-cloud/logging-winston'
import 'winston-daily-rotate-file'
import { networkInterfaces } from 'os'
import type { NetworkInterfaceInfo } from 'os'
import * as path from 'path'
import { truncateLogPayload, safeStringify, getSizeKB } from './log-truncation'

// ── Env ──────────────────────────────────────────────────────────────────────
const {
  CLOUD_PROVIDER,
  GOOGLE_CLOUD_PROJECT_ID,
  GOOGLE_CLOUD_CREDENTIALS_PATH = './cloudlogging.json',
  GOOGLE_CLOUD_SERVICE_CONTEXT,
  LOG_SERVICE_NAME = 'athena-api',
} = process.env

const LOG_DIR = path.join(process.cwd(), 'logs')

// First non-internal IPv4 address — attached to every entry so multi-host
// deployments are distinguishable in Cloud Logging.
const serverIP = Object.values(networkInterfaces() ?? {})
  .filter((list): list is NetworkInterfaceInfo[] => list != null)
  .flat()
  .find((net) => net.family === 'IPv4' && !net.internal)?.address

// ── GCP 256KB payload guard ────────────────────────────────────────────────────
// GCP's 256KB limit applies to the protobuf-encoded entry, not JSON.
// google.protobuf.Struct adds ~40-50% overhead for typical text-heavy logs, so
// 170KB JSON * 1.5 ≈ 255KB leaves headroom under the 256KB cap.
const GCP_MAX_SAFE_JSON_KB = 170
const GCP_TRUNCATION_TARGET_KB = 155

const reduceLogInfoSize = (logObject: Record<string, unknown>): Record<string, unknown> => {
  // Sanitize circular/shared refs before measuring (see tmr_data_service logger
  // for the full rationale on toJSON inflation / protobuf vs JSON measurement).
  let obj: Record<string, unknown> = logObject
  let serialized: string | null = null
  let sizeKB: number
  try {
    serialized = JSON.stringify(logObject)
    sizeKB = Buffer.byteLength(serialized, 'utf8') / 1024
  } catch {
    obj = JSON.parse(safeStringify(logObject)) as Record<string, unknown>
    sizeKB = Buffer.byteLength(JSON.stringify(obj), 'utf8') / 1024
  }

  if (sizeKB <= GCP_MAX_SAFE_JSON_KB) {
    return serialized !== null ? (JSON.parse(serialized) as Record<string, unknown>) : obj
  }

  const truncated = truncateLogPayload(obj, GCP_TRUNCATION_TARGET_KB, sizeKB)
  const truncatedSizeKB = (truncated._truncatedSizeKB as number) ?? getSizeKB(truncated)
  if (truncatedSizeKB <= GCP_MAX_SAFE_JSON_KB) return truncated as Record<string, unknown>

  // Last resort — dropped if all truncation passes somehow couldn't shrink enough.
  return {
    message: `[Oversized Log Dropped] ${String((logObject as { message?: unknown }).message ?? '').slice(0, 200)}`,
    service: logObject.service,
    context: logObject.context,
    ip: logObject.ip,
    cloud_provider: logObject.cloud_provider,
  }
}

const getErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'message' in error && (error as { message?: unknown }).message) {
    return String((error as { message: unknown }).message).slice(0, 500)
  }
  if (typeof error === 'string') return error.slice(0, 500)
  return safeStringify(error).slice(0, 500) + ' (stringified error)'
}

// ── Transports ─────────────────────────────────────────────────────────────────
// Maps winston levels back to the NestJS-style labels the existing log files
// (and the `tail -f | jq` debugging workflow in CLAUDE.md) expect.
const LEVEL_LABEL: Record<string, string> = {
  info: 'LOG',
  error: 'ERROR',
  warn: 'WARN',
  debug: 'DEBUG',
  verbose: 'VERBOSE',
}

// File output preserves the exact {ts, level, context, msg} JSON-per-line shape
// the previous hand-rolled FileLogger produced (the CLAUDE.md `tail -f | jq`
// debugging workflow parses this shape). Pure + exported so it can be tested.
export const formatLogLine = (info: { level: string; message?: unknown; context?: string }): string =>
  JSON.stringify({
    ts: new Date().toISOString(),
    level: LEVEL_LABEL[info.level] ?? info.level.toUpperCase(),
    context: info.context ?? '',
    msg: info.message,
  })

const fileLineFormat = format.printf((info) => formatLogLine(info as { level: string; message?: unknown; context?: string }))

const fileTransport = new transports.DailyRotateFile({
  filename: 'app-%DATE%.log',
  dirname: LOG_DIR,
  datePattern: 'YYYY-MM-DD',
  maxFiles: '7d',
  level: 'verbose',
  auditFile: path.join(LOG_DIR, '.app-log-audit.json'),
  format: fileLineFormat,
})

// gRPC keepalive pings prevent NAT from silently expiring idle channels
// (channels go idle after 30 min with no traffic). Forwarded by google-gax for
// any key starting with "grpc." even though they're not in the TS types.
const gcloudLogging = new LoggingWinston({
  projectId: GOOGLE_CLOUD_PROJECT_ID,
  keyFile: GOOGLE_CLOUD_CREDENTIALS_PATH,
  keyFilename: GOOGLE_CLOUD_CREDENTIALS_PATH,
  serviceContext: { service: GOOGLE_CLOUD_SERVICE_CONTEXT ?? LOG_SERVICE_NAME },
  maxEntrySize: 250000,
  level: 'debug',
  // Non-fatal: a missing/invalid key file (e.g. local dev) must never crash the
  // app — the failure is logged to stderr and file logging continues.
  defaultCallback: (err: Error | null) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('[LOG] GCP write error:', err.message)
    }
  },
  'grpc.keepalive_time_ms': 60000,
  'grpc.keepalive_timeout_ms': 10000,
  'grpc.keepalive_permit_without_calls': 1,
} as LoggingWinstonOptions)

// A single winston logger shared by every WinstonLogger instance — avoids
// accumulating exception/rejection listeners on the shared file transport.
// No Console transport: output goes only to the rotating file + GCP.
const sharedWinstonLogger: Logger = createLogger({
  level: 'verbose',
  format: format.combine(format.errors({ stack: true })),
  transports: [fileTransport, gcloudLogging],
  exceptionHandlers: [fileTransport, gcloudLogging],
  rejectionHandlers: [fileTransport, gcloudLogging],
  exitOnError: false,
  handleExceptions: true,
  handleRejections: true,
})

sharedWinstonLogger.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('[LOG] logger error caught', error)
})

/**
 * NestJS LoggerService backed by winston. Writes to a daily-rotating file
 * (preserving the {ts,level,context,msg} format) and to GCP Cloud Logging.
 * Keeps the NestJS ConsoleLogger call signatures so all `new Logger(ctx)`
 * call sites work unchanged.
 */
export class WinstonLogger implements NestLoggerService {
  private readonly logger: Logger = sharedWinstonLogger
  private readonly serviceName: string
  private readonly ip: string | undefined

  constructor(serviceName: string = LOG_SERVICE_NAME) {
    this.serviceName = serviceName
    this.ip = serverIP
  }

  private buildInfo(message: unknown, context?: string, extra?: Record<string, unknown>): Record<string, unknown> {
    return reduceLogInfoSize({
      message,
      service: this.serviceName,
      context: context ?? '',
      cloud_provider: CLOUD_PROVIDER,
      ip: this.ip,
      ...extra,
    })
  }

  private safeWrite(level: string, message: unknown, context?: string, extra?: Record<string, unknown>): void {
    try {
      this.logger.log(level, { ...this.buildInfo(message, context, extra) })
    } catch {
      this.logger.log(level, {
        message,
        service: this.serviceName,
        context: context ?? '',
        ip: this.ip,
      })
    }
  }

  log(message: unknown, context?: string): void {
    this.safeWrite('info', message, context)
  }

  error(message: unknown, stack?: string, context?: string): void {
    // Stack appended to the message so Cloud Logging auto-detects it for Error Reporting.
    const text = getErrorMessage(message)
    const full = stack ? `${text}\n${stack}` : text
    this.safeWrite('error', full, context, { error_message: text })
  }

  warn(message: unknown, context?: string): void {
    this.safeWrite('warn', message, context)
  }

  debug(message: unknown, context?: string): void {
    this.safeWrite('debug', message, context)
  }

  verbose(message: unknown, context?: string): void {
    this.safeWrite('verbose', message, context)
  }
}
