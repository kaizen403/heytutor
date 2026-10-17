/** Replay synthetic live-test planner output. No network, credentials or student data. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  applySourceQuantityAuthority,
  synthesizeFamilyScene,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const policy = {
  preferPlanner: true,
  allowVerifiedSourceRecovery: true,
  allowedFigureSources: ["planner", "verified_recovery", "text_only"] as const,
};

async function main() {
  const failures: string[] = [];
  for (const name of [
    "mirror",
    "circuit",
    "projectile",
    "interference",
    "incline",
  ]) {
    try {
      const fixture = JSON.parse(
        readFileSync(
          new URL(`./fixtures/physics-audit/${name}.json`, import.meta.url),
          "utf8",
        ),
      ) as {
        question: string;
        turnPlan: TurnPlanV3;
      };
      const { question } = fixture;
      for (const initialPlan of [
        fixture.turnPlan,
        {
          ...fixture.turnPlan,
          givens: [],
          derived: [],
          unknowns: [],
          qualitativeClaims: [],
          lawIds: [],
          assumptions: [],
        },
      ]) {
        const turnPlan = applySourceQuantityAuthority(
          initialPlan,
          null,
          question,
        ).plan;
        // Transport failure/deadline returns null; malformed model output must
        // reach the same independent source recovery without being rendered.
        for (const candidate of [
          null,
          { schemaVersion: "invalid", entities: [] },
        ]) {
          const result = selectProductionScene({
            question,
            turnPlan,
            problemIR: null,
            candidate,
            policy,
          });
          assert(result.representation, `${name}: ${result.reason}`);
          assert.equal(result.visualStatus, "validated");
          assert.equal(result.saveFailure, null);
          const selected = result.representation;
          const presentation = buildVerifiedDiagramPresentation(
            selected.sceneDocument,
            selected.renderScene,
            { figureFamily: selected.family },
          );
          assert(
            verifiedDiagramHasDrawableInk(presentation.diagram),
            `${name}: actual board transport has ink`,
          );
          assert(
            presentation.introSegments.length > 0,
            `${name}: diagram has a narrated reveal`,
          );
          const saved = await canonicalizeTurnSceneMetadata({
            question,
            sceneDocument: selected.sceneDocument,
            visualStatus: result.visualStatus,
            sceneArtifacts: {
              schemaVersion: "scene-artifacts/v3",
              turnPlan,
              representationTier: selected.tier,
              nonMetric: selected.nonMetric,
              figureSource: selected.figureSource,
              diagramResultStatus: "ready",
            },
            segments: [],
          });
          assert(saved.ok, `${name}: ${saved.ok ? "saved" : saved.error}`);
          if (process.env.PHYSICS_AUDIT_EXPORT) {
            mkdirSync(process.env.PHYSICS_AUDIT_EXPORT, { recursive: true });
            writeFileSync(
              `${process.env.PHYSICS_AUDIT_EXPORT}/${name}.json`,
              JSON.stringify(
                {
                  question,
                  turnPlan,
                  document: selected.sceneDocument,
                  presentation,
                },
                null,
                2,
              ),
            );
          }
          if (name === "projectile") {
            assert.equal(
              selected.sceneDocument.quantities.find((q) => q.id === "h0")
                ?.value,
              45,
              "cliff height must not be the launch speed",
            );
            assert(
              selected.renderScene.primitives.some(
                (p) => "text" in p && p.text === "R=72.1 m",
              ),
              "trajectory uses the source height and gravity",
            );
            // Recreate the historical wrong-height cache entry using a valid
            // scene for a different height. Self-consistent geometry alone must
            // not certify that this is the question's diagram.
            const staleQuestion = question.replace(
              "45 m high cliff",
              "20 m high cliff",
            );
            const stale = synthesizeFamilyScene({
              question: staleQuestion,
              turnPlan: { ...fixture.turnPlan, question: staleQuestion },
            });
            assert(stale);
            stale.document.source.question = question;
            const recovered = selectProductionScene({
              question,
              turnPlan,
              problemIR: null,
              candidate: stale.document as unknown as Record<string, unknown>,
              policy,
            });
            assert.equal(
              recovered.candidateValidation?.valid,
              false,
              "old wrong-height cache must be rejected",
            );
            assert(
              recovered.representation,
              "rejected cache still recovers the current source diagram",
            );
            assert.equal(
              recovered.representation.sceneDocument.quantities.find(
                (q) => q.id === "h0",
              )?.value,
              45,
            );
            const rejectedSave = await canonicalizeTurnSceneMetadata({
              question,
              sceneDocument: stale.document,
              visualStatus: "validated",
              sceneArtifacts: {
                schemaVersion: "scene-artifacts/v3",
                turnPlan,
                representationTier: stale.tier,
                nonMetric: stale.nonMetric,
                diagramResultStatus: "ready",
              },
              segments: [],
            });
            assert(
              !rejectedSave.ok,
              "server must reject old wrong-height geometry independently of the browser",
            );
          }
          if (name === "incline") {
            assert(
              Math.abs(
                turnPlan.derived.find((q) => q.id === "a")!.value -
                  4.692820323027551,
              ) < 1e-8,
              "friction opposes current downslope velocity, not upslope acceleration",
            );
            assert(
              Math.abs(
                turnPlan.derived.find((q) => q.id === "T")!.value -
                  15.921539030917348,
              ) < 1e-8,
            );
          }
        }
      }
      console.log(
        `PASS ${name}: captured/empty plan + unavailable/invalid scene planner → source figure → board reveal → save`,
      );
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
