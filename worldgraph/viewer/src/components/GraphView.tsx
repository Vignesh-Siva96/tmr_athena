"use client";

import { useMemo, useEffect, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";
import type { World } from "@/types";
import { layoutGraph } from "@/lib/layout";
import WorldNode from "./WorldNode";
import { useGraphStore } from "@/store/useGraphStore";

const nodeTypes = { world: WorldNode };

function titleFor(label: string, node: World["nodes"][string]): string {
  return node.title ?? node.name ?? node.handler ?? label.split(":")[1] ?? label;
}

function GraphInner({ world }: { world: World }) {
  const selected = useGraphStore((s) => s.selected);
  const select = useGraphStore((s) => s.select);
  const activeJourney = useGraphStore((s) => s.activeJourney);
  const beatIndex = useGraphStore((s) => s.beatIndex);
  const visibleKinds = useGraphStore((s) => s.visibleKinds);
  const { setCenter, getNode, fitView } = useReactFlow();

  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = Object.entries(world.nodes)
      .filter(([, n]) => visibleKinds[n.kind])
      .map(([label, n]) => ({
        id: label,
        type: "world",
        position: { x: 0, y: 0 },
        data: { label, kind: n.kind, title: titleFor(label, n), selected: false, beatActive: false },
      }));
    const visibleIds = new Set(nodes.map((n) => n.id));

    const edgeSet = new Set<string>();
    const edges: Edge[] = [];
    for (const [label, entry] of Object.entries(world.index)) {
      if (!visibleIds.has(label)) continue;
      for (const target of entry.connects) {
        if (!visibleIds.has(target)) continue;
        const key = [label, target].sort().join("|");
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({
          id: `${label}->${target}`,
          source: label,
          target,
          style: { stroke: "var(--d-border)" },
        });
      }
    }

    return { initialNodes: layoutGraph(nodes, edges), initialEdges: edges };
  }, [world, visibleKinds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // re-layout and re-fit whenever the kind filter changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    const id = window.requestAnimationFrame(() => fitView({ duration: 300 }));
    return () => window.cancelAnimationFrame(id);
  }, [initialNodes, initialEdges, setNodes, setEdges, fitView]);

  const beatNode = useMemo(() => {
    if (!activeJourney) return null;
    const journey = world.journeys[activeJourney];
    return journey?.beats[beatIndex]?.node ?? null;
  }, [world, activeJourney, beatIndex]);

  // reflect selection / beat highlight on nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          selected: n.id === selected,
          beatActive: n.id === beatNode,
        },
      })),
    );
  }, [selected, beatNode, initialNodes, setNodes]);

  // pan camera to the active beat node
  const hasPanned = useRef(false);
  useEffect(() => {
    if (!beatNode) return;
    const node = getNode(beatNode);
    if (!node) return;
    const x = node.position.x + 90;
    const y = node.position.y + 25;
    setCenter(x, y, { zoom: 1.1, duration: 600 });
    hasPanned.current = true;
  }, [beatNode, getNode, setCenter]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => select(node.id)}
      onPaneClick={() => select(null)}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--d-border)" gap={24} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable style={{ background: "var(--d-surface)" }} maskColor="rgba(0,0,0,0.6)" />
    </ReactFlow>
  );
}

export default function GraphView({ world }: { world: World }) {
  return (
    <ReactFlowProvider>
      <GraphInner world={world} />
    </ReactFlowProvider>
  );
}
