/**
 * Matches a real HTML tag from a known-tag allowlist. A generic `<letter…>` test
 * false-positives on email plain text, where Gmail renders hyperlinks as
 * `<https://example.com>` and addresses as `<user@example.com>`.
 */
const HTML_TAG_RE =
  /<\/?(?:a|b|i|u|em|strong|p|div|span|br|hr|img|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|blockquote|h[1-6]|font|center|pre|code|small|big|sub|sup|s|strike|html|body|head|style|script)(?:\s[^>]*)?\/?>/i

/** Returns true when a message body contains HTML markup (vs. plain text). */
export function isHtmlBody(body: string): boolean {
  return HTML_TAG_RE.test(body)
}

/**
 * Splits an email HTML body into the new content and the quoted reply history,
 * so threads don't repeat the full conversation in every message. Detaches
 * Gmail's `div.gmail_quote` wrapper and Apple Mail's `blockquote[type=cite]`.
 * Returns the original HTML untouched when nothing matches (or on the server,
 * where there's no DOM).
 */
export function splitQuotedHtml(html: string): { main: string; quoted: string | null } {
  if (typeof document === 'undefined') return { main: html, quoted: null }
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const quotedNodes = tmp.querySelectorAll('div.gmail_quote, blockquote[type="cite"]')
  if (quotedNodes.length === 0) return { main: html, quoted: null }
  const quotedParts: string[] = []
  quotedNodes.forEach((el) => {
    // Skip nodes nested inside another matched node — removing the outermost is enough
    if (el.parentElement?.closest('div.gmail_quote, blockquote[type="cite"]')) return
    quotedParts.push(el.outerHTML)
    el.remove()
  })
  const main = tmp.innerHTML
  // Don't strip the quote if that's all the message contained
  if (!tmp.textContent?.trim() && quotedParts.length) return { main: html, quoted: null }
  return { main, quoted: quotedParts.join('') || null }
}

/**
 * Strips script-execution vectors from inbound email HTML before it's rendered
 * via `dangerouslySetInnerHTML`. Shared between Portal and Bridge so both
 * render customer/agent message bodies through the same guard.
 */
export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') return html
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // Remove unsafe elements
  tmp.querySelectorAll('script, style, iframe, object, embed, form').forEach((el) => el.remove())
  // Remove event handler attributes and javascript: URLs from all elements
  tmp.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
      } else if (name === 'src' && el.tagName !== 'IMG') {
        el.removeAttribute(attr.name)
      } else if ((name === 'href' || name === 'src' || name === 'action') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    })
  })
  return tmp.innerHTML
}
