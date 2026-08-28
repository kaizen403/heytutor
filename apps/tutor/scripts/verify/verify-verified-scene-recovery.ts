import { SCENE_ENGINE_VERSION, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  findVerifiedSceneRecovery,
  forgetVerifiedScene,
  isRecoveryEligibleQuestion,
  rememberVerifiedScene,
} from "../../features/tutor-session/lib/verifiedSceneRecovery";
import type { StoredTurn } from "../../lib/boards/boardsClient";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const boardA = { boardId: "board-a" };
const boardB = { boardId: "board-b" };

const question = "Plot y = x^2 and mark its roots.";
const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "required",
};
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "The graph is requested." },
  source: { question },
  quantities: [],
  entities: [{ id: "origin", kind: "point", role: "root" }],
  constructions: [{ id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] }],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["origin"],
  revealGroups: [{ id: "graph", entityIds: ["origin"], dependsOn: [], narrationCue: "graph" }],
  teachingTimeline: [{ id: "show_graph", action: "reveal", targetId: "graph", dependsOn: [], narrationIntent: "show graph" }],
};

forgetVerifiedScene(question, boardA);
forgetVerifiedScene(question, boardB);
const storedTurn = {
  id: "turn-1",
  orderIndex: 0,
  question,
  rawResponse: "",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: document,
  sceneEngineVersion: SCENE_ENGINE_VERSION,
  validationReport: { valid: true },
  visualStatus: "validated",
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", turnPlan },
  segments: [],
} satisfies StoredTurn;

const stored = findVerifiedSceneRecovery(question, [storedTurn], boardA);
assert(stored?.source === "stored_turn", "a matching validated stored scene should be recoverable");
assert(stored.document !== document, "recovery must return a defensive scene clone");

const memory = findVerifiedSceneRecovery(question, [], boardA);
assert(memory?.source === "memory", "a recovered scene should be promoted to bounded memory");
memory.document.entities[0]!.role = "mutated";
assert(
  findVerifiedSceneRecovery(question, [], boardA)?.document.entities[0]!.role === "root",
  "callers must not be able to mutate the cached evidence",
);
assert(
  findVerifiedSceneRecovery(question, [], boardB) === null,
  "a recovered scene on board A must not be visible to board B",
);

forgetVerifiedScene(question, boardA);
forgetVerifiedScene(question, boardB);
rememberVerifiedScene(question, document, turnPlan, boardA);
assert(findVerifiedSceneRecovery(question, [], boardA)?.source === "memory", "fresh verified scenes should be remembered before persistence");
assert(findVerifiedSceneRecovery("Plot y = x^3 and mark its roots.", [storedTurn], boardA) === null, "different questions must never share a scene");
assert(!isRecoveryEligibleQuestion("What about this one?"), "context-dependent follow-ups must bypass recovery");
assert(
  findVerifiedSceneRecovery(question, [{ ...storedTurn, visualStatus: "retry_required" }], boardA)?.source === "memory",
  "the in-memory validated entry should remain preferred over failed stored attempts",
);

forgetVerifiedScene(question, boardA);
forgetVerifiedScene(question, boardB);
assert(
  findVerifiedSceneRecovery(question, [{ ...storedTurn, sceneEngineVersion: "scene-engine/old" }], boardA) === null,
  "scenes from an old engine must be re-planned",
);

const fallbackTurn: StoredTurn = {
  ...storedTurn,
  id: "turn-fallback",
  sceneDocument: {
    ...document,
    source: { question, representationTier: "question_representation", nonMetric: true },
  },
  sceneArtifacts: {
    schemaVersion: "scene-artifacts/v3",
    diagramResultStatus: "ready",
    representationTier: "question_representation",
    nonMetric: true,
    turnPlan,
  },
};
assert(
  findVerifiedSceneRecovery(question, [fallbackTurn], boardA) === null,
  "a stored non-metric representation must never be recovered as exact geometry",
);
rememberVerifiedScene(question, fallbackTurn.sceneDocument as SceneDocument, turnPlan, boardA);
assert(
  findVerifiedSceneRecovery(question, [], boardA) === null,
  "a non-metric representation must never enter exact-scene memory",
);

const documentB: SceneDocument = {
  ...document,
  entities: [{ id: "origin-b", kind: "point", role: "other" }],
};
rememberVerifiedScene(question, document, turnPlan, boardA);
rememberVerifiedScene(question, documentB, turnPlan, boardB);
assert(
  findVerifiedSceneRecovery(question, [], boardA)?.document.entities[0]?.id === "origin",
  "board A must keep its own scene while board B records the same question",
);
assert(
  findVerifiedSceneRecovery(question, [], boardB)?.document.entities[0]?.id === "origin-b",
  "board B must keep a distinct scene for the same question text",
);
forgetVerifiedScene(question, boardA);
assert(
  findVerifiedSceneRecovery(question, [], boardB)?.document.entities[0]?.id === "origin-b",
  "forgetting board A's scene must not wipe board B",
);

console.log("verified scene recovery verification passed");
