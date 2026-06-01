import { Injectable } from '@nestjs/common'

/**
 * Converts a small subset of Markdown (bold, italic, links, bullet lists,
 * inline code) to sanitized HTML.
 *
 * Deliberately avoids ESM-only unified/rehype packages which are incompatible
 * with the API's CommonJS module target.
 */
@Injectable()
export class MarkdownService {
  render(markdown: string): string {
    const lines = markdown.split('\n')
    const out: string[] = []
    let inList = false

    for (const raw of lines) {
      const line = raw

      // Bullet list items (- or *)
      const bulletMatch = /^[\s]*[-*]\s+(.+)$/.exec(line)
      if (bulletMatch) {
        if (!inList) { out.push('<ul>'); inList = true }
        out.push(`<li>${this.inline(bulletMatch[1]!)}</li>`)
        continue
      }

      // Close open list before any non-bullet line
      if (inList) { out.push('</ul>'); inList = false }

      // Empty line → paragraph break (skip)
      if (line.trim() === '') { out.push(''); continue }

      // Headings (## / ###)
      const h3 = /^###\s+(.+)$/.exec(line)
      if (h3) { out.push(`<h3>${this.inline(h3[1]!)}</h3>`); continue }
      const h2 = /^##\s+(.+)$/.exec(line)
      if (h2) { out.push(`<h2>${this.inline(h2[1]!)}</h2>`); continue }
      const h1 = /^#\s+(.+)$/.exec(line)
      if (h1) { out.push(`<h1>${this.inline(h1[1]!)}</h1>`); continue }

      // Normal paragraph line
      out.push(`<p>${this.inline(line)}</p>`)
    }

    if (inList) out.push('</ul>')
    return out.join('\n')
  }

  private inline(text: string): string {
    // Escape raw HTML entities first
    let s = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')

    // Bold (**text** or __text__)
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/__(.+?)__/g, '<strong>$1</strong>')

    // Italic (*text* or _text_)
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
    s = s.replace(/_(.+?)_/g, '<em>$1</em>')

    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')

    return s
  }
}
