/**
 * sanitize-html.spec — unit tests for shared XSS sanitization helper (T1.4).
 *
 * Vitest auto-applies the `jsdom` environment for files under tests/unit/portal/
 * so `document.createElement` is available.
 *
 * Regression catalogue rows:
 *   R186 — sanitizeHtml strips <script>, onerror=, javascript: href/src/action
 *   R199 — isHtmlBody treats Gmail plain-text autolinks (<https://…>, <user@host>) as text
 *   R200 — splitQuotedHtml detaches gmail_quote / blockquote[type=cite] reply history
 */

import { describe, it, expect } from 'vitest'
import { sanitizeHtml, isHtmlBody, splitQuotedHtml } from '../../../packages/ui/src/sanitize'

// ─── R186 — sanitizeHtml XSS stripping ───────────────────────────────────────

describe('R186 — sanitizeHtml strips script-execution vectors', () => {
  it('removes <script> tags and their content', () => {
    const out = sanitizeHtml('<p>Hello</p><script>alert(1)</script><p>World</p>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('Hello')
    expect(out).toContain('World')
  })

  it('removes onerror= event handler attributes', () => {
    const out = sanitizeHtml('<img src="x.png" onerror="alert(1)">')
    expect(out).not.toContain('onerror')
  })

  it('removes onclick= and other on* event attributes', () => {
    const out = sanitizeHtml('<div onclick="evil()">click me</div>')
    expect(out).not.toContain('onclick')
    expect(out).toContain('click me')
  })

  it('removes javascript: href', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">link</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('link')
  })

  it('removes javascript: src', () => {
    const out = sanitizeHtml('<img src="javascript:alert(1)">')
    expect(out).not.toContain('javascript:')
  })

  it('removes javascript: action on form', () => {
    const out = sanitizeHtml('<form action="javascript:evil()">x</form>')
    expect(out).not.toContain('javascript:')
  })

  it('removes <iframe> elements', () => {
    const out = sanitizeHtml('<p>text</p><iframe src="https://evil.com"></iframe>')
    expect(out).not.toContain('<iframe')
    expect(out).toContain('text')
  })

  it('preserves safe anchor href', () => {
    const out = sanitizeHtml('<a href="https://example.com">safe link</a>')
    expect(out).toContain('https://example.com')
    expect(out).toContain('safe link')
  })

  it('preserves img src', () => {
    const out = sanitizeHtml('<img src="https://example.com/photo.jpg" alt="photo">')
    expect(out).toContain('src')
    expect(out).toContain('photo.jpg')
  })

  it('preserves plain text content', () => {
    const input = '<p>Hello <strong>world</strong>!</p>'
    const out = sanitizeHtml(input)
    expect(out).toContain('Hello')
    expect(out).toContain('world')
  })
})

// ─── R199 — isHtmlBody must not misdetect plain-text autolinks ───────────────

describe('R199 — isHtmlBody treats Gmail plain-text autolinks as text', () => {
  it('returns false for Gmail plain text with <https://…> autolink', () => {
    // Gmail renders hyperlinks in the text/plain MIME part as <url>; the old
    // /<[a-z][\s\S]*>/ regex matched this, so the body was pushed through
    // dangerouslySetInnerHTML and its newlines collapsed onto one line.
    const gmailPlainText =
      'Sakthi is Batman\n\nVignesh\nPRODUCT ENGINEER\nvignesh.s@twominutereports.com  |   twominutereports.com\n<https://twominutereports.com/>\n'
    expect(isHtmlBody(gmailPlainText)).toBe(false)
  })

  it('returns false for plain text with <user@host> address brackets', () => {
    expect(isHtmlBody('Forwarded from John Doe <john@example.com>\nHello there')).toBe(false)
  })

  it('returns true for real HTML markup', () => {
    expect(isHtmlBody('<div dir="ltr"><div>Hello</div></div>')).toBe(true)
    expect(isHtmlBody('Hi<br>there')).toBe(true)
    expect(isHtmlBody('<table cellpadding="0"><tr><td>sig</td></tr></table>')).toBe(true)
    expect(isHtmlBody('<p>paragraph</p>')).toBe(true)
  })

  it('returns false for plain text without markup', () => {
    expect(isHtmlBody('Just a normal sentence with 2 < 3 math.')).toBe(false)
  })
})

// ─── R200 — splitQuotedHtml separates quoted reply history ───────────────────

describe('R200 — splitQuotedHtml detaches quoted reply history', () => {
  it('splits Gmail gmail_quote wrapper from the new content', () => {
    const html =
      '<div dir="ltr">New reply text</div>' +
      '<div class="gmail_quote">On Mon, Jun 8 wrote:<blockquote>old message</blockquote></div>'
    const { main, quoted } = splitQuotedHtml(html)
    expect(main).toContain('New reply text')
    expect(main).not.toContain('old message')
    expect(quoted).toContain('old message')
  })

  it('splits Apple Mail blockquote[type=cite]', () => {
    const html = '<div>Thanks!</div><blockquote type="cite"><p>previous email</p></blockquote>'
    const { main, quoted } = splitQuotedHtml(html)
    expect(main).toContain('Thanks!')
    expect(main).not.toContain('previous email')
    expect(quoted).toContain('previous email')
  })

  it('returns quoted: null when there is no quote', () => {
    const html = '<div dir="ltr"><div>Sakthi is Batman</div><table><tr><td>signature</td></tr></table></div>'
    const { main, quoted } = splitQuotedHtml(html)
    expect(main).toBe(html)
    expect(quoted).toBeNull()
  })

  it('keeps the body intact when the message is ONLY a quote', () => {
    const html = '<div class="gmail_quote">just forwarded content</div>'
    const { main, quoted } = splitQuotedHtml(html)
    expect(main).toContain('just forwarded content')
    expect(quoted).toBeNull()
  })

  it('does not double-extract nested gmail_quote blocks', () => {
    const html =
      '<div>reply</div>' +
      '<div class="gmail_quote">level1<div class="gmail_quote">level2</div></div>'
    const { quoted } = splitQuotedHtml(html)
    expect(quoted).toContain('level1')
    // nested level2 appears once (inside level1), not extracted a second time
    expect(quoted?.match(/level2/g)?.length).toBe(1)
  })
})
