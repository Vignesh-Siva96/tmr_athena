import { Injectable } from '@nestjs/common'
import TurndownService from 'turndown'
import * as cheerio from 'cheerio'

export interface TextChunk {
  ordinal: number
  text: string
  headingPath: string[]
  anchor: string | null
  deepUrl: string
  tokenCount: number
}

const MIN_TOKENS = 100
const MAX_TOKENS = 350

@Injectable()
export class ChunkerService {
  private readonly turndown: TurndownService

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })
  }

  chunk(html: string, sourceUrl: string): TextChunk[] {
    // Remove non-content elements before conversion
    const $ = cheerio.load(html)
    $('nav, footer, header, script, style, aside').remove()
    const cleanHtml = $('body').html() ?? html

    const markdown = this.turndown.turndown(cleanHtml)
    const lines = markdown.split('\n')

    // Split into raw sections at H2/H3 boundaries
    interface RawSection {
      headingPath: string[]
      anchor: string | null
      lines: string[]
    }

    const sections: RawSection[] = []
    let currentHeadingPath: string[] = []
    let currentLines: string[] = []
    let currentAnchor: string | null = null

    for (const line of lines) {
      const h2Match = /^## (.+)$/.exec(line)
      const h3Match = /^### (.+)$/.exec(line)

      if (h2Match) {
        if (currentLines.some((l) => l.trim())) {
          sections.push({
            headingPath: [...currentHeadingPath],
            anchor: currentAnchor,
            lines: [...currentLines],
          })
        }
        const headingText = h2Match[1].trim()
        currentHeadingPath = [headingText]
        currentAnchor = slugify(headingText)
        currentLines = [line]
      } else if (h3Match) {
        if (currentLines.some((l) => l.trim())) {
          sections.push({
            headingPath: [...currentHeadingPath],
            anchor: currentAnchor,
            lines: [...currentLines],
          })
        }
        const headingText = h3Match[1].trim()
        // Keep H2 in path if exists, replace H3 level
        currentHeadingPath = currentHeadingPath.length > 0
          ? [currentHeadingPath[0], headingText]
          : [headingText]
        currentAnchor = slugify(headingText)
        currentLines = [line]
      } else {
        currentLines.push(line)
      }
    }

    // Push the last section
    if (currentLines.some((l) => l.trim())) {
      sections.push({
        headingPath: [...currentHeadingPath],
        anchor: currentAnchor,
        lines: [...currentLines],
      })
    }

    // Convert sections to chunks, applying merge/split rules
    const rawChunks: Array<{ headingPath: string[]; anchor: string | null; text: string }> = []

    for (const section of sections) {
      const text = section.lines.join('\n').trim()
      if (!text) continue
      rawChunks.push({
        headingPath: section.headingPath,
        anchor: section.anchor,
        text,
      })
    }

    // Merge small chunks into previous sibling
    const merged: typeof rawChunks = []
    for (const chunk of rawChunks) {
      if (
        merged.length > 0 &&
        this.estimateTokens(chunk.text) < MIN_TOKENS
      ) {
        const prev = merged[merged.length - 1]
        prev.text = prev.text + '\n\n' + chunk.text
      } else {
        merged.push({ ...chunk })
      }
    }

    // Split large chunks at paragraph boundaries (respecting code blocks)
    const final: Array<{ headingPath: string[]; anchor: string | null; text: string }> = []
    for (const chunk of merged) {
      if (this.estimateTokens(chunk.text) <= MAX_TOKENS) {
        final.push(chunk)
        continue
      }
      const splits = this.splitAtParagraphs(chunk.text)
      for (const split of splits) {
        final.push({
          headingPath: chunk.headingPath,
          anchor: chunk.anchor,
          text: split,
        })
      }
    }

    // Build TextChunk array with deepUrl and ordinal
    return final.map((c, i) => {
      const deepUrl = c.anchor ? `${sourceUrl}#${c.anchor}` : sourceUrl
      const pathLabel = c.headingPath.join(' > ')
      const prefix = pathLabel ? `[PATH: ${pathLabel}][URL: ${deepUrl}]\n` : `[URL: ${deepUrl}]\n`
      const text = prefix + c.text
      return {
        ordinal: i,
        text,
        headingPath: c.headingPath,
        anchor: c.anchor,
        deepUrl,
        tokenCount: this.estimateTokens(text),
      }
    })
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  private splitAtParagraphs(text: string): string[] {
    const paragraphs = text.split(/\n\n+/)
    const chunks: string[] = []
    let current = ''
    let inCodeBlock = false

    for (const para of paragraphs) {
      // Track code block state
      const codeBlockToggleCount = (para.match(/^```/gm) ?? []).length
      const wouldToggle = codeBlockToggleCount % 2 !== 0

      const combined = current ? current + '\n\n' + para : para

      if (inCodeBlock) {
        // Never split mid-code-block — always append
        current = combined
        if (wouldToggle) inCodeBlock = false
        continue
      }

      if (wouldToggle) {
        // Opening a code block — must keep until it closes
        current = combined
        inCodeBlock = true
        continue
      }

      if (this.estimateTokens(combined) > MAX_TOKENS && current) {
        chunks.push(current.trim())
        current = para
      } else {
        current = combined
      }
    }

    if (current.trim()) chunks.push(current.trim())
    return chunks.length > 0 ? chunks : [text]
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
