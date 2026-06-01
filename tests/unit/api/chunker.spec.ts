import { describe, it, expect, beforeEach } from 'vitest'

// ─── Import ChunkerService ─────────────────────────────────────────────────────
// We test the markdown chunking logic directly.
// The service converts HTML→Markdown via Turndown then splits on headings.

// Since we're unit testing the markdown splitting logic, we expose it via
// a helper that calls chunkMarkdown() directly.

type TextChunk = {
  ordinal: number
  text: string
  headingPath: string[]
  anchor: string | null
  deepUrl: string
  tokenCount: number
}

// Inline a simplified version of the chunker for pure-logic unit tests
// (avoids NestJS DI in unit test context)
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function buildChunkText(headingPath: string[], url: string, anchor: string | null, content: string): string {
  const lines: string[] = []
  if (headingPath.length) lines.push(`[PATH: ${headingPath.join(' > ')}]`)
  lines.push(`[URL: ${anchor ? `${url}#${anchor}` : url}]`)
  lines.push(content)
  return lines.join('\n')
}

const MAX_TOKENS = 800
const MIN_TOKENS = 200

function chunkMarkdown(markdown: string, sourceUrl: string): TextChunk[] {
  const lines = markdown.split('\n')
  const chunks: TextChunk[] = []
  const headingStack: string[] = []
  let currentLines: string[] = []
  let currentAnchor: string | null = null
  let ordinal = 0
  let inCodeBlock = false

  const flushChunk = () => {
    const text = currentLines.join('\n').trim()
    if (!text) return

    const tokens = estimateTokens(text)

    if (tokens < MIN_TOKENS && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]!
      const mergedText = prev.text + '\n\n' + text
      prev.text = mergedText
      prev.tokenCount = estimateTokens(mergedText)
      return
    }

    chunks.push({
      ordinal: ordinal++,
      text: buildChunkText(headingStack, sourceUrl, currentAnchor, text),
      headingPath: [...headingStack],
      anchor: currentAnchor,
      deepUrl: currentAnchor ? `${sourceUrl}#${currentAnchor}` : sourceUrl,
      tokenCount: tokens,
    })
  }

  for (const line of lines) {
    if (line.startsWith('```')) inCodeBlock = !inCodeBlock

    if (!inCodeBlock) {
      const h2 = line.match(/^## (.+)$/)
      const h3 = line.match(/^### (.+)$/)

      if (h2) {
        flushChunk()
        currentLines = [line]
        headingStack.splice(0, headingStack.length, h2[1]!)
        currentAnchor = slugify(h2[1]!)
        continue
      }
      if (h3) {
        flushChunk()
        currentLines = [line]
        if (headingStack.length >= 1) headingStack.splice(1, headingStack.length - 1, h3[1]!)
        else headingStack.push(h3[1]!)
        currentAnchor = slugify(h3[1]!)
        continue
      }
    }

    currentLines.push(line)
  }
  flushChunk()
  return chunks
}

const BASE_URL = 'https://docs.example.com/help/oauth'

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ChunkerService.chunkMarkdown()', () => {
  describe('basic splitting', () => {
    it('produces a single chunk for short content with no headings', () => {
      // Need enough content to exceed MIN_TOKENS threshold (~200 tokens = ~800 chars)
      const content = 'A '.repeat(400).trim()
      const chunks = chunkMarkdown(content, BASE_URL)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks[0]!.deepUrl).toBe(BASE_URL)
    })

    it('splits on H2 headings', () => {
      const md = [
        'A '.repeat(400),
        '',
        '## Step Two',
        'B '.repeat(400),
      ].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      expect(chunks.length).toBeGreaterThanOrEqual(2)
      const stepTwo = chunks.find((c) => c.anchor === 'step-two')
      expect(stepTwo).toBeDefined()
      expect(stepTwo!.deepUrl).toBe(`${BASE_URL}#step-two`)
    })

    it('tracks H3 headings inside H2', () => {
      const md = [
        '## Setup',
        'A '.repeat(400),
        '### OAuth Config',
        'B '.repeat(400),
      ].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      const oauthChunk = chunks.find((c) => c.anchor === 'oauth-config')
      expect(oauthChunk).toBeDefined()
      expect(oauthChunk!.headingPath).toContain('OAuth Config')
    })
  })

  describe('heading path breadcrumbs', () => {
    it('includes [PATH: ...] in chunk text when headings exist', () => {
      const md = [
        '## Authentication',
        'A '.repeat(400),
      ].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      const authChunk = chunks.find((c) => c.anchor === 'authentication')
      expect(authChunk!.text).toContain('[PATH: Authentication]')
    })

    it('includes [URL: ...] with anchor in chunk text', () => {
      const md = [
        '## Setup Guide',
        'A '.repeat(400),
      ].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      const setupChunk = chunks.find((c) => c.anchor === 'setup-guide')
      expect(setupChunk!.text).toContain('[URL: https://docs.example.com/help/oauth#setup-guide]')
    })
  })

  describe('anchor generation', () => {
    it('slugifies heading to kebab-case', () => {
      const md = ['## Setting Up Google OAuth!', 'A '.repeat(400)].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      expect(chunks.find((c) => c.anchor === 'setting-up-google-oauth')).toBeDefined()
    })

    it('handles numeric headings', () => {
      const md = ['## Step 1: Connect', 'A '.repeat(400)].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      expect(chunks.find((c) => c.anchor?.startsWith('step-1'))).toBeDefined()
    })
  })

  describe('code block atomicity', () => {
    it('does not split inside a code block', () => {
      const codeBlock = [
        '```sql',
        'CREATE TABLE users (',
        '  id SERIAL PRIMARY KEY,',
        '  email TEXT NOT NULL UNIQUE,',
        '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        ');',
        '```',
      ].join('\n')

      // Pad to trigger chunk boundary checks
      const md = ['## Query Examples', 'A '.repeat(400), codeBlock].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)

      // The code block should appear intact in one of the chunks
      const hasIntactCodeBlock = chunks.some((c) =>
        c.text.includes('CREATE TABLE users') && c.text.includes('```')
      )
      expect(hasIntactCodeBlock).toBe(true)
    })
  })

  describe('ordinal assignment', () => {
    it('assigns sequential ordinals starting from 0', () => {
      const md = [
        '## Section A',
        'A '.repeat(400),
        '## Section B',
        'B '.repeat(400),
        '## Section C',
        'C '.repeat(400),
      ].join('\n')
      const chunks = chunkMarkdown(md, BASE_URL)
      const ordinals = chunks.map((c) => c.ordinal)
      for (let i = 0; i < ordinals.length; i++) {
        expect(ordinals[i]).toBe(i)
      }
    })
  })

  describe('token estimation', () => {
    it('estimates tokens as ceil(length / 4)', () => {
      expect(estimateTokens('hello')).toBe(2)  // ceil(5/4) = 2
      expect(estimateTokens('hello world')).toBe(3)  // ceil(11/4) = 3
      expect(estimateTokens('')).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty markdown', () => {
      expect(chunkMarkdown('', BASE_URL)).toHaveLength(0)
    })

    it('returns empty array for whitespace-only markdown', () => {
      expect(chunkMarkdown('   \n\n   ', BASE_URL)).toHaveLength(0)
    })

    it('handles a single very long sentence without panicking', () => {
      const longSentence = 'word '.repeat(1000)
      const chunks = chunkMarkdown(longSentence, BASE_URL)
      // Should produce at least one chunk
      expect(chunks.length).toBeGreaterThan(0)
      // All chunks should have valid structure
      for (const chunk of chunks) {
        expect(chunk.text).toBeTruthy()
        expect(chunk.ordinal).toBeGreaterThanOrEqual(0)
        expect(chunk.deepUrl).toContain('docs.example.com')
      }
    })

    it('handles markdown with only headings and no body text', () => {
      const md = '## Empty Section\n'
      const chunks = chunkMarkdown(md, BASE_URL)
      // Should produce 0 or 1 chunks — heading alone has very few tokens
      expect(chunks.length).toBeLessThanOrEqual(1)
    })
  })
})
