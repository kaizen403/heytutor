/** Optional evidence output; collecting a report never changes a gate verdict. */
import { writeFileSync } from "node:fs";
import { attemptArchetypeScene } from "../../../scene-engine/src/archetypes/index.ts";
import { sceneDemand } from "../../../scene-engine/src/synthesize/sceneDemand.ts";

export interface PhysicsProbeRecord {
  id: string;
  question: string;
  families: readonly string[];
  outcome: "scene" | "text_only" | "declared_decline" | "missing_scene";
  family?: string;
  tier?: string;
}

export function writePhysicsProbeReport(gate: string, records: PhysicsProbeRecord[]): void {
  const flag = process.argv.indexOf("--report");
  if (flag < 0) return;
  const path = process.argv[flag + 1];
  if (!path || path.startsWith("--")) throw new Error("--report requires an output file path");
  writeFileSync(path, JSON.stringify({
    gate,
    // This is diagnostic inventory, never an accepted baseline or coverage count.
    probes: records.map(record => {
      if (record.outcome === "scene" || record.outcome === "text_only") return record;
      const attempt = attemptArchetypeScene({ question: record.question });
      return {
        ...record,
        demand: sceneDemand(record.question),
        archetypeAttempt: {
          match: attempt.match,
          declined: attempt.declined,
          issues: attempt.issues,
          // An isolated archetype attempt may draw something the public family
          // selector refuses. It does not override that selector's verdict.
          candidateBeforeFamilySelection: attempt.scene?.archetype ?? null,
        },
      };
    }),
  }, null, 2) + "\n");
}
