/**
 * strip-inline-markdown.spec — unit tests for the heading-text sanitizer.
 *
 * Regression guard for the bot "Learn more" link bug: Turndown converts
 * anchor-linked HTML headings into markdown links (`[Prerequisites](#prereq)`),
 * which previously leaked into the heading-path label and produced a doubled
 * slug (`prerequisites-prerequisites`). stripInlineMarkdown removes that so both
 * the label and the derived anchor stay clean.
 */
import { describe, it, expect } from 'vitest'
import { stripInlineMarkdown } from '../../../apps/api/src/modules/knowledge-base/chunker.service'

// Mirror of the chunker's private slugify, to assert the resulting anchor is clean.
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

describe('stripInlineMarkdown', () => {
  it('reduces an anchor-linked heading to its plain label', () => {
    expect(stripInlineMarkdown('[Prerequisites](#prerequisites)')).toBe('Prerequisites')
  })

  it('yields a clean (non-doubled) anchor when slugified', () => {
    const clean = slugify(stripInlineMarkdown('[Prerequisites](#prerequisites)'))
    expect(clean).toBe('prerequisites')
    expect(clean).not.toBe('prerequisites-prerequisites')
  })

  it('strips bold, italic, code and stray hashes', () => {
    expect(stripInlineMarkdown('**Setup** _guide_')).toBe('Setup guide')
    expect(stripInlineMarkdown('`Config`')).toBe('Config')
    expect(stripInlineMarkdown('### Heading')).toBe('Heading')
  })

  it('leaves plain heading text untouched', () => {
    expect(stripInlineMarkdown('Connecting Amazon Ads')).toBe('Connecting Amazon Ads')
  })
})
