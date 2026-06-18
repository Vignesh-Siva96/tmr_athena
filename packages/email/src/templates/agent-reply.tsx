import * as React from 'react'

interface AgentReplyProps {
  ticketNumber: string
  ticketTitle: string
  replyBody: string
  orgName: string
  replyToAddress: string
}

export function AgentReplyEmail({
  ticketNumber,
  ticketTitle,
  replyBody,
  orgName,
  replyToAddress: _replyToAddress,
}: AgentReplyProps) {
  return (
    <div>
      <h1>New reply on {ticketNumber}</h1>
      <p>Subject: {ticketTitle}</p>
      <div dangerouslySetInnerHTML={{ __html: replyBody }} />
      <p>— {orgName} Support Team</p>
    </div>
  )
}
