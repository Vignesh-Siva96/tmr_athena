/**
 * Converts an email HTML body to readable plain text, preserving line structure.
 * A bare tag-strip (`html.replace(/<[^>]*>/g, ' ')` + whitespace collapse) flattens
 * the whole email — body, signature, quoted history — onto one line; this keeps
 * block boundaries as newlines so the stored `Message.body` reads like the email.
 * No external dependency by design (see CLAUDE.md: never invent dependencies).
 */
export function htmlToText(html: string): string {
  let text = html
    // Drop non-content blocks entirely
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Line breaks for explicit breaks and block-level element boundaries
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|tr|li|h[1-6]|blockquote|pre|table|ul|ol)(\s[^>]*)?>/gi, '\n')
    // Strip all remaining tags
    .replace(/<[^>]+>/g, '')

  // Decode the entities that matter for email text
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')

  return text
    // Collapse horizontal whitespace only (incl. NBSP) — newlines carry the structure
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
