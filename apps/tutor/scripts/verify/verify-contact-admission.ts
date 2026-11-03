/**
 * Contact refusals hold on the real admission path, with yield on and off.
 *
 * compile/contactTruth.ts is checked on its own by the scene engine gate. This one proves the refusals through
 * validateProductionSceneCandidate and selection: verified parts may remove a label, but it must not turn a
 * contact refusal into a smaller figure that still draws the block in the wedge, and the strict lane must then
 * draw nothing. The documents have the shapes production drew, with their question text written here. Each true
 * twin must be admitted, so a refusal for an unrelated reason cannot pass this gate.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-contact-admission.ts
 */
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Xy = readonly [number, number];
type Entity = { id: string; kind: string; role: string; label?: string };
type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };

class Figure {
  entities: Entity[] = [];
  constructions: Construction[] = [];
  annotations: unknown[] = [];
  point(id: string, at: Xy, role = "point") {
    this.entities.push({ id, kind: "point", role });
    this.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x: at[0], y: at[1], coordinateSpace: "world" }, outputs: [id] });
    return this;
  }
  add(id: string, kind: string, role: string, operator: string, inputs: Record<string, unknown>, label?: string) {
    this.entities.push({ id, kind, role, ...(label ? { label } : {}) });
    this.constructions.push({ id: `make_${id}`, operator, inputs, outputs: [id] });
    return this;
  }
  segment(id: string, role: string, a: Xy, b: Xy) {
    return this.point(`${id}_a`, a, "end").point(`${id}_b`, b, "end").add(id, "segment", role, "segment", { start: `${id}_a`, end: `${id}_b` });
  }
  block(id: string, role: string, corners: Xy[], label: string) {
    corners.forEach((corner, i) => this.point(`${id}_${i}`, corner, "corner"));
    return this.add(id, "polygon", role, "polygon", { points: corners.map((_, i) => `${id}_${i}`) }, label);
  }
  box(id: string, role: string, center: Xy, width: number, height: number, label: string) {
    return this.point(`${id}_c`, center, "centre").add(id, "rectangle", role, "rectangle", { center: `${id}_c`, width, height }, label);
  }
  doc(question: string): Record<string, unknown> {
    const ids = this.entities.map((entity) => entity.id);
    return {
      schemaVersion: "scene-document/v2", source: { question, nonMetric: true, representationTier: "qualitative_verified" },
      visualDecision: { mode: "scene", reason: "contact admission fixture" },
      entities: this.entities, constructions: this.constructions, annotations: this.annotations,
      relations: [], assertions: [], quantities: [], teachingTimeline: [],
      revealGroups: [{ id: "setup", dependsOn: [], entityIds: ids, narrationCue: "setup" }], requiredEntityIds: ids,
    };
  }
}

const wedge = () => new Figure()
  .segment("incline", "rough inclined plane", [0, 0], [4.6, 2.6])
  .segment("ground", "horizontal ground", [0, 0], [4.6, 0])
  .segment("rise", "vertical side", [4.6, 0], [4.6, 2.6]);
const INCLINE = "A block rests on a rough incline. Draw the block on the incline.";
const FLOOR = "A block rests on a rough 45 degree plane. Draw it.";
const PULLEY = "Block A on a table is joined by a string over a pulley to a hanging block B. Draw the setup.";
const rows: { name: string; question: string; code: string; wrong: Record<string, unknown>; right: Record<string, unknown> }[] = [
  {
    name: "incline card: block under the slope", question: INCLINE, code: "body_inside_surface",
    wrong: wedge().block("body", "block", [[1.9, 1.074], [2.9, 1.639], [3.19, 1.15], [2.19, 0.58]], "m").doc(INCLINE),
    right: wedge().block("body", "block", [[1.9, 1.074], [2.9, 1.639], [2.61, 2.13], [1.61, 1.57]], "m").doc(INCLINE),
  },
  {
    name: "b5ba0604 shape: slope through the block", question: FLOOR, code: "body_straddles_surface",
    wrong: new Figure().segment("incline", "inclined plane", [0, 0], [6, 6]).segment("ground", "ground", [0, 0], [6, 0]).segment("rise", "vertical side", [6, 0], [6, 6])
      .block("body", "body on the plane", [[2.6, 3.4], [3.4, 2.6], [4, 3.2], [3.2, 4]], "m").doc(FLOOR),
    right: new Figure().segment("incline", "inclined plane", [0, 0], [6, 6]).segment("ground", "ground", [0, 0], [6, 0]).segment("rise", "vertical side", [6, 0], [6, 6])
      .block("body", "body on the plane", [[2.6, 2.6], [3.4, 3.4], [2.6, 4.2], [1.8, 3.4]], "m").doc(FLOOR),
  },
  {
    name: "4fb87931 shape: string through the table", question: PULLEY, code: "string_through_surface",
    wrong: new Figure().segment("surface", "horizontal surface", [-3, 0], [0, 0]).box("blockA", "block A", [-2, 0.3], 0.8, 0.6, "A")
      .segment("string", "vertical string", [-1.25, 0.55], [-1.25, -1.1]).box("blockB", "block B", [-1.25, -1.4], 0.6, 0.6, "B").doc(PULLEY),
    right: new Figure().segment("surface", "horizontal surface", [-3, 0], [0, 0]).box("blockA", "block A", [-2, 0.3], 0.8, 0.6, "A")
      .segment("string", "vertical string", [0.3, 0.55], [0.3, -1.1]).box("blockB", "block B", [0.3, -1.4], 0.6, 0.6, "B").doc(PULLEY),
  },
];
const planFor = (question: string): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as unknown as TurnPlanV3);
const STRICT = { preferPlanner: true, allowedFigureSources: ["planner", "linear_source", "text_only", "verified_recovery"] as never };
const CODES = new Set(["body_straddles_surface", "body_inside_surface", "string_through_surface", "hatch_inside_body"]);
const failures: string[] = [];
let checks = 0;
for (const row of rows) {
  const turnPlan = planFor(row.question);
  for (const yieldPolicy of ["off", "verified_parts"] as const) {
    checks += 2;
    const wrong = validateProductionSceneCandidate({ candidate: row.wrong, question: row.question, turnPlan, yieldPolicy });
    if (wrong.valid) failures.push(`${row.name}, yield ${yieldPolicy}: admitted${yieldPolicy === "verified_parts" ? ", so yield turned a refusal into a smaller figure" : ""}`);
    else if (!wrong.errors.some((issue) => issue.code === row.code)) failures.push(`${row.name}, yield ${yieldPolicy}: refused without ${row.code}: ${wrong.errors.map((issue) => issue.code).join(",")}`);
    if (!wrong.valid) {
      checks += 1;
      const selected = selectProductionScene({ question: row.question, turnPlan, problemIR: null, candidateValidation: wrong, exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true, completionEnabled: false, solverAuthority: null, policy: STRICT });
      if (selected.representation) failures.push(`${row.name}, yield ${yieldPolicy}: strict drew ${selected.representation.figureSource} after the refusal`);
    }
    const right = validateProductionSceneCandidate({ candidate: row.right, question: row.question, turnPlan, yieldPolicy });
    const hits = right.errors.filter((issue) => CODES.has(issue.code));
    if (hits.length) failures.push(`${row.name}, yield ${yieldPolicy}: the true twin was refused with ${hits.map((issue) => issue.code).join(",")}`);
    if (!right.valid) failures.push(`${row.name}, yield ${yieldPolicy}: the true twin was not admitted: ${right.errors.filter((issue) => issue.severity === "fatal").map((issue) => issue.code).join(",")}`);
  }
}
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(failures.length ? `${failures.length} failed of ${checks}` : `pass: ${checks} checks, contact refusals hold through admission and selection, true twins admitted`);
if (failures.length) process.exit(1);
