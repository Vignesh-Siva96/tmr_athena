/**
 * Unit tests for the file-transport line formatter of WinstonLogger.
 *
 * The {ts, level, context, msg} JSON-per-line shape is a contract: the CLAUDE.md
 * debugging workflow tails the log and parses it with
 *   jq -r '"\(.ts) [\(.level)] \(.context): \(.msg)"'
 * so a drift in keys/levels silently breaks that command.
 *
 * Regression catalogue:
 *   R253 — logger file format: emits {ts,level,context,msg} with NestJS-style level labels
 */

import { describe, it, expect } from 'vitest'
import { formatLogLine } from '../../../apps/api/src/common/logger/logger.service'

describe('formatLogLine', () => {
  it('emits exactly the {ts, level, context, msg} keys the jq workflow parses', () => {
    const parsed = JSON.parse(formatLogLine({ level: 'info', message: 'hello', context: 'Bootstrap' }))
    expect(Object.keys(parsed).sort()).toEqual(['context', 'level', 'msg', 'ts'])
    expect(parsed.context).toBe('Bootstrap')
    expect(parsed.msg).toBe('hello')
    expect(typeof parsed.ts).toBe('string')
    expect(() => new Date(parsed.ts as string).toISOString()).not.toThrow()
  })

  it('maps winston levels to the NestJS-style uppercase labels', () => {
    expect(JSON.parse(formatLogLine({ level: 'info', message: 'm' })).level).toBe('LOG')
    expect(JSON.parse(formatLogLine({ level: 'error', message: 'm' })).level).toBe('ERROR')
    expect(JSON.parse(formatLogLine({ level: 'warn', message: 'm' })).level).toBe('WARN')
    expect(JSON.parse(formatLogLine({ level: 'debug', message: 'm' })).level).toBe('DEBUG')
    expect(JSON.parse(formatLogLine({ level: 'verbose', message: 'm' })).level).toBe('VERBOSE')
  })

  it('defaults missing context to an empty string (never undefined)', () => {
    const parsed = JSON.parse(formatLogLine({ level: 'info', message: 'm' }))
    expect(parsed.context).toBe('')
  })
})
