import { FullConfig } from '@playwright/test'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const STATE_FILE = resolve(__dirname, '../..', '.playwright-state.json')

export default async function globalTeardown(_: FullConfig): Promise<void> {
  if (!existsSync(STATE_FILE)) return
  const { pgId, minioId } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
    pgId: string
    minioId: string
  }
  try { execSync(`docker stop ${pgId}`, { stdio: 'ignore' }) } catch {}
  try { execSync(`docker stop ${minioId}`, { stdio: 'ignore' }) } catch {}
  unlinkSync(STATE_FILE)
}
