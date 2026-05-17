import * as React from 'react'

interface AgentReplyProps {
  ticketNumber: string
  ticketTitle: string
  replyBody: string
  orgName: string
  portalUrl: string
  replyToAddress: string
}

export function AgentReplyEmail({
  ticketNumber,
  ticketTitle,
  replyBody,
  orgName,
  portalUrl,
  replyToAddress: _replyToAddress,
}: AgentReplyProps) {
  return (
    <div>
      <h1>New reply on {ticketNumber}</h1>
      <p>Subject: {ticketTitle}</p>
      <div dangerouslySetInnerHTML={{ __html: replyBody }} />
      <p>— {orgName} Support Team</p>
      <a href={portalUrl}>View in portal</a>
    </div>
  )
}
