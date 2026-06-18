import { create } from "zustand";
import type { NodeKind } from "@/types";

export const ALL_KINDS: NodeKind[] = ["feature", "module", "entity", "route", "external", "queue"];

// Routes and queues are the most numerous node kinds and dominate the
// layout; start with them hidden so the map is readable, toggle on demand.
const DEFAULT_VISIBLE_KINDS: Record<NodeKind, boolean> = {
  feature: true,
  module: true,
  entity: true,
  route: false,
  external: true,
  queue: false,
};

interface GraphState {
  selected: string | null;
  select: (label: string | null) => void;

  activeJourney: string | null;
  beatIndex: number;
  playing: boolean;
  setJourney: (journey: string | null) => void;
  setBeatIndex: (i: number) => void;
  play: () => void;
  pause: () => void;
  step: (delta: number, length: number) => void;

  visibleKinds: Record<NodeKind, boolean>;
  toggleKind: (kind: NodeKind) => void;
  showAllKinds: () => void;
  hideAllKinds: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  selected: null,
  select: (label) => set({ selected: label }),

  activeJourney: null,
  beatIndex: 0,
  playing: false,
  setJourney: (journey) => set({ activeJourney: journey, beatIndex: 0, playing: false }),
  setBeatIndex: (i) => set({ beatIndex: i }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  step: (delta, length) =>
    set((s) => {
      const next = s.beatIndex + delta;
      if (next < 0) return { beatIndex: 0, playing: false };
      if (next >= length) return { beatIndex: length - 1, playing: false };
      return { beatIndex: next };
    }),

  visibleKinds: DEFAULT_VISIBLE_KINDS,
  toggleKind: (kind) =>
    set((s) => ({ visibleKinds: { ...s.visibleKinds, [kind]: !s.visibleKinds[kind] } })),
  showAllKinds: () =>
    set({ visibleKinds: { feature: true, module: true, entity: true, route: true, external: true, queue: true } }),
  hideAllKinds: () =>
    set({ visibleKinds: { feature: false, module: false, entity: false, route: false, external: false, queue: false } }),
}));
