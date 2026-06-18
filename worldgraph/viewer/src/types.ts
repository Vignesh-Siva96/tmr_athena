export type NodeKind = "feature" | "module" | "entity" | "route" | "external" | "queue";

export interface WorldNode {
  kind: NodeKind;
  connects: string[];
  title?: string;
  name?: string;
  summary?: string;
  stack?: string[];
  modules?: string[];
  entities?: string[];
  routes?: string[];
  externals?: string[];
  queues?: string[];
  keyFiles?: string[];
  why?: string;
  gaps?: string[];
  path?: string;
  imports?: string[];
  usedBy?: string[];
  table?: string;
  columns?: { name: string; type: string }[];
  relations?: { to: string; kind: string; field?: string }[];
  writtenBy?: string[];
  method?: string;
  handler?: string;
  module?: string;
  feature?: string;
  producer?: string;
  consumer?: string;
  notes?: string;
}

export interface WorldIndexEntry {
  summary: string;
  connects: string[];
}

export interface JourneyBeat {
  node: string;
  say: string;
}

export interface Journey {
  title: string;
  beats: JourneyBeat[];
}

export interface World {
  version: number;
  updated: string;
  index: Record<string, WorldIndexEntry>;
  nodes: Record<string, WorldNode>;
  journeys: Record<string, Journey>;
}
