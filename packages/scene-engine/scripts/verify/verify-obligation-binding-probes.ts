/**
 * Adversarial probes for binding a ProblemIR body name to a scene entity.
 *
 * Every probe is authored here (no student text). An adversarial probe pairs
 * a ProblemIR name with a figure whose nearest label names a different body:
 * a "circular orbit" against an ellipse labelled "orbit", a "second
 * projectile" against a figure with one projectile. A wrong binding lets the
 * figure pass its obligations, so it is counted. Controls are correct pairs
 * that a working binding must accept. The expected counts are pinned below so
 * a change in either direction fails the gate.
 */
import { strict as assert } from "node:assert";
import { attemptArchetypeScene } from "../../src/archetypes";
import type { ProblemIR } from "../../src/ir/problemIR";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { SceneDocument } from "../../src/types";

type Kind = ProblemIR["entities"][number]["kind"];
interface Body { kind: Kind; label: string }
interface Probe { name: string; question: string; document: SceneDocument; bodies: Body[]; adversarial: boolean }

function problem(bodies: readonly Body[]): ProblemIR {
  const entities = bodies.map((body, index) => ({ id: `e${index}`, kind: body.kind, label: body.label, evidenceFactIds: [] }));
  return {
    schemaVersion: "problem-ir/v1",
    id: "probe",
    facts: [],
    entities,
    expressions: [],
    constraints: [],
    representationIntents: [{ id: "i0", kind: "conceptual", entityIds: entities.map((entity) => entity.id), evidenceFactIds: [] }],
  } as unknown as ProblemIR;
}

/** A hand-made figure: only kinds and labels matter to body binding. */
function handFigure(question: string, entities: Array<{ id: string; kind: string; label: string }>): SceneDocument {
  return {
    source: { question },
    entities: entities.map((entity) => ({ ...entity })),
    requiredEntityIds: entities.map((entity) => entity.id),
    constructions: [],
    assertions: [],
    revealGroups: [{ id: "all", entityIds: entities.map((entity) => entity.id), dependsOn: [], narrationCue: "all" }],
    quantities: [],
  } as unknown as SceneDocument;
}

function archetypeFigure(question: string, archetype: string): SceneDocument {
  const attempt = attemptArchetypeScene({ question });
  assert.equal(attempt.scene?.archetype, archetype, `guard: ${question} must draw ${archetype} (${attempt.declined ?? ""})`);
  return attempt.scene!.document;
}

const PROJECTILE = "Derive the range of a projectile launched with speed u at angle theta on level ground.";
// The stem states its heading: since #310 a crossing with no stated heading
// draws nothing, so the guard would fail before any binding is tested.
const RIVER = "A boat moves at 5 m/s in still water across a 100 m wide river flowing at 3 m/s, heading perpendicular to the banks. Find the time to cross.";
const projectile = archetypeFigure(PROJECTILE, "projectile");
const river = archetypeFigure(RIVER, "river_boat");
// An edited copy keeps every label but draws a straight path: not the figure
// the generator computed from this question.
const edited = structuredClone(projectile);
const path = edited.constructions.find((row) => row.outputs.includes("trajectory"))!;
path.inputs.expression = "0+1*x";
const hand = (question: string, kind: string, label: string) => ({ question, document: handFigure(question, [{ id: "body", kind, label }]) });

const probes: Probe[] = [
  // Adversarial: the nearest label names a different body.
  { name: "circular orbit vs an ellipse labelled orbit", ...hand("A satellite moves in a circular orbit of radius r.", "polyline", "orbit"), bodies: [{ kind: "curve", label: "circular orbit" }], adversarial: true },
  { name: "inclined plane vs a horizontal surface labelled plane", ...hand("A block rests on an inclined plane at angle theta.", "segment", "plane"), bodies: [{ kind: "line", label: "inclined plane" }], adversarial: true },
  { name: "river bank vs a road bank labelled bank", ...hand("A boat is tied to the river bank.", "segment", "bank"), bodies: [{ kind: "line", label: "river bank" }], adversarial: true },
  { name: "reflected ray vs an incident ray labelled ray", ...hand("A ray is reflected by a plane mirror.", "ray", "ray"), bodies: [{ kind: "line", label: "reflected ray" }], adversarial: true },
  { name: "concave mirror vs a convex arc labelled mirror", ...hand("An object stands before a concave mirror.", "arc", "mirror"), bodies: [{ kind: "curve", label: "concave mirror" }], adversarial: true },
  { name: "charged particle vs a neutral point labelled particle", ...hand("A charged particle enters a magnetic field.", "point", "particle"), bodies: [{ kind: "point", label: "charged particle" }], adversarial: true },
  { name: "frictionless incline vs a segment labelled incline", ...hand("A block slides down a frictionless incline.", "segment", "incline"), bodies: [{ kind: "line", label: "frictionless incline" }], adversarial: true },
  { name: "second projectile vs the one drawn projectile", question: PROJECTILE, document: projectile, bodies: [{ kind: "point", label: "second projectile" }], adversarial: true },
  { name: "horizontal trajectory vs the drawn parabola", question: PROJECTILE, document: projectile, bodies: [{ kind: "curve", label: "horizontal trajectory" }], adversarial: true },
  { name: "elliptical trajectory vs the drawn parabola", question: PROJECTILE, document: projectile, bodies: [{ kind: "curve", label: "elliptical trajectory" }], adversarial: true },
  { name: "parabolic trajectory vs an edited copy that draws a straight path", question: PROJECTILE, document: edited, bodies: [{ kind: "curve", label: "parabolic trajectory" }], adversarial: true },
  { name: "swimmer vs the drawn boat", question: RIVER, document: river, bodies: [{ kind: "body", label: "swimmer" }], adversarial: true },
  { name: "two rivers vs the one drawn river", question: RIVER, document: river, bodies: [{ kind: "region", label: "river" }, { kind: "region", label: "river" }], adversarial: true },
  { name: "wind current vs the drawn river current", question: RIVER, document: river, bodies: [{ kind: "field", label: "wind current" }], adversarial: true },
  // Controls: correct pairs a working binding must accept.
  { name: "control: parabolic trajectory on the projectile", question: PROJECTILE, document: projectile, bodies: [{ kind: "curve", label: "parabolic trajectory" }], adversarial: false },
  { name: "control: projectile (point mass) on the projectile", question: PROJECTILE, document: projectile, bodies: [{ kind: "point", label: "projectile (point mass)" }], adversarial: false },
  { name: "projectile A is a named body, not the bare projectile", question: PROJECTILE, document: projectile, bodies: [{ kind: "point", label: "projectile A" }], adversarial: true },
  { name: "a trailing lower case a is a body name too", question: PROJECTILE, document: projectile, bodies: [{ kind: "point", label: "projectile a" }], adversarial: true },
  { name: "control: a projectile still binds", question: PROJECTILE, document: projectile, bodies: [{ kind: "point", label: "a projectile" }], adversarial: false },
  { name: "control: level ground on the projectile", question: PROJECTILE, document: projectile, bodies: [{ kind: "line", label: "level ground" }], adversarial: false },
  { name: "control: near bank and far bank on the river", question: RIVER, document: river, bodies: [{ kind: "line", label: "near bank" }, { kind: "line", label: "far bank" }], adversarial: false },
  { name: "control: river current on the river", question: RIVER, document: river, bodies: [{ kind: "field", label: "river current" }], adversarial: false },
  { name: "control: river on the river", question: RIVER, document: river, bodies: [{ kind: "region", label: "river" }], adversarial: false },
  { name: "control: river with both banks on the river", question: RIVER, document: river, bodies: [{ kind: "region", label: "river" }, { kind: "line", label: "near bank" }, { kind: "line", label: "far bank" }], adversarial: false },
];

/**
 * Pinned outcome of the binding rule (certified figure identity by role): no
 * adversarial pair binds and every control binds.
 */
const EXPECTED_WRONG: readonly string[] = [];
const EXPECTED_CONTROLS_BOUND: readonly string[] = probes.filter((probe) => !probe.adversarial).map((probe) => probe.name);

const wrong: string[] = [];
const bound: string[] = [];
for (const probe of probes) {
  const result = checkVisualObligations(deriveVisualObligations(problem(probe.bodies)), probe.document, probe.question);
  const passes = result.missing.length === 0;
  if (probe.adversarial && passes) wrong.push(probe.name);
  if (!probe.adversarial && passes) bound.push(probe.name);
  console.log(`${passes ? "BIND  " : "refuse"} ${probe.adversarial ? "adversarial" : "control    "} ${probe.name}`
    + (passes ? "" : `  (${result.missing.map((miss) => miss.message).join("; ")})`));
}
const adversarial = probes.filter((probe) => probe.adversarial).length;
console.log(`wrong bindings: ${wrong.length} of ${adversarial} adversarial; controls bound: ${bound.length} of ${probes.length - adversarial}`);
assert.deepEqual(wrong, EXPECTED_WRONG, "adversarial outcome changed");
assert.deepEqual(bound, EXPECTED_CONTROLS_BOUND, "control outcome changed");
console.log("verify-obligation-binding-probes: ok");
