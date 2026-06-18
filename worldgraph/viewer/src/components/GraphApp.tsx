"use client";

import type { World } from "@/types";
import GraphView from "./GraphView";
import DetailPanel from "./DetailPanel";
import StoryboardPanel from "./StoryboardPanel";
import KindFilter from "./KindFilter";

export default function GraphApp({ world }: { world: World }) {
  const nodeCount = Object.keys(world.nodes).length;
  const journeyCount = Object.keys(world.journeys).length;

  return (
    <div className="world-shell">
      <div className="world-main">
        <div className="world-topbar">
          <div className="world-title">
            Worldgraph — TMR Support Platform
            <small>
              {nodeCount} nodes · {journeyCount} journeys · updated {world.updated}
            </small>
          </div>
          <KindFilter world={world} />
        </div>
        <div className="world-canvas">
          <GraphView world={world} />
        </div>
        <StoryboardPanel world={world} />
      </div>
      <DetailPanel world={world} />
    </div>
  );
}
