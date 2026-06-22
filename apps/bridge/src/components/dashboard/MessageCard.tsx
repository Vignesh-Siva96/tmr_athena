'use client'
import { useState } from 'react'
import { Github, Lock, CornerUpLeft, Sparkles } from 'lucide-react'
import { sanitizeHtml, isHtmlBody, splitQuotedHtml } from '@tmr/ui/sanitize'

type MessageType = 'REPLY' | 'INTERNAL_NOTE' | 'SYSTEM_EVENT'

interface Author { id: string; name: string | null; email: string; avatarUrl: string | null }
interface Attachment { id: string; filename: string; size: number; url: string; isLink: boolean }

interface MessageCardProps {
  id: string
  type: MessageType
  body: string
  bodyHtml?: string | null
  isInternal: boolean
  authorUser?: Author | null
  authorAgent?: Author | null
  authorBotName?: string | null
  attachments: Attachment[]
  createdAt: string
  cc?: string[]
  supportEmail?: string
  isLast?: boolean
  onReply?: () => void
  onNote?: () => void
}

function initials(name: string | null, email: string): string {
  if (name) {
    const p = name.trim().split(' ')
    return p.length >= 2 ? `${p[0]![0]}${p[1]![0]}`.toUpperCase() : p[0]!.slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parseEvent(body: string): string {
  if (body.startsWith('status_changed:')) { const [, f, t] = body.split(':'); return `Status changed ${f} → ${t}` }
  if (body.startsWith('github_linked:')) return `Linked to GitHub issue ${body.slice('github_linked:'.length)}`
  if (body.startsWith('assigned:')) { const w = body.slice('assigned:'.length); return w === 'unassigned' ? 'Ticket unassigned' : 'Ticket assigned' }
  if (body === 'tags_changed') return 'Tags updated'
  if (body.startsWith('escalated:')) return `Escalated to human — ${body.slice('escalated:'.length)}`
  if (body.startsWith('email_delivery_failed:')) return `⚠ Email delivery failed — ${body.slice('email_delivery_failed:'.length)}`
  return body
}

function splitQuoted(body: string): { main: string; quoted: string | null } {
  const quoteHeaderRe = /\n(On .{10,200}wrote:\s*\n[\s\S]*)$/
  const headerMatch = body.match(quoteHeaderRe)
  if (headerMatch) {
    const idx = body.lastIndexOf(headerMatch[1]!)
    const main = body.slice(0, idx).trimEnd()
    if (main.length > 0) return { main, quoted: headerMatch[1]! }
  }
  const lines = body.split('\n')
  let firstQuoteLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trimStart().startsWith('>')) { firstQuoteLine = i; break }
  }
  if (firstQuoteLine > 0) {
    return { main: lines.slice(0, firstQuoteLine).join('\n').trimEnd(), quoted: lines.slice(firstQuoteLine).join('\n') }
  }
  const sigIdx = body.search(/\n--\s*\n/)
  if (sigIdx > 0) return { main: body.slice(0, sigIdx).trimEnd(), quoted: body.slice(sigIdx + 1).trimEnd() }
  return { main: body, quoted: null }
}

function QuoteToggle({ quoteText, isHtml }: { quoteText: string; isHtml?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const quoteStyle = { marginTop: 8, padding: '10px 14px', borderLeft: '3px solid var(--d-border)', borderRadius: '0 4px 4px 0', fontSize: 13, color: 'var(--d-text-4)', lineHeight: 1.6 } as const
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setExpanded((e) => !e)}
        style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 10px', borderRadius: 4, background: 'var(--d-raised)', border: '1px solid var(--d-border)', fontSize: 13, color: 'var(--d-text-4)', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.12em', lineHeight: '22px' }}>
        {expanded ? '▴ Hide quoted text' : '···'}
      </button>
      {expanded && (
        isHtml
          ? <div className="msg-html" style={quoteStyle} dangerouslySetInnerHTML={{ __html: quoteText }} />
          : <div style={{ ...quoteStyle, whiteSpace: 'pre-wrap' }}>{quoteText}</div>
      )}
    </div>
  )
}

/** Email body block: prefers the HTML part (quoted history collapsed), falls back to plain text. */
function MessageBody({ body, bodyHtml, color }: { body: string; bodyHtml?: string | null; color: string }) {
  if (bodyHtml) {
    const { main, quoted } = splitQuotedHtml(sanitizeHtml(bodyHtml))
    return (
      <>
        <div className="msg-html" style={{ fontSize: 14, lineHeight: 1.7, color }} dangerouslySetInnerHTML={{ __html: main }} />
        {quoted && <QuoteToggle quoteText={quoted} isHtml />}
      </>
    )
  }
  const { main, quoted } = splitQuoted(body)
  return (
    <>
      {isHtmlBody(main)
        ? <div className="msg-html" style={{ fontSize: 14, lineHeight: 1.7, color }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(main) }} />
        : <p style={{ fontSize: 14, lineHeight: 1.7, color, margin: 0, whiteSpace: 'pre-wrap' }}>{main}</p>
      }
      {quoted && <QuoteToggle quoteText={quoted} />}
    </>
  )
}

function ReplyActions({ onReply, onNote }: { onReply?: () => void; onNote?: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '8px 14px 12px', borderTop: '1px solid var(--d-border-2)', marginTop: 2 }}>
      {onReply && (
        <button type="button" onClick={onReply}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 12px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          <CornerUpLeft size={12} /> Reply
        </button>
      )}
      {onNote && (
        <button type="button" onClick={onNote}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 12px', background: 'transparent', border: '1px solid var(--d-border)', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'var(--d-text-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
          <Lock size={11} /> Note
        </button>
      )}
    </div>
  )
}

export function MessageCard({ id, type, body, bodyHtml, isInternal, authorUser, authorAgent, authorBotName, attachments, createdAt, cc, supportEmail, isLast, onReply, onNote }: MessageCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  // Bot-generated reply — render with Sparkles avatar + AI badge
  if (authorBotName && type === 'REPLY' && !isInternal) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
          <Sparkles size={16} />
        </div>
        <div style={{ flex: 1, background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid var(--d-border-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)' }}>{authorBotName}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.08)' }}>
                <Sparkles size={8} /> AI
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0, marginLeft: 12 }}>{fmtDate(createdAt)}</span>
          </div>
          <div data-testid="message-body" style={{ padding: '12px 14px' }}>
            <MessageBody body={body} bodyHtml={bodyHtml} color="var(--d-text-2)" />
          </div>
          {isLast && <ReplyActions onReply={onReply} onNote={onNote} />}
        </div>
      </div>
    )
  }

  if (type === 'SYSTEM_EVENT') {
    return (
      <div key={id} style={{ textAlign: 'center', padding: '4px 0' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--d-text-4)', padding: '4px 12px', borderRadius: 999, background: 'var(--d-raised)', border: '1px solid var(--d-border-2)' }}>
          {body.includes('github') && <Github size={11} />}
          {parseEvent(body)}
        </span>
      </div>
    )
  }

  if (isInternal || type === 'INTERNAL_NOTE') {
    const author = authorAgent ?? authorUser
    if (!author) return null

    if (collapsed) {
      return (
        <CollapsedRow avatarBg="#92400E" avatarColor="#FDE68A"
          authorLabel={author.name ?? author.email} snippet={body} createdAt={createdAt} onExpand={() => setCollapsed(false)} />
      )
    }

    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#92400E', color: '#FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
          {initials(author.name, author.email)}
        </div>
        <div style={{ flex: 1, background: 'var(--d-note-bg)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, overflow: 'hidden' }}>
          <div onClick={() => setCollapsed(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid rgba(245,158,11,0.15)', cursor: 'pointer', userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-note-text)' }}>{author.name ?? author.email}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', flexShrink: 0 }}>
                <Lock size={9} /> INTERNAL NOTE
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0, marginLeft: 12 }}>{fmtDate(createdAt)}</span>
          </div>
          <div data-testid="message-body" style={{ padding: '12px 14px' }}>
            {isHtmlBody(body)
              ? <div className="msg-html" style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--d-note-text)' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }} />
              : <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--d-note-text)', margin: 0, whiteSpace: 'pre-wrap' }}>{body}</p>
            }
          </div>
          {isLast && <ReplyActions onReply={onReply} onNote={onNote} />}
        </div>
      </div>
    )
  }

  // REPLY — customer or agent
  const isFromAgent = !!authorAgent
  const author = authorAgent ?? authorUser
  if (!author) return null

  const avatarBg = isFromAgent ? 'var(--d-success)' : 'var(--d-accent)'
  const toLine = isFromAgent
    ? `to ${authorUser?.email ?? 'customer'}`
    : `to ${supportEmail ?? 'support'}`

  if (collapsed) {
    return (
      <CollapsedRow avatarBg={avatarBg} avatarColor="#fff"
        authorLabel={`${author.name ?? author.email} — ${toLine}`} snippet={body} createdAt={createdAt} onExpand={() => setCollapsed(false)} />
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
        {initials(author.name, author.email)}
      </div>
      <div style={{ flex: 1, background: 'var(--d-surface)', border: '1px solid var(--d-border)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <div onClick={() => setCollapsed(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid var(--d-border-2)', cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text)' }}>{author.name ?? author.email}</span>
            <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>&lt;{author.email}&gt;</span>
            <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>{toLine}</span>
            {cc && cc.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--d-text-4)' }}>cc: {cc.join(', ')}</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0, marginLeft: 12 }}>{fmtDate(createdAt)}</span>
        </div>
        <div data-testid="message-body" style={{ padding: '12px 14px' }}>
          <MessageBody body={body} bodyHtml={bodyHtml} color="var(--d-text-2)" />
        </div>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 14px 12px' }}>
            {attachments.map((att) => (
              <a key={att.id} href={att.url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--d-border)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--d-text-3)', textDecoration: 'none', background: 'var(--d-raised)' }}>
                📎 {att.filename}
              </a>
            ))}
          </div>
        )}
        {isLast && <ReplyActions onReply={onReply} onNote={onNote} />}
      </div>
    </div>
  )
}

function CollapsedRow({ avatarBg, avatarColor, authorLabel, snippet, createdAt, onExpand }: {
  avatarBg: string; avatarColor: string; authorLabel: string; snippet: string; createdAt: string; onExpand: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onExpand} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: hovered ? 'var(--d-raised)' : 'transparent', transition: 'background 80ms' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarBg, color: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
        {authorLabel.slice(0, 2).toUpperCase()}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-text-2)', flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {authorLabel.split(' ')[0]}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--d-text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {snippet.replace(/<[^>]*>/g, '').replace(/\n/g, ' ').slice(0, 120)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--d-text-4)', flexShrink: 0 }}>{fmtDate(createdAt)}</span>
    </div>
  )
}
