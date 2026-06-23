/**
 * Backfill script — run once against the DB to populate `Attachment.objectKey` for rows
 * created before the column existed. The key is recovered from the stored presigned `url`
 * using the same path-parsing logic as FilesService (`/<bucket>/<objectName>`).
 *
 * Link attachments (isLink=true) have no object and are skipped.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-attachment-keys.ts
 *   pnpm tsx scripts/backfill-attachment-keys.ts --dry-run
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DRY_RUN = process.argv.slice(2).includes('--dry-run')

const BUCKET = process.env.S3_BUCKET ?? 'tmr-support'

/** Recover the object key from a presigned (or plain) object URL — mirrors FilesService.objectNameFromUrl. */
function objectNameFromUrl(url: string): string | null {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '')
    return pathname.startsWith(`${BUCKET}/`) ? pathname.slice(BUCKET.length + 1) : pathname
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const rows = await db.attachment.findMany({
    where: { objectKey: null, isLink: false },
    select: { id: true, url: true, filename: true },
  })
  console.log(`Found ${rows.length} attachment(s) needing objectKey${DRY_RUN ? ' (dry-run)' : ''}`)

  let updated = 0
  let skipped = 0
  for (const row of rows) {
    const key = objectNameFromUrl(row.url)
    if (!key) {
      console.warn(`  ! skip ${row.id} (${row.filename}) — could not parse key from url`)
      skipped++
      continue
    }
    console.log(`  ${DRY_RUN ? 'would set' : 'set'} ${row.id} → objectKey=${key}`)
    if (!DRY_RUN) {
      await db.attachment.update({ where: { id: row.id }, data: { objectKey: key } })
    }
    updated++
  }
  console.log(`Done. ${updated} ${DRY_RUN ? 'would be ' : ''}updated, ${skipped} skipped.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
