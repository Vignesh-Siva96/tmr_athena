import { redirect } from 'next/navigation'

// Shifts management now lives inside Agent settings.
export default function ShiftsRedirectPage() {
  redirect('/settings/agents')
}
