import { Skeleton } from '@/components/Skeleton'

// Content-only Suspense fallback for the /analytics segment. The sidebar + outer flex come from
// (dashboard)/layout.tsx, so this renders just the content slot during the route transition
// (the page chunk download/compile on first visit, and the bare-/analytics → /analytics/operations
// redirect), before any page component has mounted. Without this, the first navigation shows a
// blank content area because the in-page `loading` skeleton lives inside the component that is
// still being fetched. Mirrors the operations content.
export default function AnalyticsLoading() {
  return (
    <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--d-text)', margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Analytics</h1>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {/* KPI strip */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: 1, padding: 18, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
              <Skeleton h={10} w="60%" /><div style={{ height: 8 }} /><Skeleton h={28} w="40%" />
            </div>
          ))}
        </div>

        {/* Volume + status */}
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} style={{ padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
              <Skeleton h={12} w="40%" /><div style={{ height: 16 }} /><Skeleton h={160} />
            </div>
          ))}
        </div>

        {/* Category / fields / priority */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
              <Skeleton h={12} w="50%" /><div style={{ height: 16 }} /><Skeleton h={140} />
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ padding: 20, background: 'var(--d-raised)', border: '1px solid var(--d-border)', borderRadius: 'var(--r-lg)' }}>
          <Skeleton h={12} w="35%" /><div style={{ height: 16 }} /><Skeleton h={120} />
        </div>
      </div>
    </main>
  )
}
