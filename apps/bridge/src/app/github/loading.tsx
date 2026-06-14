import { DashboardSidebar } from '@/components/dashboard/Sidebar'
import { Skeleton } from '@/components/Skeleton'

// Route-level Suspense fallback for /github — paints instantly during the route transition so
// the previous page doesn't linger. Mirrors the shell (sidebar + header + stats row + split pane).
export default function GithubLoading() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--d-bg)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <header style={{ height: 56, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          <Skeleton h={20} w="180px" />
        </header>
        {/* Stats row */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--d-border)', flexShrink: 0 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ flex: 1, padding: '14px 20px', borderRight: i < 2 ? '1px solid var(--d-border)' : 'none' }}>
              <Skeleton h={10} w="50%" /><div style={{ height: 8 }} /><Skeleton h={20} w="30%" />
            </div>
          ))}
        </div>
        {/* Split: list + detail */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--d-border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} h={72} radius={8} />
            ))}
          </div>
          <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Skeleton h={24} w="40%" />
            <Skeleton h={120} radius={10} />
            <Skeleton h={120} radius={10} />
          </div>
        </div>
      </main>
    </div>
  )
}
