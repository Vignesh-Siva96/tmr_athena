import { Skeleton } from '@/components/Skeleton'

// Content-only Suspense fallback for /customers — the sidebar + outer flex come from
// (dashboard)/layout.tsx, so this paints just the content slot during the route transition so
// the previous page doesn't linger. Mirrors the customers content (header + table).
export default function CustomersLoading() {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <header style={{ padding: '0 24px', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Skeleton h={20} w="140px" />
          <Skeleton h={28} w="220px" radius={8} />
        </div>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} h={52} radius={8} />
        ))}
      </div>
    </main>
  )
}
