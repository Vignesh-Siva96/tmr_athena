import { Skeleton } from '@/components/Skeleton'

// Generic content-only Suspense fallback for any (dashboard) segment without its own loading.tsx
// (e.g. /tickets/[id], /tickets/domain/[domain]). The sidebar + outer flex come from
// (dashboard)/layout.tsx, so this paints just the content slot during the route transition,
// preventing the previous page from lingering.
export default function DashboardLoading() {
  return (
    <main style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} h={80} radius={10} />
      ))}
    </main>
  )
}
