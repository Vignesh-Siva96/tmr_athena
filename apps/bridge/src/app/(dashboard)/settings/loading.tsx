import { Skeleton } from '@/components/Skeleton'

// Route-level Suspense fallback for the /settings segment. NOTE: settings/layout.tsx already
// renders the sidebar + settings nav and wraps children in <main>, so this fallback is
// content-only — it must NOT re-render the shell. Mirrors a typical settings page: a title
// followed by a couple of form/card sections.
export default function SettingsLoading() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Skeleton h={26} w="220px" />
      <div style={{ height: 6 }} />
      <Skeleton h={13} w="60%" />
      <div style={{ height: 28 }} />
      {Array.from({ length: 2 }).map((_, section) => (
        <div key={section} style={{ marginBottom: 20, padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
          <Skeleton h={14} w="30%" />
          <div style={{ height: 18 }} />
          {Array.from({ length: 3 }).map((_, field) => (
            <div key={field} style={{ marginBottom: 16 }}>
              <Skeleton h={11} w="22%" /><div style={{ height: 8 }} /><Skeleton h={36} radius={8} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
