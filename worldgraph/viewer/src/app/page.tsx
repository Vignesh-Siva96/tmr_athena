import { readFileSync } from "fs";
import { join } from "path";
import type { World } from "@/types";
import GraphApp from "@/components/GraphApp";

export default function Page() {
  const worldPath = join(process.cwd(), "..", "atlas.world.json");
  const world: World = JSON.parse(readFileSync(worldPath, "utf-8"));

  return <GraphApp world={world} />;
}
