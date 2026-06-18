import { Handle, Position, type NodeProps } from "reactflow";

export interface WorldNodeData {
  label: string;
  kind: string;
  title: string;
  selected: boolean;
  beatActive: boolean;
}

export default function WorldNode({ data }: NodeProps<WorldNodeData>) {
  const classes = ["wg-node", `kind-${data.kind}`];
  if (data.selected) classes.push("selected");
  if (data.beatActive) classes.push("beat-active");

  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Left} />
      <div className="wg-kind">{data.kind}</div>
      <div className="wg-title">{data.title}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
