import * as React from 'react'

interface TicketConfirmationProps {
  ticketNumber: string
  ticketTitle: string
  orgName: string
  portalUrl: string
}

export function TicketConfirmationEmail({
  ticketNumber,
  ticketTitle,
  orgName,
  portalUrl,
}: TicketConfirmationProps) {
  return (
    <div>
      <h1>Your support ticket has been received</h1>
      <p>Ticket: {ticketNumber}</p>
      <p>Subject: {ticketTitle}</p>
      <p>The {orgName} team will get back to you shortly.</p>
      <a href={portalUrl}>View your ticket</a>
    </div>
  )
}
