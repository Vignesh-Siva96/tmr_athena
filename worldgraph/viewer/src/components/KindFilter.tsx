"use client";

import type { World } from "@/types";
import { ALL_KINDS, useGraphStore } from "@/store/useGraphStore";

export default function KindFilter({ world }: { world: World }) {
  const visibleKinds = useGraphStore((s) => s.visibleKinds);
  const toggleKind = useGraphStore((s) => s.toggleKind);
  const showAllKinds = useGraphStore((s) => s.showAllKinds);
  const hideAllKinds = useGraphStore((s) => s.hideAllKinds);

  const counts: Record<string, number> = {};
  for (const node of Object.values(world.nodes)) {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  }

  return (
    <div className="kind-filter">
      {ALL_KINDS.map((kind) => (
        <button
          key={kind}
          className={`kind-filter-chip kind-${kind} ${visibleKinds[kind] ? "active" : ""}`}
          onClick={() => toggleKind(kind)}
          title={`Toggle ${kind} nodes`}
        >
          <span className="kind-filter-dot" />
          {kind}
          <span className="kind-filter-count">{counts[kind] ?? 0}</span>
        </button>
      ))}
      <button className="kind-filter-action" onClick={showAllKinds}>
        All
      </button>
      <button className="kind-filter-action" onClick={hideAllKinds}>
        None
      </button>
    </div>
  );
}
