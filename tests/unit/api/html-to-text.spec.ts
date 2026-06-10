/**
 * html-to-text.spec — unit tests for the email-sync HTML→plain-text converter
 * used by GraphProvider (Microsoft Graph delivers HTML-only bodies).
 *
 * Regression catalogue rows:
 *   R201 — htmlToText preserves line structure; the old naive tag-strip
 *          (`replace(/<[^>]*>/g,' ')` + collapse-all-whitespace) flattened the
 *          entire email (body + signature) onto a single line.
 */

import { describe, it, expect } from 'vitest'
import { htmlToText } from '../../../apps/api/src/modules/email-sync/util/html-to-text'

describe('R201 — htmlToText preserves line structure', () => {
  it('keeps body and signature lines separate (not one flattened line)', () => {
    const html =
      '<div dir="ltr"><div>Sakthi is Batman</div>' +
      '<div class="gmail_signature"><table><tbody>' +
      '<tr><td><h3>Vignesh</h3></td></tr>' +
      '<tr><td>PRODUCT ENGINEER</td></tr>' +
      '<tr><td><a href="mailto:v@tmr.com">v@tmr.com</a>  |  <a href="https://tmr.com/">tmr.com</a></td></tr>' +
      '</tbody></table></div></div>'
    const out = htmlToText(html)
    const lines = out.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]).toBe('Sakthi is Batman')
    expect(out).toContain('PRODUCT ENGINEER')
    // body text and signature role must not share a line
    expect(lines[0]).not.toContain('PRODUCT ENGINEER')
  })

  it('converts <br> and block-element ends to newlines', () => {
    expect(htmlToText('line one<br>line two<p>line three</p>')).toBe('line one\nline two\nline three')
  })

  it('decodes common entities', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot;&nbsp;&#39;snacks&#39;</p>'))
      .toBe('Tom & Jerry <3 "cheese" \'snacks\'')
  })

  it('drops style/script/head content entirely', () => {
    const out = htmlToText('<style>.a{color:red}</style><script>evil()</script><div>visible</div>')
    expect(out).toBe('visible')
  })

  it('collapses runs of blank lines to at most one', () => {
    const out = htmlToText('<div>a</div><div></div><div></div><div></div><div>b</div>')
    expect(out).toBe('a\n\nb')
  })

  it('returns empty string for empty/whitespace HTML', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText('<div>   </div>')).toBe('')
  })
})
