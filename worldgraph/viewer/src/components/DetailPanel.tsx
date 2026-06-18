"use client";

import type { World, WorldNode } from "@/types";
import { useGraphStore } from "@/store/useGraphStore";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

function ChipList({ labels, onPick }: { labels: string[]; onPick: (l: string) => void }) {
  if (!labels.length) return <p>—</p>;
  return (
    <div>
      {labels.map((l) => (
        <span key={l} className="chip" onClick={() => onPick(l)}>
          {l}
        </span>
      ))}
    </div>
  );
}

function renderNodeDetail(label: string, node: WorldNode, onPick: (l: string) => void) {
  const title = node.title ?? node.name ?? node.handler ?? label;
  return (
    <>
      <h2>{title}</h2>
      <div className="label">{label}</div>

      {node.summary && <p>{node.summary}</p>}
      {node.notes && <p>{node.notes}</p>}
      {node.why && (
        <Section title="Why">
          <p>{node.why}</p>
        </Section>
      )}

      {node.stack && node.stack.length > 0 && (
        <Section title="Stack">
          <ul>
            {node.stack.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Section>
      )}

      {node.kind === "route" && (
        <Section title="Endpoint">
          <p>
            <code>
              {node.method} {node.path}
            </code>{" "}
            → <code>{node.handler}</code>
          </p>
        </Section>
      )}

      {node.kind === "entity" && node.table && (
        <Section title={`Table: ${node.table}`}>
          <ul>
            {(node.columns ?? []).map((c) => (
              <li key={c.name}>
                <code>{c.name}</code> {c.type}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {node.kind === "entity" && node.relations && node.relations.length > 0 && (
        <Section title="Relations">
          <div>
            {node.relations.map((r) => (
              <span key={r.to + r.field} className="chip" onClick={() => onPick(r.to)}>
                {r.kind} → {r.to}
              </span>
            ))}
          </div>
        </Section>
      )}

      {node.kind === "queue" && (
        <Section title="Producer / Consumer">
          <p>
            <code>{node.producer}</code> → <code>{node.consumer}</code>
          </p>
        </Section>
      )}

      {node.kind === "module" && (
        <Section title="Path">
          <p>
            <code>{node.path}</code>
          </p>
        </Section>
      )}

      {(["modules", "entities", "routes", "externals", "queues", "imports", "usedBy", "writtenBy"] as const).map(
        (key) => {
          const values = node[key] as string[] | undefined;
          if (!values || values.length === 0) return null;
          return (
            <Section key={key} title={key}>
              <ChipList labels={values} onPick={onPick} />
            </Section>
          );
        },
      )}

      {node.keyFiles && node.keyFiles.length > 0 && (
        <Section title="Key Files">
          <ul>
            {node.keyFiles.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {node.gaps && node.gaps.length > 0 && (
        <Section title="Known Gaps">
          <ul>
            {node.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Connects to">
        <ChipList labels={node.connects} onPick={onPick} />
      </Section>
    </>
  );
}

export default function DetailPanel({ world }: { world: World }) {
  const selected = useGraphStore((s) => s.selected);
  const select = useGraphStore((s) => s.select);

  if (!selected || !world.nodes[selected]) {
    return (
      <div className="world-detail">
        <div className="empty-state">Click a node to see its dossier.</div>
      </div>
    );
  }

  return <div className="world-detail">{renderNodeDetail(selected, world.nodes[selected], select)}</div>;
}
