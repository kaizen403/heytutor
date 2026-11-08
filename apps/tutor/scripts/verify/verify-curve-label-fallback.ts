/**
 * The curve label switch's last fallback: a stamped figure the compiler refuses, while dev's copy of it compiles,
 * is validated and saved as dev's figure. No recorded or built figure reaches this path (0 of 17,061 recorded
 * documents, 0 of 3,000 synthetic graphs), so this gate makes the stamped compile fail with a module mock:
 * every stamped document is refused, and an unstamped one compiles as it always does.
 * Run with --experimental-test-module-mocks.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
assert.equal(typeof mock.module, "function", "run with --experimental-test-module-mocks");
console.warn = () => {};

const enginePath = resolve(root, "../../packages/scene-engine/src/index.ts");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine = load(enginePath) as any;
const realCompile = engine.compileSceneDocument;
mock.module(enginePath, { namedExports: {
  ...engine,
  compileSceneDocument: (document: unknown, options?: unknown) => {
    const result = realCompile(document, options);
    if (!engine.isCurveLabelPlacementOnStroke(document)) return result;
    return { ok: false, renderScene: null, report: { ...result.report, issues: [...result.report.issues, { code: "label_too_long", severity: "fatal", message: "The moved label does not fit." }] } };
  },
} });

const { validateProductionSceneCandidate } = load(resolve(root, "features/tutor-session/lib/scene/productionSceneSelection.ts")) as typeof import("../../features/tutor-session/lib/scene/productionSceneSelection");
const { admitStoredScene } = load(resolve(root, "lib/scene/sceneAdmission.ts")) as typeof import("../../lib/scene/sceneAdmission");

const QUESTION = "Sketch y = x^2 - 4x - 5 for 0 <= x <= 6.";
const graph = {
  schemaVersion: engine.SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "graph" },
  source: { question: QUESTION, nonMetric: true, representationTier: "qualitative_verified" },
  entities: [{ id: "axes", kind: "axes", role: "coordinate axes" }, { id: "curve", kind: "polyline", role: "given curve", label: "y=x²−4x−5" }],
  constructions: [
    { id: "makeAxes", operator: "axes", inputs: { xMin: -0.5, xMax: 6.5, yMin: -10, yMax: 8 }, outputs: ["axes"] },
    { id: "makeCurve", operator: "function_curve", inputs: { expression: "x^2-4*x-5", xMin: 0, xMax: 6 }, outputs: ["curve"] },
  ],
  requiredEntityIds: ["axes", "curve"],
  revealGroups: [{ id: "graph", entityIds: ["axes", "curve"], dependsOn: [], narrationCue: "Plot the curve." }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
};
const plan = { schemaVersion: "turn-plan/v3", question: QUESTION, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };

// The mock does what it says: the stamped copy is refused, dev's compiles.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocked = load(enginePath) as any;
const document = engine.validateSceneDocument(graph).document;
assert(mocked.compileSceneDocument(document).ok, "dev's copy compiles");
assert(!mocked.compileSceneDocument(engine.withCurveLabelPlacement(document, true)).ok, "the stamped copy is refused");

// At the server: a stamped document, saved with the switch on, comes back as dev's admission.
const admit = (sceneDocument: unknown, curveLabels: boolean) => admitStoredScene({ sceneDocument, sceneQuestion: QUESTION, turnPlan: null, submittedTier: "qualitative_verified", curveLabels });
const stampedSave = admit(engine.withCurveLabelPlacement(document, true), true);
const devSave = admit(document, false);
assert(devSave.ok, "dev's figure saves");
assert(stampedSave.ok, `the stamped figure saves rather than being refused: ${stampedSave.ok ? "" : stampedSave.code}`);
assert(!engine.isCurveLabelPlacementOnStroke(stampedSave.document), "as dev's figure, unstamped");
assert.deepEqual(stampedSave.presentation, devSave.presentation, "with dev's presentation");
console.log("PASS fallback at the server: a stamped figure the compiler refuses is saved as dev's");

// Live, with the yield policy off: the switch on gives dev's figure.
const validate = (curveLabels: boolean) => validateProductionSceneCandidate({ candidate: structuredClone(graph), question: QUESTION, turnPlan: plan as never, curveLabels });
const devLive = validate(false), onLive = validate(true);
assert(devLive.valid && devLive.value, "dev validates the figure");
assert(onLive.valid && onLive.value, `with the switch on it still validates: ${JSON.stringify(onLive.errors.filter((issue) => issue.severity === "fatal").map((issue) => issue.code))}`);
assert(!engine.isCurveLabelPlacementOnStroke(onLive.value.document), "as dev's figure, unstamped");
assert.deepEqual(onLive.value.renderScene, devLive.value.renderScene, "drawn exactly as dev");
console.log("PASS fallback live: with the yield policy off, a stamped figure the compiler refuses is validated as dev's");
console.log("PASS curve label fallback: 2 groups");
