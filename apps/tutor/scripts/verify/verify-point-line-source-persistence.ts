// Point-line source lineage at the save and restore seams (agent #2, 4 Oct 2026).
// A scene that draws a different line at the same distance (5) from P(0,0)
// must not save or restore as the source figure, in any representation tier.
// In-memory canonical API controls only; not a student save, reopen or replay.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneArtifactsV3, SceneDocument } from "@heytutor/scene-engine";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";

const fixture = join(__dirname, "fixtures/point-line/annotation-link-positive.json");

async function main(): Promise<void> {
  let controls = 0;
  for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
    for (const control of ["positive", "same-distance-other-line", "point-moved", "drawn-line-only"] as const) {
      const submitted: SubmittedTurnSceneMetadata = structuredClone(JSON.parse(readFileSync(fixture, "utf8")).submitted);
      const scene = submitted.sceneDocument as SceneDocument;
      const artifacts = submitted.sceneArtifacts as SceneArtifactsV3;
      artifacts.representationTier = tier;
      artifacts.nonMetric = tier !== "exact_verified";
      scene.source.representationTier = tier;
      scene.source.nonMetric = tier !== "exact_verified";
      const line = scene.constructions.find((construction) => construction.operator === "line_equation")!;
      const distance = scene.constructions.find((construction) => construction.operator === "point_line_distance")!;
      const point = scene.constructions.find((construction) => construction.operator === "point")!;
      if (control === "same-distance-other-line") {
        // 4x+3y-25=0 is also 5 from the origin: same scalar, wrong line.
        Object.assign(line.inputs, { a: 4, b: 3, c: -25 });
        Object.assign(distance.inputs, { a: 4, b: 3, c: -25 });
      }
      if (control === "point-moved") {
        // (6,8) is also 5 from 3x+4y-25=0, but it is not the source point.
        Object.assign(point.inputs, { x: 6, y: 8 });
      }
      if (control === "drawn-line-only") Object.assign(line.inputs, { a: 3, b: 4, c: -50 });
      const canonical = await canonicalizeTurnSceneMetadata(submitted);
      assert.equal(canonical.ok, control === "positive", `${tier}/${control}: ${canonical.ok ? "accepted" : canonical.error}`);
      const restoreFatal = storedTurnSourceIssues(scene, { question: submitted.question, sceneArtifacts: artifacts })
        .filter((issue) => issue.severity === "fatal" && issue.code.startsWith("point_line_"));
      assert.equal(restoreFatal.length === 0, control === "positive", `${tier}/${control}: restore lineage ${JSON.stringify(restoreFatal)}`);
      controls += 2;
    }
  }
  console.log(`point-line source persistence: ${controls} save/restore controls passed (in-memory only)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
