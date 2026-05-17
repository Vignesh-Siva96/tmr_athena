import * as React from 'react'

interface AgentInviteProps {
  agentName: string
  orgName: string
  inviteUrl: string
}

export function AgentInviteEmail({ agentName, orgName, inviteUrl }: AgentInviteProps) {
  return (
    <div>
      <h1>You have been invited to {orgName} Support</h1>
      <p>Hi {agentName},</p>
      <p>You have been invited to join the {orgName} support team.</p>
      <a href={inviteUrl}>Accept Invitation</a>
    </div>
  )
}
