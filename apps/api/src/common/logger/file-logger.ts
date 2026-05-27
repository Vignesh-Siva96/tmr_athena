import { ConsoleLogger, LogLevel } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

const LOG_DIR = path.join(process.cwd(), 'logs')

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

function todayFile(): string {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return path.join(LOG_DIR, `app-${date}.log`)
}

let currentFile = ''
let stream: fs.WriteStream | null = null

function getStream(): fs.WriteStream {
  const file = todayFile()
  if (file !== currentFile || !stream) {
    stream?.end()
    ensureLogDir()
    stream = fs.createWriteStream(file, { flags: 'a' })
    currentFile = file
  }
  return stream
}

function writeLine(level: string, context: string, message: string): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      context,
      msg: message,
    }) + '\n'
    getStream().write(line)
  } catch {
    // never crash the app over a log write
  }
}

export class FileLogger extends ConsoleLogger {
  log(message: string, context?: string): void {
    super.log(message, context)
    writeLine('LOG', context ?? this.context ?? '', message)
  }

  error(message: string, stack?: string, context?: string): void {
    super.error(message, stack, context)
    writeLine('ERROR', context ?? this.context ?? '', stack ? `${message}\n${stack}` : message)
  }

  warn(message: string, context?: string): void {
    super.warn(message, context)
    writeLine('WARN', context ?? this.context ?? '', message)
  }

  debug(message: string, context?: string): void {
    super.debug(message, context)
    writeLine('DEBUG', context ?? this.context ?? '', message)
  }

  verbose(message: string, context?: string): void {
    super.verbose(message, context)
    writeLine('VERBOSE', context ?? this.context ?? '', message)
  }
}
