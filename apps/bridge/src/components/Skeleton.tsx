export function Skeleton({ h = 32, w, radius = 6, style }: {
  h?: number; w?: string; radius?: number; style?: React.CSSProperties
}) {
  return <div className="shimmer" style={{ height: h, width: w ?? '100%', borderRadius: radius, ...style }} />
}

export function SkeletonText({ lines = 2, w }: { lines?: number; w?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={12} w={i === lines - 1 && lines > 1 ? '60%' : (w ?? '100%')} />
      ))}
    </div>
  )
}
