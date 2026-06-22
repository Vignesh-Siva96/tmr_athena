import { Skeleton } from '@/components/Skeleton'

// Content-only Suspense fallback for /inbox — the sidebar + outer flex come from
// (dashboard)/layout.tsx, so this paints just the content slot during the route transition
// (chunk download on first visit) so the previous page's content doesn't linger. Mirrors the
// inbox content (header + ticket-row list).
export default function InboxLoading() {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <header style={{ padding: '0 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Skeleton h={20} w="160px" />
          <Skeleton h={28} w="220px" radius={8} />
        </div>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} h={64} radius={10} />
        ))}
      </div>
    </main>
  )
}
