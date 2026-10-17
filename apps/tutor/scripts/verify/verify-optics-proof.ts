/**
 * A planner lens or mirror figure on a `spherical_mirror` / `thin_lens` stem is
 * drawn only when the engine proves it: the object, image and foci come from
 * `gaussian_image` and `optical_focus` with the stem's u, f and element kind,
 * the element is drawn on the same centre and axis with the stem's sense, and
 * every ray ends on an engine-derived point. A label on the scene
 * (`source.archetype`) proves nothing and is ignored.
 *
 * G1/G2: proven mirror and lens figures draw as planner figures in both the
 * strict and the current production arms. G3: compiled-clean wrong figures
 * (wrong f, wrong element kind, an invented ray hit, a free-point mirror with
 * the image at the wrong distance), each also with a forged `source.archetype`,
 * never become planner figures. A mirror drawn convex beside a concave image
 * no longer compiles: the engine refuses it with
 * optical_element_focal_length_disagrees, and it is never a planner figure.
 *
 * G1a/G1b: a stem with no numbers no longer proves a figure of representative,
 * unitless values (G34: its plan names no u or f), and a stem with numbers
 * still needs a metric unit.
 * G2c/G2d: magnitude inputs (`form`, plan ids) draw; a form that contradicts the
 * stem, or an unsigned literal the plan does not support, never does. Both
 * leave the drawn mirror (R = -30) at another focal length, so the engine
 * refuses them before the proof runs.
 * G6a: a structural failure still reports plan agreement in the same pass.
 * G5a: every `ray_optics` exemplar with a `gaussian_image` (source files and the
 * built library) passes the plan's ids with `form`, draws no dimension, and puts
 * numbers only on the engine's optical points. G5b: each passes production
 * validation with an unsigned plan of its stem, loses no label to pruning, is
 * proven, and draws as the planner figure in the strict arm and with no policy.
 *
 * G7: an inline objectHeight the stated height contradicts never draws, in
 * signed and magnitude mode; the stated height, an inverted object and a
 * representative height on a stem with no stated height still pass (the h = 7
 * control draws its mirror tall enough for the h' = -21 hit, see G15).
 * G8: every line converging on the image tip starts on the element after a
 * drawn incident ray from the object tip, or is a lens chief ray whose drawn
 * path passes the optical centre. Paths ot->it and ob->it never draw on a lens,
 * a concave mirror or a convex mirror; the correct figures still do.
 * G9: a correct magnitude passes whatever sign the plan or the stem writes.
 * G10: a mirror axis written as {start, direction} is read.
 * G11: a stem that names no element kind does not default to convex. The
 * recorded stem "A spectacle lens marked -6.25 D" proves a diverging figure,
 * because a negative power is diverging. A stem that names the kind (convex,
 * concave, converging, diverging) or states a power or focal sign still
 * rejects the contradicting form.
 * G12a: rays traced by the engine (`principal_rays` from the image tip) prove a
 * lens or mirror figure without a hand-drawn `converges`: a concave and a convex
 * mirror, a convex lens with a real and with a virtual image, each drawn as the
 * planner figure in both arms, with and without a stray converges on the rays.
 * G12b: a free polyline or free segments posing as principal rays, rays traced
 * from the image base, a second gaussian image, a lens drawn on a mirror stem,
 * one traced ray, and a free hand ray beside traced ones all stay unproven.
 * G12c (P10): a traced ray whose hit lies beyond the drawn element's half height
 * stays unproven and never draws. G12d: in the presentation the traced rays'
 * back-extensions and guides carry dashed construction ink and nothing else does.
 * G13: a stated lens power fixes |f| = 1/|P|. On "-6.25 D" a diverging figure
 * with |f| = 112 cm (the plan's object distance), inline, by the id do, or
 * signed, stays unproven and never draws; production holds focalLength to the
 * plan's focal length and objectDistance to its object distance, so 112, do,
 * an objectDistance of 16 and a mirror focal length of 36 (= R) all fail
 * scene_quantity_unverified. The honest figures still draw; 33.3 cm on -3 D
 * proves (three figures), 30 cm does not; +2.5 D proves 0.4 m, not 0.5 m.
 * G14: a fatal converges with expected false proves nothing: rays from the hits
 * to the object base and the focus never draw. G15: a hit beyond the element as
 * drawn (faces of radius 2 stop at 1.9 under halfHeight 8) fails, traced or
 * hand-drawn. G16: a hit on the mirror made by midpoint, reflect_point or a
 * half-turn rotate proves; the same operators off the mirror do not. G17: a
 * concave mirror on an endpoint axis toward -x with signedRadius 30 (drawn with
 * the centre on the object side) draws; with -30 the engine refuses it.
 * G18: Gaussian notation (1/p + 1/q = 1/f) names the object distance p: a plan
 * that calls it p draws with objectDistance "p", and with an inline 10 (the
 * plan's p). A wrong object distance (12 inline, or p
 * declared as 12) and the object distance offered as f (by id p or inline)
 * still fail scene_quantity_unverified and never draw, on the lens and on the
 * "-6.25 D" spectacle lens whose plan calls u p.
 * G19: every drawn light path is a ray the element forms, not only the two that
 * prove the image. Beside three traced rays on the review's lens (2 cm tall, 30 cm,
 * f 10 cm), a segment from the object base to the image tip, a hand parallel ray
 * bent back to F1 or refracted to the image base, a vector from the object tip to
 * F2 or from the image tip to F1, the parallel ray's true line drawn back across the
 * lens, a refracted ray with no incident ray, and a concave mirror's parallel ray
 * drawn on behind the mirror all stay unproven and never draw. Traced rays alone,
 * and a correct hand parallel or focal ray beside two traced ones, still draw.
 * G20: a stem that names no element kind takes it from the image it states, read
 * from the stem alone, or declines. "A mirror of focal length 10 cm forms a real
 * image" never proves a convex mirror and draws the concave one; a real or
 * magnified image, a virtual and diminished one, and an image 30 cm or 6 cm behind
 * a mirror 15 cm from the object each prove only their kind. A stem with no word on
 * the image (also "-10 cm" on a spherical mirror, an upright pin, a real object, a
 * question, a clause after "whether", "virtual or real") declines both kinds.
 * G21 (P6): the object and image arrows sit on the engine's anchors. On a traced
 * lens, an arrow redrawn as a polyline to a literal tip at the wrong height, an
 * arrow laid flat along the axis to a focus, or no image arrow at all stays
 * unproven and never draws. None of these is a light path, so with the P6 check
 * removed every other gate stays green and only G21 goes red.
 * G22: every open polyline is a light path, whatever its role. Beside three traced rays on the
 * review's lens, a polyline from the object base to the image tip (as a "light ray" or a helper),
 * one from the object tip straight to F2, and a hand parallel ray drawn as one polyline bent back
 * to F1 stay unproven and never draw; so does a concave mirror's polyline from the object base to
 * the image tip. Traced rays alone, and a correct hand ray drawn as one polyline, still draw.
 * G23: the compiler draws a vector's direction in place of its end. An object or image arrow kept
 * on the engine anchors with a direction, and a hand incident vector with one, stay unproven and
 * never draw; the same arrows and vector without a direction still draw.
 * G24: an image distance the stem states is the engine's, on the stated side, within 1 percent. On
 * "an image 30 cm behind" a mirror 15 cm from the object, a concave mirror of f 20 cm (image 60 cm
 * behind) stays unproven and f 30 cm draws. The wrong side (30 cm behind on an "in front" stem) and
 * a lens image at 20 cm on a 60 cm stem ("on the other side", or "behind the lens", whose side is
 * not read) stay unproven; the matching figures draw, and 33.3 cm proves 33.33 cm. "6 cm behind the
 * object" names no side of the mirror, so neither kind proves on it (the convex one did).
 * G25: a question reads the facts stated before it asks. "forms a real image ...; where does the
 * image form?" proves the concave mirror and not the convex one, and "so what" and "and how"
 * questions do likewise. A question that states no nature before it asks ("; is the image real?",
 * "Where does ... form a real image", ", and is its image real or virtual?", ", does it form a real
 * image?") declines both kinds.
 * G26: on a virtual image figure the back side of S (the object's side of a lens, behind a mirror) is
 * only the extension, drawn dashed (entity provenance `dashed`) with no arrowhead. Beside traced rays,
 * a hand incident segment ot to S with a solid vector S to it, on a diverging lens and on a convex
 * mirror, stays unproven and never draws; so do a ray from S through it, a solid segment S to it, a
 * solid line through S and it, a dashed segment whose entity kind is vector (drawn with an arrowhead),
 * a chief vector from the centre back to it (or from a real image back to the object), and a
 * magnifier's solid chief segment from the object tip back to its image. Traced rays alone, and a ray
 * or vector leaving S with a dashed segment back to the image or the focus, prove and draw, the
 * extension as dashed lines with no arrow. The shared lens and
 * mirror builders draw their virtual extensions this way, and a diverging lens's parallel ray leaves
 * away from F2 (it ran back toward the object, the review's figure).
 * G27: the image nature the stem states is the engine image's, not only the kind it implies. On "a
 * real, magnified image of an object placed 15 cm" a convex lens of f 20 cm (a virtual image, |m| = 4)
 * stays unproven and never draws, and f 10 cm draws. A concave mirror's "real, diminished image" at
 * 15 cm with f 10 cm (|m| = 2), its "erect, magnified image" with f 10 cm (a real image) and its
 * "real, magnified image" at 30 cm with f 10 cm (|m| = 0.5) stay unproven; f 5 cm, f 30 cm and f 20 cm
 * draw, and a diverging lens's diminished image draws. A stem that asks
 * ("is the image magnified?", "real or virtual") or names a real object fails no figure on nature.
 * G28: a negated nature or side states nothing, and the engine image must not be what it denies. On
 * the review's "A convex lens of focal length 20 cm does not form a real image of an object placed
 * 15 cm from it" the convex figure (virtual, |m| = 4) proves and draws. On "A lens of focal length
 * 20 cm does not form a real image of an object placed 30 cm from it", read as convex from the
 * unsigned focal length, the convex figure (real, |m| = 2) stays unproven and never draws, and so it
 * does on "doesn't", "cannot", "never", "no", "neither ... nor", "is not", "isn't", a negated magnified
 * image and a negated "real, magnified" image. A denial implies no kind, so "A lens does not form a
 * real image" declines. "The image does not form behind the mirror" or "no image forms behind the
 * mirror" refuses a concave mirror's virtual image and proves its real one, and an unnamed mirror or
 * lens with a negated side declines. A figure without the whole denied nature proves and draws; an
 * affirmative "forms a real image" still proves the real image and refuses the virtual one; and "no
 * parallax with the inverted image" still states an inverted image.
 * G29: every line that can show light is a light path (P7, P11), not only one named as a ray or
 * extension. Beside traced rays, the review's line from the object base to the image tip, a vector
 * entity (drawn with an arrowhead) with role "light path", stays unproven and never draws on a lens
 * and on a mirror; so does the same line named light path with no arrowhead, a ray entity, a line
 * named a beam, one whose id names a path, an unmarked one, and an unmarked line along a refracted
 * ray that runs back across the lens. The axis drawn as a line (between two points or along a
 * direction), an unmarked line along it, the element plane, a screen across the axis and an axial
 * ray drawn as a marked line still prove and draw.
 * G30: a choice of nature ("real or virtual", "upright or inverted", "enlarged or diminished") states
 * no nature, but the image distance and side its sentence states still hold. On the review's "An
 * object placed 20 cm from a convex lens forms an image 60 cm on the other side of it; determine its
 * nature (real or virtual)." f 10 cm (image 20 cm away) stays unproven and never draws and f 15 cm
 * draws; so on the other two choices, on an image 60 cm on the object's side (f 10 cm refused, f 20
 * cm drawn) and on a concave mirror's image 30 cm in front (f 5 cm refused, f 10 cm drawn). With no
 * distance or side, a real and a virtual image both prove on each choice, and an unnamed lens declines.
 * G31: what the compiler inks is read, not an operator list (P7, P11, P12). Beside traced rays on the
 * lens of G19 and the concave mirror of G1, the review's polygons ([ot, S, F1] and [ot, F2, ob] on the
 * lens, [ot, S, F] on the mirror; each edge read, the closing one included), parallel_through(ot,
 * axis) named an incident ray or a guide (the parallel ray straight through the lens and through the
 * mirror), perpendicular_through(ot, tr3) and perpendicular_through(ot, object) (the same straight
 * line), a routed connect from the object tip to the focus and a rectangle band at the object tip's
 * height across the element all stay unproven and never draw. Traced rays alone, the mirror plane and a
 * screen at the image drawn as perpendicular_through still prove and draw.
 * G32: signed inline u and f, with no `form`, are the plan's by magnitude. On each row of the review's
 * table (S1, S2, S2b, S3, S3b, S4, S5, S8, S10), where the stem fixes the image by an image distance
 * with no side word, a magnification, an image height, "at the centre of curvature" or "the same
 * size", the wrong figure (signed literals inline, the stem's u declared or nothing declared) fails
 * production validation on its inline objectDistance or focalLength and never draws in either arm;
 * the right figure, signed and inline, draws. An input the plan names no quantity for is never
 * representative and never held to another plan length (G34 reverses 561f40cab): on Greptile's "Draw a
 * convex lens of focal length 10 cm with an object beyond 2F." with a plan of f = 10 cm only, u 30 with
 * f 10 fails on its inline objectDistance and never draws, signed and in magnitude mode, with nothing or
 * f declared, and f 12 fails on focalLength; under a plan that writes the object distance as x = 30 cm,
 * u 20 and u 30 both fail on objectDistance.
 * G33: annotation ink and label leaders are read, not skipped (P12). On the review's figures, extend
 * on a hand incident ray (D1, the lens; D4, the mirror), on the traced parallel ray (D2) and on both
 * traced rays of the magnifier (D6, the planner's recorded use), ghost there (D8), and a connect or
 * circle whose entity writes the labelLeader flag (A4, A5, A7; A6, a flagged segment, is still read
 * by P11) all stay unproven and never draw, as do a connect whose ink takes the id a label leader
 * would have and every other annotation that draws on a traced ray (ghost, frame, sense, spin,
 * hatch, loop, brace, badge, endpoint, equal_tick, parallel_mark). A hand incident ray (D5), a trace,
 * a polarity mark, the magnifier alone (D7) and the traced mirror with its compiler label leader
 * still prove and draw.
 * G32's S3 and S4 plans write the stated size of a real image between bars (|m| = 3, |h_i| = 6 cm),
 * since an unsigned m = 3 or h_i = 6 cm is upright in sign (G35).
 * G34: u and f are each a quantity the plan names in that role (P13), and production holds the inline
 * literals the same way, with no other plan length standing in. Under the review's plans, E1a (u 36,
 * the recorded plan's x_i) and E1b (u 6, its |h_i|) on the recorded stem of f777a2907df5, E2a to E2c
 * (u held to h_i), E3a to E3c (f held to v), E4a, E4b and E5a, E5b (a representative u) are all
 * unproven, fail production on their inline input and never draw, the right values included: a plan
 * that names no object distance or no focal length leaves the figure unproven. No plan, a u in
 * inches, and an id u whose symbol is x_o name no object distance. Under plans that name u and f the
 * right figure of each stem draws and the wrong ones are refused, and a derived u of 13.3 cm holds
 * the engine's 40/3 but not 13.6.
 * G35: the engine image agrees with every image fact the plan states (P14). Under plans that name the
 * figure's u and f, a v, q or d_i of 20 cm where the image is 15 cm on, x_i 30 cm (or 36 cm with the
 * lens at x_l 6 cm) where it is 36 cm on, an x_i with no lens position, m = -1 or an upright m = 0.5
 * for an inverted image of m = -0.5, h_i = -2 cm or an upright 1 cm, an image height with no object
 * height, and a virtual image where the stem or the plan names a screen are unproven and never draw.
 * So are the review's unsigned m = 3 (E4) and h_i = 6 cm (E2) for a real image, and E1's u 36 when
 * the plan also names a second lens's u_2 = 36 cm (P13 passes it; x_i and h_i refuse it). The same
 * figures under agreeing facts, the bars read as sizes (|m| = 0.5, |h_i| = 1 cm), E1 under its
 * recorded x_i, x_l and h_i with u named, E3's real image on the screen and a plan rounded to
 * v = 16.7 cm, m = -0.67 and h_i = -1.33 cm draw; an integer v = 17 cm for 16.67 does not.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileSceneDocument,
  validateSceneDocument,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  explainPlannerOpticsProof as explainUnderPlan,
  selectVerifiedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";
import {
  selectProductionScene,
  validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";

type Doc = SceneDocument & { source: Record<string, unknown> };
type Construction = Doc["constructions"][number];

const failures: string[] = [];
const gates = new Map<string, number>();
function check(gate: string, condition: unknown, message: string): void {
  gates.set(gate, (gates.get(gate) ?? 0) + (condition ? 0 : 1));
  if (!condition) failures.push(`${gate}: ${message}`);
}

const STRICT = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] as const };

/**
 * The plan of a figure's own |u| and |f|, in the unit it writes them in. The stem and figure rules (G1
 * to G33) are read under it, so only the stem and the figure decide them; a check that passes a plan,
 * and every production arm (selection is given the turn's plan), reads the real one. G34 holds u and f
 * to the plan, and G35 the image.
 */
function figurePlan(question: string, document: Doc): TurnPlanV3 {
  const image = document.constructions.find((construction) => construction.operator === "gaussian_image");
  const lengthUnit = typeof image?.inputs.lengthUnit === "string" ? image.inputs.lengthUnit : undefined;
  const read = (value: unknown, unit = lengthUnit): { value: number; unit?: string } | null => {
    if (typeof value === "number") return { value, unit };
    if (typeof value === "string") {
      const quantity = document.quantities.find((item) => item.id === value);
      return quantity ? read(quantity.value, typeof quantity.unit === "string" ? quantity.unit : unit) : null;
    }
    if (value !== null && typeof value === "object" && "value" in value) {
      const wrapper = value as { value: unknown; unit?: unknown };
      return read(wrapper.value, typeof wrapper.unit === "string" ? wrapper.unit : unit);
    }
    return null;
  };
  const givens = (["objectDistance", "focalLength"] as const).flatMap((key) => {
    const found = read(image?.inputs[key]);
    const symbol = key === "objectDistance" ? "u" : "f";
    return found ? [{ id: symbol, symbol, value: Math.abs(found.value), ...(found.unit ? { unit: found.unit } : {}), provenance: "given" as const }] : [];
  });
  return plan(question, givens as TurnPlanV3["givens"], [], []);
}
const explainPlannerOpticsProof = (question: string, document: Doc, turnPlan: unknown = figurePlan(question, document)) =>
  explainUnderPlan(question, document, turnPlan);

const ent = (id: string, kind: string, role: string, label?: string) => ({ id, kind, role, ...(label ? { label } : {}) });
/** A virtual image's back-extension as the engine draws one: dashed construction ink (G26). */
const dashedWhen = <T extends object>(virtual: boolean, entity: T): T => virtual ? { ...entity, provenance: { dashed: true, strokeRole: "construction" } } : entity;
const pt = (id: string, x: number, y: number): Construction =>
  ({ id: `c_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
const fatal = (id: string, predicate: string, entities: string[], expected: unknown = true) =>
  ({ id, predicate, entities, expected, severity: "fatal" as const });

function plan(question: string, givens: TurnPlanV3["givens"], derived: TurnPlanV3["derived"], lawIds: string[]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, givens,
    unknowns: derived.map((item) => ({ id: item.id, symbol: item.symbol, unit: item.unit })),
    derived, qualitativeClaims: [], lawIds, assumptions: [], visualRequirement: "required",
  };
}

/**
 * The passing quantity form: plan-matching unsigned quantities, signed
 * Cartesian literals inline in the operator inputs (u < 0, light along +axis).
 */
function mirrorDoc(question: string, opts: {
  u: number; f: number; h: number; kind: "concave" | "convex"; quantities: Array<{ id: string; symbol: string; value: number }>;
}): Doc {
  const virtual = opts.kind === "convex";
  const signedF = opts.kind === "concave" ? -opts.f : opts.f;
  // Behind the mirror (v > 0) the image is virtual, a concave mirror's inside F included.
  const behind = signedF * -opts.u / (-opts.u - signedF) > 0;
  const entities = [
    ent("P", "point", "pole", "P"), ent("axis_l", "point", "construction helper"), ent("axis_r", "point", "construction helper"),
    ent("axis", "line", "principal axis"), ent("mirror", "arc", `${opts.kind} mirror`, "M"),
    ent("ob", "point", "object foot", "O"), ent("ot", "point", "construction helper"),
    ent("ib", "point", "image foot", "I"), ent("it", "point", "construction helper"),
    ent("F", "point", "focus", "F"), ent("lp", "line", "mirror plane"), ent("M1", "point", "ray hit"), ent("M2", "point", "ray hit"),
    ent("object", "vector", "object"), ent("image", "vector", virtual ? "virtual image" : "real image"),
    ent("ray1_in", "segment", "incident ray parallel to the axis"),
    dashedWhen(behind, ent("ray1_out", "segment", virtual ? "reflected ray, extended back (paraxial)" : "reflected ray through F (paraxial)")),
    ent("ray2_in", "segment", "incident ray toward the focus"),
    dashedWhen(behind, ent("ray2_out", "segment", virtual ? "reflected ray, extended back (paraxial)" : "reflected ray parallel to the axis (paraxial)")),
  ];
  const constructions: Construction[] = [
    pt("P", 0, 0), pt("axis_l", -80, 0), pt("axis_r", 40, 0),
    { id: "c_axis", operator: "line", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] },
    { id: "c_img", operator: "gaussian_image", inputs: { kind: "mirror", center: "P", axis: "axis", objectDistance: -opts.u, focalLength: signedF, objectHeight: opts.h, displayScale: 1, lengthUnit: "cm" }, outputs: ["ob", "ot", "ib", "it"] },
    { id: "c_F", operator: "optical_focus", inputs: { kind: "mirror", center: "P", axis: "axis", focalLength: signedF, displayScale: 1, lengthUnit: "cm" }, outputs: ["F"] },
    { id: "c_mirror", operator: "spherical_surface", inputs: { vertex: "P", axis: "axis", halfHeight: 9, signedRadius: 2 * signedF }, outputs: ["mirror"] },
    { id: "c_lp", operator: "perpendicular_through", inputs: { through: "P", line: "axis" }, outputs: ["lp"] },
    { id: "c_M1", operator: "project", inputs: { point: "ot", line: "lp" }, outputs: ["M1"] },
    { id: "c_M2", operator: "project", inputs: { point: "it", line: "lp" }, outputs: ["M2"] },
    { id: "c_object", operator: "vector", inputs: { start: "ob", end: "ot" }, outputs: ["object"] },
    { id: "c_image", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["image"] },
    { id: "c_r1i", operator: "segment", inputs: { start: "ot", end: "M1" }, outputs: ["ray1_in"] },
    { id: "c_r1o", operator: "segment", inputs: { start: "M1", end: "it", approximation: "paraxial" }, outputs: ["ray1_out"] },
    { id: "c_r2i", operator: "segment", inputs: { start: "ot", end: "M2" }, outputs: ["ray2_in"] },
    { id: "c_r2o", operator: "segment", inputs: { start: "M2", end: "it", approximation: "paraxial" }, outputs: ["ray2_out"] },
  ];
  return {
    schemaVersion: "scene-document/v2",
    source: { question },
    visualDecision: { mode: "scene", reason: "ray diagram" },
    quantities: opts.quantities.map((quantity) => ({ ...quantity, unit: "cm" })),
    entities, constructions, relations: [], annotations: [],
    assertions: [
      fatal("conv", "converges", ["ray1_out", "ray2_out", "it"]),
      fatal("par1", "parallel", ["ray1_in", "axis"]),
      fatal("par2", "parallel", ["ray2_out", "axis"]),
      fatal("lF", "label_attached", ["F"]), fatal("lP", "label_attached", ["P"]),
    ],
    requiredEntityIds: ["axis", "P", "F", "mirror", "ob", "object", "ib", "image", "ot", "it", "ray1_in", "ray2_in", "ray1_out", "ray2_out"],
    revealGroups: [
      { id: "setup", entityIds: ["axis", "P", "F", "mirror", "ob", "ot", "object"], dependsOn: [], narrationCue: "the mirror, its focus and the object" },
      { id: "rays", entityIds: ["ray1_in", "ray2_in", "ray1_out", "ray2_out"], dependsOn: ["setup"], narrationCue: "two principal rays" },
      { id: "image_group", entityIds: ["ib", "it", "image"], dependsOn: ["rays"], narrationCue: "the image" },
    ],
    teachingTimeline: [],
  } as unknown as Doc;
}

function lensDoc(question: string, opts: { u: number; f: number; h: number }): Doc {
  // A virtual image (v < 0) is met only by dashed back-extensions; a diverging lens sends its
  // parallel ray on away from F2, through F2 turned half a turn about the hit.
  const virtual = opts.f * -opts.u / (opts.f - opts.u) < 0;
  const diverging = opts.f < 0;
  const entities = [
    ent("O", "point", "optical centre", "O"), ent("axis_l", "point", "construction helper"), ent("axis_r", "point", "construction helper"),
    ent("axis", "line", "principal axis"), ent("lens", "polygon", "convex lens", "L"),
    ent("ob", "point", "object foot", "A"), ent("ot", "point", "construction helper"),
    ent("ib", "point", "image foot", "I"), ent("it", "point", "construction helper"),
    ent("F1", "point", "first focus", "F1"), ent("F2", "point", "second focus", "F2"), ent("lp", "line", "lens plane"), ent("L1", "point", "ray hit"),
    ent("object", "vector", "object"), ent("image", "vector", "virtual image"),
    ent("ray1_in", "segment", "ray parallel to the axis"),
    ent("ray1_out", "ray", "refracted ray through F2 (paraxial)"),
    ent("ray2", "ray", "undeviated ray through the optical centre"),
    dashedWhen(virtual, ent("ext1", "segment", "virtual extension")), dashedWhen(virtual, ent("ext2", "segment", "virtual extension")),
    ...(diverging ? [ent("F2away", "point", "construction helper")] : []),
  ];
  const constructions: Construction[] = [
    pt("O", 0, 0), pt("axis_l", -45, 0), pt("axis_r", 40, 0),
    { id: "c_axis", operator: "line", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] },
    { id: "c_img", operator: "gaussian_image", inputs: { kind: "lens", center: "O", axis: "axis", objectDistance: -opts.u, focalLength: opts.f, objectHeight: opts.h, displayScale: 1, lengthUnit: "cm" }, outputs: ["ob", "ot", "ib", "it"] },
    { id: "c_F", operator: "optical_focus", inputs: { kind: "lens", center: "O", axis: "axis", focalLength: opts.f, displayScale: 1, lengthUnit: "cm" }, outputs: ["F1", "F2"] },
    { id: "c_lens", operator: "lens_section", inputs: { center: "O", axis: "axis", radius1: 19, radius2: -19, halfHeight: 8 }, outputs: ["lens"] },
    { id: "c_lp", operator: "perpendicular_through", inputs: { through: "O", line: "axis" }, outputs: ["lp"] },
    { id: "c_L1", operator: "project", inputs: { point: "ot", line: "lp" }, outputs: ["L1"] },
    { id: "c_object", operator: "vector", inputs: { start: "ob", end: "ot" }, outputs: ["object"] },
    { id: "c_image", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["image"] },
    { id: "c_r1i", operator: "segment", inputs: { start: "ot", end: "L1" }, outputs: ["ray1_in"] },
    ...(diverging ? [{ id: "c_F2away", operator: "rotate", inputs: { point: "F2", center: "L1", angle: 180, angleUnit: "degrees" }, outputs: ["F2away"] }] : []),
    { id: "c_r1o", operator: "ray", inputs: { start: "L1", end: diverging ? "F2away" : "F2", approximation: "paraxial" }, outputs: ["ray1_out"] },
    { id: "c_r2", operator: "ray", inputs: { start: "ot", end: "O" }, outputs: ["ray2"] },
    { id: "c_e1", operator: "segment", inputs: { start: "L1", end: "it" }, outputs: ["ext1"] },
    { id: "c_e2", operator: "segment", inputs: { start: "O", end: "it" }, outputs: ["ext2"] },
  ];
  return {
    schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "ray diagram" },
    quantities: [{ id: "u", symbol: "u", value: opts.u, unit: "cm" }, { id: "f", symbol: "f", value: Math.abs(opts.f), unit: "cm" }],
    entities, constructions, relations: [], annotations: [],
    assertions: [fatal("conv", "converges", ["ext1", "ext2", "it"]), fatal("par1", "parallel", ["ray1_in", "axis"]), fatal("lF", "label_attached", ["F2"])],
    requiredEntityIds: entities.filter((entity) => !["axis_l", "axis_r", "lp", "L1", "F2away"].includes(entity.id)).map((entity) => entity.id),
    revealGroups: [
      { id: "setup", entityIds: ["axis", "O", "lens", "F1", "F2", "ob", "ot", "object"], dependsOn: [], narrationCue: "lens, foci, object" },
      { id: "rays", entityIds: ["ray1_in", "ray1_out", "ray2", "ext1", "ext2"], dependsOn: ["setup"], narrationCue: "rays" },
      { id: "image_group", entityIds: ["ib", "it", "image"], dependsOn: ["rays"], narrationCue: "image" },
    ],
    teachingTimeline: [],
  } as unknown as Doc;
}

/**
 * A synthetic look-alike of the recorded wrong figure: an `arc` mirror with
 * model-authored points and the image drawn at half its true distance
 * (5.4 cm instead of 10.8 cm). It proves only a self-asserted P-F/P-C ratio.
 */
function freePointConvexMirror(question: string): Doc {
  const entities = [
    ent("P", "point", "pole", "P"), ent("axis_l", "point", "construction helper"), ent("axis_r", "point", "construction helper"),
    ent("axis", "line", "principal axis"), ent("C", "point", "centre of curvature", "C"), ent("F", "point", "focus", "F"),
    ent("mirror", "arc", "convex mirror", "M"),
    ent("ob", "point", "object foot", "O"), ent("ot", "point", "construction helper"),
    ent("ib", "point", "image foot", "I"), ent("it", "point", "construction helper"),
    ent("H1", "point", "ray hit"), ent("H2", "point", "ray hit"),
    ent("object", "vector", "object"), ent("image", "vector", "virtual image"),
    ent("ray1_in", "segment", "incident ray parallel to the axis"), ent("ext1", "segment", "virtual extension"),
    ent("ray2_in", "segment", "incident ray toward the centre"), ent("ext2", "segment", "virtual extension"),
  ];
  const constructions: Construction[] = [
    pt("P", 0, 0), pt("axis_l", -40, 0), pt("axis_r", 45, 0), pt("C", 36, 0), pt("F", 18, 0),
    pt("ob", -27, 0), pt("ot", -27, 4.5), pt("ib", 5.4, 0), pt("it", 5.4, 1.5), pt("H1", 0, 4.5), pt("H2", 0, 2.2),
    { id: "c_axis", operator: "line", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] },
    { id: "c_mirror", operator: "arc", inputs: { center: "C", radius: 36, startAngle: 165, endAngle: 195, angleUnit: "degrees" }, outputs: ["mirror"] },
    { id: "c_object", operator: "vector", inputs: { start: "ob", end: "ot" }, outputs: ["object"] },
    { id: "c_image", operator: "vector", inputs: { start: "ib", end: "it" }, outputs: ["image"] },
    { id: "c_r1i", operator: "segment", inputs: { start: "ot", end: "H1" }, outputs: ["ray1_in"] },
    { id: "c_e1", operator: "segment", inputs: { start: "H1", end: "it" }, outputs: ["ext1"] },
    { id: "c_r2i", operator: "segment", inputs: { start: "ot", end: "H2" }, outputs: ["ray2_in"] },
    { id: "c_e2", operator: "segment", inputs: { start: "H2", end: "it" }, outputs: ["ext2"] },
  ];
  return {
    schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "ray diagram" },
    quantities: [{ id: "u", symbol: "u", value: 27, unit: "cm" }, { id: "R", symbol: "R", value: 36, unit: "cm" }],
    entities, constructions, relations: [], annotations: [],
    assertions: [
      fatal("ratio", "distance_ratio", ["P", "F", "P", "C"], 0.5),
      fatal("conv", "converges", ["ext1", "ext2", "it"]),
      fatal("par1", "parallel", ["ray1_in", "axis"]),
    ],
    requiredEntityIds: entities.filter((entity) => !["axis_l", "axis_r"].includes(entity.id)).map((entity) => entity.id),
    revealGroups: [
      { id: "setup", entityIds: ["axis", "P", "C", "F", "mirror", "ob", "ot", "object"], dependsOn: [], narrationCue: "mirror and object" },
      { id: "rays", entityIds: ["H1", "H2", "ray1_in", "ext1", "ray2_in", "ext2"], dependsOn: ["setup"], narrationCue: "rays" },
      { id: "image_group", entityIds: ["ib", "it", "image"], dependsOn: ["rays"], narrationCue: "image" },
    ],
    teachingTimeline: [],
  } as unknown as Doc;
}

function compiled(document: Doc) {
  const normalized = validateSceneDocument(document).document;
  const result = compileSceneDocument(normalized ?? document);
  const fatalIssues = (result.report?.issues ?? [])
    .filter((issue) => issue.severity === "fatal" || issue.code === "assertion_failed")
    .map((issue) => `${issue.code}: ${issue.message}`);
  return { normalized, result, fatalIssues };
}

function stamped(document: Doc, archetype: string): Doc {
  const copy = structuredClone(document);
  copy.source = { ...copy.source, archetype };
  return copy;
}

/** Selected through the production decision in the strict and the current arm. */
function production(question: string, turnPlan: TurnPlanV3, document: Doc) {
  const candidateValidation = validateProductionSceneCandidate({
    candidate: structuredClone(document) as unknown as Record<string, unknown>, question, turnPlan,
  });
  const strict = selectProductionScene({ question, turnPlan, problemIR: null, candidateValidation, policy: STRICT });
  const current = selectProductionScene({ question, turnPlan, problemIR: null, candidateValidation });
  return { candidateValidation, strict, current };
}

function expectDrawnAsPlanner(gate: string, name: string, question: string, turnPlan: TurnPlanV3, document: Doc): void {
  const { fatalIssues, result } = compiled(document);
  check(gate, result.ok && result.report.valid && fatalIssues.length === 0,
    `${name} must compile clean before selection (${fatalIssues.slice(0, 3).join("; ")})`);
  const { candidateValidation, strict, current } = production(question, turnPlan, document);
  const errors = candidateValidation.valid ? [] : candidateValidation.errors
    .filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
  check(gate, candidateValidation.valid, `${name} must pass production candidate validation (${errors.join(", ")})`);
  for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
    check(gate, selection.representation?.figureSource === "planner",
      `${name} must draw as the planner figure in the ${arm} arm; got ${selection.representation?.figureSource ?? "nothing"} ` +
      `(attempted ${selection.attemptedRepresentation?.figureSource ?? "-"}: ${selection.reason})`);
  }
}

function expectNeverPlanner(gate: string, name: string, question: string, turnPlan: TurnPlanV3, document: Doc): void {
  const { fatalIssues, result } = compiled(document);
  // The rejection must be the proof's, not the compiler's.
  check(gate, result.ok && result.renderScene && result.report.valid && fatalIssues.length === 0,
    `${name} must compile clean (${fatalIssues.slice(0, 3).join("; ")})`);
  if (!result.ok || !result.renderScene) return;
  for (const preferPlanner of [true, false]) {
    const selected = selectVerifiedRepresentation({
      question, turnPlan, preferPlanner,
      exact: { sceneDocument: document, renderScene: result.renderScene, validationReport: result.report },
    });
    check(gate, selected.figureSource !== "planner",
      `${name} must never be selected as a planner figure (preferPlanner=${preferPlanner}); got ${selected.figureSource}: ${selected.reason}`);
  }
  const { strict, current } = production(question, turnPlan, document);
  for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
    check(gate, selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
      `${name} must never be drawn as a planner figure in the ${arm} arm; got ${selection.attemptedRepresentation?.figureSource}`);
  }
}

/** A figure whose element disagrees with itself is refused by the engine, before the proof, and never drawn. */
function expectEngineRefuses(gate: string, name: string, question: string, turnPlan: TurnPlanV3, document: Doc): void {
  const { fatalIssues, result } = compiled(document);
  check(gate, !result.ok && fatalIssues.some((issue) => issue.startsWith("optical_element_focal_length_disagrees:")),
    `${name} must fail closed in the engine with optical_element_focal_length_disagrees; got ${fatalIssues.slice(0, 3).join("; ") || "a clean compile"}`);
  const { strict, current } = production(question, turnPlan, document);
  for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
    check(gate, selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
      `${name} must never be drawn as a planner figure in the ${arm} arm; got ${selection.attemptedRepresentation?.figureSource}`);
  }
}

// ---- G1: concave mirror, real image, inline signed literals ----
const qMirror = "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.";
const mirrorPlan = plan(qMirror, [
  { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "f = 15 cm" },
  { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given", sourceText: "object at 20 cm" },
], [{ id: "v", symbol: "v", value: 60, unit: "cm", provenance: "derived" }], ["mirror_formula"]);
const mirrorQuantities = [{ id: "u", symbol: "u", value: 20 }, { id: "f", symbol: "f", value: 15 }];
const goodMirror = mirrorDoc(qMirror, { u: 20, f: 15, h: 2, kind: "concave", quantities: mirrorQuantities });
expectDrawnAsPlanner("G1", "the gaussian-proven concave mirror", qMirror, mirrorPlan, goodMirror);
expectDrawnAsPlanner("G1", "the gaussian-proven concave mirror with a forged archetype stamp", qMirror, mirrorPlan,
  stamped(goodMirror, "spherical_mirror"));

// ---- G1b: convex mirror, virtual image, f = R/2 from the stem ----
const qConvex = "A car's convex side mirror has a radius of curvature of 36 cm. A toy 4.5 cm tall stands upright on the axis 27 cm in front of it. Locate the image, find its height, and say whether it is real or virtual, upright or inverted.";
const convexPlan = plan(qConvex, [
  { id: "R", symbol: "R", value: 36, unit: "cm", provenance: "given", sourceText: "radius of curvature of 36 cm" },
  { id: "h", symbol: "h", value: 4.5, unit: "cm", provenance: "given", sourceText: "4.5 cm tall" },
  { id: "u", symbol: "u", value: 27, unit: "cm", provenance: "given", sourceText: "27 cm in front of it" },
], [
  { id: "f", symbol: "f", value: 18, unit: "cm", provenance: "derived" },
  { id: "v", symbol: "v", value: 10.8, unit: "cm", provenance: "derived" },
], ["mirror_formula"]);
const goodConvex = mirrorDoc(qConvex, { u: 27, f: 18, h: 4.5, kind: "convex", quantities: [{ id: "u", symbol: "u", value: 27 }, { id: "f", symbol: "f", value: 18 }] });
expectDrawnAsPlanner("G1", "the gaussian-proven convex car mirror (f = R/2)", qConvex, convexPlan, goodConvex);

// ---- G2: convex lens, virtual image (u < f), lens_section ----
const qLens = "A convex lens of focal length 15 cm has an object placed 10 cm from it. Draw the ray diagram and describe the image.";
const lensPlan = plan(qLens, [
  { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "focal length 15 cm" },
  { id: "u", symbol: "u", value: 10, unit: "cm", provenance: "given", sourceText: "placed 10 cm" },
], [{ id: "v", symbol: "v", value: 30, unit: "cm", provenance: "derived" }], ["lens_formula"]);
const goodLens = lensDoc(qLens, { u: 10, f: 15, h: 2 });
expectDrawnAsPlanner("G2", "the gaussian-proven convex lens", qLens, lensPlan, goodLens);
expectDrawnAsPlanner("G2", "the gaussian-proven convex lens with a forged archetype stamp", qLens, lensPlan,
  stamped(goodLens, "thin_lens"));

// ---- G3: compiled-clean wrong figures never become planner figures ----
const wrongFocal = mirrorDoc(qMirror, { u: 20, f: 10, h: 2, kind: "concave", quantities: mirrorQuantities });
const wrongKindLens = lensDoc(qLens, { u: 10, f: -15, h: 2 });
const wrongSenseMirror = structuredClone(goodMirror);
for (const construction of wrongSenseMirror.constructions) {
  if (construction.operator === "spherical_surface") construction.inputs.signedRadius = 30;
}
const inventedHit = structuredClone(goodMirror);
inventedHit.constructions = inventedHit.constructions.map((construction) => construction.id === "c_M2"
  ? pt("M2", 0, -3) : construction);
inventedHit.assertions = inventedHit.assertions.filter((assertion) => assertion.id !== "par2");
const freePoint = freePointConvexMirror(qConvex);
const wrongFigures: Array<[string, string, TurnPlanV3, Doc, string]> = [
  ["a mirror with f = 10 on an f = 15 stem", qMirror, mirrorPlan, wrongFocal, "spherical_mirror"],
  ["a concave lens (f = -15) on a convex lens stem", qLens, lensPlan, wrongKindLens, "thin_lens"],
  ["a mirror whose ray bends at an invented hit point", qMirror, mirrorPlan, inventedHit, "spherical_mirror"],
  ["a free-point arc mirror with the image at the wrong distance", qConvex, convexPlan, freePoint, "spherical_mirror"],
];
for (const [name, question, turnPlan, document, archetype] of wrongFigures) {
  expectNeverPlanner("G3", name, question, turnPlan, document);
  expectNeverPlanner("G3", `${name}, with a forged archetype stamp`, question, turnPlan, stamped(document, archetype));
}
expectEngineRefuses("G3", "a mirror drawn convex on a concave mirror stem", qMirror, mirrorPlan, wrongSenseMirror);
expectEngineRefuses("G3", "a mirror drawn convex on a concave mirror stem, with a forged archetype stamp", qMirror, mirrorPlan, stamped(wrongSenseMirror, "spherical_mirror"));

// ---- G1a: a stem with no numbers proves no unitless figure of representative values ----
const unitless = (document: Doc): Doc => {
  const copy = structuredClone(document);
  for (const construction of copy.constructions) {
    if (construction.operator === "gaussian_image" || construction.operator === "optical_focus") delete construction.inputs.lengthUnit;
  }
  return copy;
};
const qHowLens = "How does a convex lens form an image?";
const howLens = unitless(lensDoc(qHowLens, { u: 4, f: 2, h: 1 }));
howLens.quantities = [];
for (const [name, document] of [
  ["a unitless convex lens (u = -4, f = 2)", howLens],
  ["the same unitless lens in magnitude mode", (() => {
    const copy = structuredClone(howLens);
    for (const construction of copy.constructions) {
      if (construction.operator === "gaussian_image") Object.assign(construction.inputs, { objectDistance: 4, form: "converging" });
      if (construction.operator === "optical_focus") Object.assign(construction.inputs, { form: "converging" });
    }
    return copy;
  })()],
] as const) {
  const { fatalIssues, result } = compiled(document);
  check("G1a", result.ok && fatalIssues.length === 0, `${name} must compile clean (${fatalIssues.slice(0, 3).join("; ")})`);
  // Its own plan names no length, so u and f are the figure's own (G34); nor can a plan name them without a unit.
  const proof = explainPlannerOpticsProof(qHowLens, document, plan(qHowLens, [], [], ["lens_formula"]));
  check("G1a", proof.proof === "unproven" && /^gaussian_image lengthUnit must be cm, m or mm$/.test(proof.reason),
    `${name} on "${qHowLens}" must be unproven; got ${proof.proof}: ${proof.reason}`);
  expectNeverPlanner("G1a", `${name} on "${qHowLens}"`, qHowLens, plan(qHowLens, [], [], ["lens_formula"]), document);
}

// ---- G1b: a stem with numbers still needs a metric unit ----
{
  const proof = explainPlannerOpticsProof(qLens, unitless(goodLens));
  check("G1b", proof.proof === "unproven" && /lengthUnit/.test(proof.reason),
    `the stated-number lens stem with lengthUnit omitted must stay unproven on the unit rule; got ${proof.proof}: ${proof.reason}`);
}

// ---- G2c: magnitude inputs on the plan's own ids draw ----
function magnitudeMirror(form: "converging" | "diverging", focal: string | number = "f"): Doc {
  const copy = structuredClone(goodMirror);
  for (const construction of copy.constructions) {
    if (construction.operator === "gaussian_image") Object.assign(construction.inputs, { objectDistance: "u", focalLength: focal, form, objectSide: "real" });
    if (construction.operator === "optical_focus") Object.assign(construction.inputs, { focalLength: focal, form });
  }
  return copy;
}
const quantityCodes = (document: Doc): string[] => {
  const validation = validateProductionSceneCandidate({
    candidate: structuredClone(document) as unknown as Record<string, unknown>, question: qMirror, turnPlan: mirrorPlan,
  });
  return validation.errors.map((issue) => issue.code);
};
expectDrawnAsPlanner("G2c", "the concave mirror in magnitude mode on plan ids u and f", qMirror, mirrorPlan, magnitudeMirror("converging"));
check("G2c", !quantityCodes(magnitudeMirror("converging")).some((code) => code.startsWith("scene_quantity")),
  `the magnitude mirror must raise no scene_quantity issue; got ${quantityCodes(magnitudeMirror("converging")).join(", ")}`);

// ---- G2d: a contradicting form or an unsupported literal never draws ----
expectEngineRefuses("G2d", "the concave mirror stem drawn with form diverging", qMirror, mirrorPlan, magnitudeMirror("diverging"));
expectEngineRefuses("G2d", "the magnitude mirror with a literal f = 10", qMirror, mirrorPlan, magnitudeMirror("converging", 10));
check("G2d", quantityCodes(magnitudeMirror("converging", 10)).includes("scene_quantity_unverified"),
  `a magnitude literal f = 10 must fail scene_quantity_unverified; got ${quantityCodes(magnitudeMirror("converging", 10)).join(", ")}`);
check("G2d", !quantityCodes(magnitudeMirror("converging", 15)).some((code) => code.startsWith("scene_quantity")),
  `a magnitude literal equal to the plan's f = 15 must pass agreement; got ${quantityCodes(magnitudeMirror("converging", 15)).join(", ")}`);

// ---- G6a: a structural failure still reports plan agreement ----
{
  const bad = structuredClone(goodMirror);
  bad.entities = bad.entities.map((entity) => entity.id === "F" ? { ...entity, label: "F″" } : entity);
  bad.quantities = bad.quantities.map((quantity) => quantity.id === "u" ? { ...quantity, value: -20 } : quantity);
  const codes = quantityCodes(bad);
  check("G6a", codes.includes("invalid_optical_focus_label") && codes.includes("scene_quantity_mismatch"),
    `a bad focus label and a signed u under the plan's id must both be reported in one validation; got ${codes.join(", ")}`);
}

// ---- G5a/G5b: the gaussian exemplars teach the shape the engine and proof accept ----
interface OpticsExemplar { name: string; question: string; figureKind: string; document: Doc }
const exemplarRoot = resolve(process.cwd(), "../../data/diagram-eval/v1/exemplars");
const sourceExemplars: OpticsExemplar[] = ["physics", "maths", "chemistry"].flatMap((subject) =>
  readdirSync(resolve(exemplarRoot, subject)).filter((file) => file.endsWith(".json")).map((file) => {
    const value = JSON.parse(readFileSync(resolve(exemplarRoot, subject, file), "utf8")) as {
      question: string; figure_kind: string; sceneDocument: Doc;
    };
    return { name: `${subject}/${file.replace(/\.json$/, "")}`, question: value.question, figureKind: value.figure_kind, document: value.sceneDocument };
  }));
const libraryExemplars: OpticsExemplar[] = readFileSync(resolve(exemplarRoot, "_library.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id: string; question: string | null; figureKind: string; document: Doc })
  .map((entry) => ({ name: `library ${entry.id}`, question: entry.question ?? "", figureKind: entry.figureKind, document: entry.document }));
const isGaussianExemplar = (exemplar: OpticsExemplar) => exemplar.figureKind === "ray_optics" &&
  exemplar.document.constructions.some((construction) => construction.operator === "gaussian_image");
const OPTICS_OPERATORS = new Set(["gaussian_image", "optical_focus"]);
// The compiler's own test for numeric ink: a number not glued to an identifier (F1 is a name).
const numericClaim = (text: unknown) => typeof text === "string" &&
  /(?<![A-Za-z0-9_])[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![A-Za-z0-9_])/.test(text);

/** G5a: plan ids with form on both operators, no dimension, numbers only on the optical points. */
function gaussianShapeProblems(document: Doc): string[] {
  const problems: string[] = [];
  const quantityIds = new Set(document.quantities.map((quantity) => quantity.id));
  const optical = document.constructions.filter((construction) => OPTICS_OPERATORS.has(construction.operator));
  for (const construction of optical) {
    const keys = construction.operator === "gaussian_image" ? ["objectDistance", "focalLength", "objectHeight"] : ["focalLength"];
    if (construction.inputs.form !== "converging" && construction.inputs.form !== "diverging") {
      problems.push(`${construction.operator} ${construction.id} has no form`);
    }
    for (const key of keys) {
      const value = construction.inputs[key];
      if (typeof value !== "string" || !quantityIds.has(value)) {
        problems.push(`${construction.operator} ${construction.id} ${key} is ${JSON.stringify(value)}, not a quantity id`);
      }
    }
  }
  const opticalOutputs = new Set(optical.flatMap((construction) => construction.outputs));
  for (const construction of document.constructions) {
    if (construction.operator === "dimension") problems.push(`dimension ${construction.outputs.join(",")} on a gaussian figure`);
  }
  for (const entity of document.entities) {
    if (entity.kind === "dimension") problems.push(`dimension entity ${entity.id} on a gaussian figure`);
    if (numericClaim(entity.label) && !opticalOutputs.has(entity.id)) {
      problems.push(`numeric label "${entity.label}" on ${entity.id}, not an optical point`);
    }
  }
  for (const annotation of document.annotations) {
    const claim = numericClaim(annotation.text) || annotation.quantityId !== undefined;
    if (claim && !annotation.targetIds.every((id) => opticalOutputs.has(id))) {
      problems.push(`numeric annotation "${annotation.text}" on ${annotation.targetIds.join(",")}, not an optical point`);
    }
  }
  return problems;
}

const gaussianSources = sourceExemplars.filter(isGaussianExemplar);
const gaussianLibrary = libraryExemplars.filter(isGaussianExemplar);
check("G5a", gaussianSources.length >= 4, `expected at least the four lens and mirror exemplars; found ${gaussianSources.length}`);
check("G5a", gaussianLibrary.length === gaussianSources.length,
  `the built library must carry every gaussian exemplar (${gaussianLibrary.length} of ${gaussianSources.length})`);
for (const exemplar of [...gaussianSources, ...gaussianLibrary]) {
  const problems = gaussianShapeProblems(exemplar.document);
  check("G5a", problems.length === 0, `${exemplar.name}: ${problems.join("; ")}`);
}

/**
 * Each stem's plan as the planner states it: unsigned givens, unsigned derived values. An image height
 * is a size written between bars (|h_i|), as the recorded plan of cf495e02e4dd writes it: P14 reads an
 * unsigned h_i = 12 cm as upright, and the exemplars label the size (h_i=12 cm).
 */
type PlanRow = [id: string, value: number, sourceText?: string];
const EXEMPLAR_PLANS: Record<string, { givens: PlanRow[]; derived: PlanRow[]; law: string }> = {
  "physics/reflection-and-spherical-mirrors--1": {
    givens: [["h", 6, "6 cm tall"], ["u", 21, "21 cm in front"], ["f", 14, "focal length 14 cm"]],
    derived: [["v", 42], ["h_i", 12]], law: "mirror_formula",
  },
  "physics/reflection-and-spherical-mirrors--2": {
    givens: [["R", 66, "radius of curvature of 66 cm"], ["h", 20, "20 cm tall"], ["u", 22, "22 cm in front"]],
    derived: [["f", 33], ["v", 13.2], ["h_i", 12]], law: "mirror_formula",
  },
  "physics/thin-lens-rays--2": {
    givens: [["h", 7, "7 cm tall"], ["u", 24, "24 cm from"], ["f", 16, "focal length 16 cm"]],
    derived: [["v", 48], ["h_i", 14]], law: "lens_formula",
  },
  "physics/thin-lens-rays--3": {
    givens: [["h", 5, "5 cm tall"], ["u", 27, "27 cm from"], ["f", 18, "focal length 18 cm"]],
    derived: [["v", 10.8], ["h_i", 2]], law: "lens_formula",
  },
};
for (const exemplar of gaussianSources) {
  const rows = EXEMPLAR_PLANS[exemplar.name];
  check("G5b", rows, `${exemplar.name} has no unsigned plan in EXEMPLAR_PLANS; add one built from its stem`);
  if (!rows) continue;
  const turnPlan = plan(exemplar.question,
    rows.givens.map(([id, value, sourceText]) => ({ id, symbol: id, value, unit: "cm", provenance: "given" as const, sourceText: sourceText ?? id })),
    rows.derived.map(([id, value]) => ({ id, symbol: id === "h_i" ? "|h_i|" : id, value, unit: "cm", provenance: "derived" as const })),
    [rows.law]);
  const planIds = new Set([...rows.givens, ...rows.derived].map(([id]) => id));
  const unplanned = exemplar.document.quantities.filter((quantity) => !planIds.has(quantity.id)).map((quantity) => quantity.id);
  check("G5b", unplanned.length === 0, `${exemplar.name} declares quantities the plan does not state: ${unplanned.join(", ")}`);
  const proof = explainPlannerOpticsProof(exemplar.question, exemplar.document);
  check("G5b", proof.proof === "proven", `${exemplar.name} must be proven; got ${proof.proof}: ${proof.reason}`);
  expectDrawnAsPlanner("G5b", exemplar.name, exemplar.question, turnPlan, exemplar.document);
  // A label the production path prunes teaches the planner ink that vanishes.
  const validation = validateProductionSceneCandidate({
    candidate: structuredClone(exemplar.document) as unknown as Record<string, unknown>, question: exemplar.question, turnPlan,
  });
  if (validation.valid && validation.value) {
    const kept = validation.value.document;
    const lostLabels = exemplar.document.entities.filter((entity) => entity.label &&
      kept.entities.find((candidate) => candidate.id === entity.id)?.label !== entity.label).map((entity) => entity.label);
    const lostAnnotations = exemplar.document.annotations.filter((annotation) =>
      !kept.annotations.some((candidate) => candidate.id === annotation.id && candidate.text === annotation.text))
      .map((annotation) => annotation.text);
    check("G5b", lostLabels.length + lostAnnotations.length === 0,
      `${exemplar.name} loses labels to pruning under its plan: ${[...lostLabels, ...lostAnnotations].join(", ")}`);
  }
}

/** Every fatal validation issue as `code@path`. */
const validationIssues = (question: string, turnPlan: TurnPlanV3, document: Doc): string[] => {
  const validation = validateProductionSceneCandidate({
    candidate: structuredClone(document) as unknown as Record<string, unknown>, question, turnPlan,
  });
  return validation.valid ? [] : validation.errors.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}@${issue.path}`);
};
const quantityIssues = (question: string, turnPlan: TurnPlanV3, document: Doc): string[] =>
  validationIssues(question, turnPlan, document).filter((issue) => issue.startsWith("scene_quantity"));
function withInputs(document: Doc, edits: Record<string, Record<string, unknown>>): Doc {
  const copy = structuredClone(document);
  for (const construction of copy.constructions) {
    const edit = edits[construction.operator];
    if (edit) Object.assign(construction.inputs, edit);
  }
  return copy;
}

// ---- G7: an inline object height the stem contradicts never draws ----
// The car mirror stem states the toy is 4.5 cm tall; the plan carries h = 4.5 cm.
const convexQuantities = [{ id: "u", symbol: "u", value: 27 }, { id: "f", symbol: "f", value: 18 }];
const tallConvex = mirrorDoc(qConvex, { u: 27, f: 18, h: 9, kind: "convex", quantities: convexQuantities });
const tallConvexForm = withInputs(tallConvex, {
  gaussian_image: { objectDistance: "u", focalLength: "f", form: "diverging", objectSide: "real" },
  optical_focus: { focalLength: "f", form: "diverging" },
});
for (const [name, document] of [
  ["the convex mirror with an inline objectHeight 9 on a 4.5 cm stem (signed mode)", tallConvex],
  ["the same mirror in magnitude mode on plan ids u and f, objectHeight 9 inline", tallConvexForm],
] as const) {
  // The proof reads no height (the stem match has no h slot), so the plan check in production
  // validation is what keeps this figure off the board in both arms.
  const { fatalIssues, result } = compiled(document);
  check("G7", result.ok && result.report.valid && fatalIssues.length === 0, `${name} must compile clean (${fatalIssues.slice(0, 3).join("; ")})`);
  const { strict, current } = production(qConvex, convexPlan, document);
  for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
    check("G7", selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
      `${name} must never be drawn as a planner figure in the ${arm} arm; got ${selection.representation?.figureSource ?? "nothing"}`);
  }
  const issues = quantityIssues(qConvex, convexPlan, document);
  check("G7", issues.some((issue) => issue.startsWith("scene_quantity_unverified@") && issue.endsWith(".inputs.objectHeight")),
    `${name} must fail scene_quantity_unverified on inputs.objectHeight; got ${issues.join(", ") || "no quantity issue"}`);
}
// Controls: the stated height draws in both modes, an inverted object compares by magnitude, and a stem
// with no stated height keeps a representative one.
const statedConvexForm = withInputs(goodConvex, {
  gaussian_image: { objectDistance: "u", focalLength: "f", form: "diverging", objectSide: "real" },
  optical_focus: { focalLength: "f", form: "diverging" },
});
expectDrawnAsPlanner("G7", "the convex mirror with the stated inline objectHeight 4.5 (signed mode)", qConvex, convexPlan, goodConvex);
expectDrawnAsPlanner("G7", "the convex mirror with the stated inline objectHeight 4.5 (magnitude mode)", qConvex, convexPlan, statedConvexForm);
// h = 7 puts the second ray's hit at h' = -21, so the mirror is drawn to a 22 cm half height (|R| = 30 reaches 28.5).
const tallMirror = withInputs(magnitudeMirror("converging"), { gaussian_image: { objectHeight: 7 }, spherical_surface: { halfHeight: 22 } });
for (const [name, question, turnPlan, document] of [
  ["an inverted inline objectHeight -4.5 on the 4.5 cm stem", qConvex, convexPlan, withInputs(goodConvex, { gaussian_image: { objectHeight: -4.5 } })],
  ["a representative inline objectHeight 2 on a stem with no stated height", qMirror, mirrorPlan, goodMirror],
  ["a representative inline objectHeight 7 in magnitude mode on a stem with no stated height", qMirror, mirrorPlan, tallMirror],
] as const) {
  const issues = quantityIssues(question, turnPlan, document);
  check("G7", issues.length === 0, `${name} must raise no scene_quantity issue; got ${issues.join(", ")}`);
}
expectDrawnAsPlanner("G7", "a representative inline objectHeight 7 in magnitude mode on a stem with no stated height",
  qMirror, mirrorPlan, tallMirror);

// ---- G8: every converging line leaves the element after a drawn incident ray, or is the lens chief ray ----
const qLensReal = "A convex lens of focal length 10 cm forms an image of an object placed 30 cm from it. Draw the ray diagram.";
const lensRealPlan = plan(qLensReal, [
  { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
  { id: "u", symbol: "u", value: 30, unit: "cm", provenance: "given", sourceText: "placed 30 cm" },
], [{ id: "v", symbol: "v", value: 15, unit: "cm", provenance: "derived" }], ["lens_formula"]);
const goodLensReal = lensDoc(qLensReal, { u: 30, f: 10, h: 2 });
/** Keep only the element, its foci, the arrows and the given converging paths. */
function onlyPaths(base: Doc, paths: Array<[id: string, operator: string, start: string, end: string]>): Doc {
  const document = structuredClone(base);
  const keep = new Set(["point", "line", "gaussian_image", "optical_focus", "lens_section", "spherical_surface"]);
  document.constructions = document.constructions.filter((construction) => keep.has(construction.operator) ||
    ["c_object", "c_image"].includes(construction.id));
  for (const [id, operator, start, end] of paths) {
    document.constructions.push({ id: `c_${id}`, operator, inputs: { start, end }, outputs: [id] } as Construction);
  }
  const outputs = new Set(document.constructions.flatMap((construction) => construction.outputs));
  document.entities = [...document.entities.filter((entity) => outputs.has(entity.id)), ...paths.map(([id, operator]) => ent(id, operator, "ray"))];
  document.assertions = [fatal("conv", "converges", [...paths.map(([id]) => id), "it"])];
  document.requiredEntityIds = document.entities.filter((entity) => !entity.id.startsWith("axis_")).map((entity) => entity.id);
  const late = new Set([...paths.map(([id]) => id), "ib", "it", "image"]);
  document.revealGroups = [
    { id: "setup", entityIds: document.requiredEntityIds.filter((id) => !late.has(id)), dependsOn: [], narrationCue: "setup" },
    { id: "rays", entityIds: paths.map(([id]) => id), dependsOn: ["setup"], narrationCue: "rays" },
    { id: "image_group", entityIds: ["ib", "it", "image"], dependsOn: ["rays"], narrationCue: "image" },
  ];
  return document;
}
const objectToImage: Array<[string, string, string, string]> = [["bad1", "segment", "ot", "it"], ["bad2", "segment", "ob", "it"]];
const impossibleRayCases: Array<[string, string, TurnPlanV3, Doc, Doc]> = [
  ["convex lens (real image)", qLensReal, lensRealPlan, goodLensReal, onlyPaths(goodLensReal, objectToImage)],
  ["concave mirror (real image)", qMirror, mirrorPlan, goodMirror, onlyPaths(goodMirror, objectToImage)],
  ["convex mirror (virtual image)", qConvex, convexPlan, goodConvex, onlyPaths(goodConvex, objectToImage)],
];
const elementRule = /converging line .* (?:does not leave the|has no drawn incident ray)/;
for (const [name, question, turnPlan, good, bad] of impossibleRayCases) {
  expectNeverPlanner("G8", `the ${name} drawn with only ot->it and ob->it`, question, turnPlan, bad);
  const proof = explainPlannerOpticsProof(question, bad);
  check("G8", proof.proof === "unproven" && elementRule.test(proof.reason),
    `the ${name} with ot->it and ob->it must fail the element rule; got ${proof.proof}: ${proof.reason}`);
  expectDrawnAsPlanner("G8", `the correct ${name}`, question, turnPlan, good);
}
// A reflected ray that starts on the mirror with no incident ray drawn to that point.
const noIncident = structuredClone(goodMirror);
noIncident.constructions = noIncident.constructions.filter((construction) => construction.id !== "c_r1i");
noIncident.entities = noIncident.entities.filter((entity) => entity.id !== "ray1_in");
noIncident.assertions = noIncident.assertions.filter((assertion) => assertion.id !== "par1");
noIncident.requiredEntityIds = noIncident.requiredEntityIds.filter((id) => id !== "ray1_in");
noIncident.revealGroups = noIncident.revealGroups.map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => id !== "ray1_in") }));
expectNeverPlanner("G8", "the concave mirror with no incident ray to the first hit point", qMirror, mirrorPlan, noIncident);
check("G8", /has no drawn incident ray/.test(explainPlannerOpticsProof(qMirror, noIncident).reason),
  `a reflected ray with no incident ray must fail the incident rule; got ${explainPlannerOpticsProof(qMirror, noIncident).reason}`);
// The chief ray exception holds only on a lens and only when the drawn path passes the optical centre.
const lensChief = (base: Doc, operator: string): Doc => {
  const document = structuredClone(base);
  document.constructions.push({ id: "c_chief", operator, inputs: { start: "ot", end: "it" }, outputs: ["chief"] } as Construction);
  document.entities.push(ent("chief", operator, "undeviated ray through the optical centre"));
  document.requiredEntityIds.push("chief");
  document.revealGroups = document.revealGroups.map((group) => group.id === "rays" ? { ...group, entityIds: [...group.entityIds, "chief"] } : group);
  document.assertions = document.assertions.map((assertion) => assertion.id === "conv"
    ? { ...assertion, entities: [assertion.entities[0]!, "chief", "it"] } : assertion);
  return document;
};
expectDrawnAsPlanner("G8", "the real-image convex lens with the chief ray drawn as one segment ot->it", qLensReal, lensRealPlan,
  lensChief(goodLensReal, "segment"));
// u = 10, f = 15: the virtual image lies beyond the object, so a ray from ot through it runs away from the lens.
expectNeverPlanner("G8", "the virtual-image convex lens with a ray from ot away from the lens through it", qLens, lensPlan,
  lensChief(goodLens, "ray"));
check("G8", /chief ray .* optical centre/.test(explainPlannerOpticsProof(qLens, lensChief(goodLens, "ray")).reason),
  `a chief ray that misses the optical centre must fail on the centre; got ${explainPlannerOpticsProof(qLens, lensChief(goodLens, "ray")).reason}`);

// ---- G9: a correct magnitude passes whatever sign the plan or the stem writes ----
const qDiverging = "A diverging lens has a focal length of 25 cm. An object is placed 50 cm in front of it. Draw the ray diagram and locate the image.";
const signedPlan = plan(qDiverging, [
  { id: "f", symbol: "f", value: -25, unit: "cm", provenance: "given", sourceText: "focal length of 25 cm" },
  { id: "u", symbol: "u", value: 50, unit: "cm", provenance: "given", sourceText: "50 cm in front" },
], [{ id: "v", symbol: "v", value: -50 / 3, unit: "cm", provenance: "derived" }], ["lens_formula"]);
const unsignedPlan = structuredClone(signedPlan);
unsignedPlan.givens[0]!.value = 25;
function divergingLens(question: string, opts: { u: number; f: number; h: number; unit: string; scale: number; focal: unknown; quantities: Doc["quantities"] }): Doc {
  const document = lensDoc(question, { u: opts.u, f: -opts.f, h: opts.h });
  document.quantities = opts.quantities;
  for (const construction of document.constructions) {
    if (construction.id === "c_img") Object.assign(construction.inputs, { objectDistance: "u", focalLength: opts.focal, objectHeight: opts.h, form: "diverging", objectSide: "real", lengthUnit: opts.unit, displayScale: opts.scale });
    if (construction.id === "c_F") Object.assign(construction.inputs, { focalLength: opts.focal, form: "diverging", lengthUnit: opts.unit, displayScale: opts.scale });
    if (construction.id === "c_lens") Object.assign(construction.inputs, { radius1: -19, radius2: 19 });
    if (construction.id === "c_axis_l") construction.inputs.x = -70;
  }
  document.entities = document.entities.map((entity) => entity.id === "lens" ? { ...entity, role: "diverging lens" } : entity);
  return document;
}
const cmLens = (focal: unknown, quantities: Doc["quantities"] = [{ id: "u", symbol: "u", value: 50, unit: "cm" }]) =>
  divergingLens(qDiverging, { u: 50, f: 25, h: 4, unit: "cm", scale: 1, focal, quantities });
expectDrawnAsPlanner("G9", "the diverging lens with inline focalLength -25 and form under a signed plan f = -25 cm", qDiverging, signedPlan, cmLens(-25));
expectDrawnAsPlanner("G9", "the diverging lens with inline focalLength 25 and form under a signed plan f = -25 cm", qDiverging, signedPlan, cmLens(25));
expectDrawnAsPlanner("G9", "control: inline focalLength 25 under an unsigned plan f = 25 cm", qDiverging, unsignedPlan, cmLens(25));
for (const [name, turnPlan, document, code] of [
  ["a wrong magnitude 30 under the signed plan", signedPlan, cmLens(30), "scene_quantity_unverified"],
  ["a wrong magnitude -30 under the signed plan", signedPlan, cmLens(-30), "scene_quantity_unverified"],
  // Ordinary signed quantity agreement is unchanged: a declared f = 25 under the plan's own id f = -25 still mismatches.
  ["a declared quantity f = 25 under the signed plan's id f = -25", signedPlan,
    cmLens("f", [{ id: "u", symbol: "u", value: 50, unit: "cm" }, { id: "f", symbol: "f", value: 25, unit: "cm" }]), "scene_quantity_mismatch"],
] as const) {
  const issues = quantityIssues(qDiverging, turnPlan, document);
  check("G9", issues.some((issue) => issue.startsWith(`${code}@`)), `${name} must fail ${code}; got ${issues.join(", ") || "no quantity issue"}`);
}
// A stem that writes the sign: detectArchetype returns f = -25 cm; the proof compares magnitudes.
const qSignedStem = "A diverging lens has a focal length of -0.25 m. An object is placed 0.5 m in front of it. Draw the ray diagram and locate the image.";
const signedStemPlan = plan(qSignedStem, [
  { id: "f", symbol: "f", value: -0.25, unit: "m", provenance: "given", sourceText: "focal length of -0.25 m" },
  { id: "u", symbol: "u", value: 0.5, unit: "m", provenance: "given", sourceText: "0.5 m in front" },
], [{ id: "v", symbol: "v", value: -0.5 / 3, unit: "m", provenance: "derived" }], ["lens_formula"]);
const mLens = (focal: unknown, quantities: Doc["quantities"]) =>
  divergingLens(qSignedStem, { u: 0.5, f: 0.25, h: 0.04, unit: "m", scale: 100, focal, quantities });
const uMetres = { id: "u", symbol: "u", value: 0.5, unit: "m" };
for (const [name, document] of [
  ["inline focalLength -0.25", mLens(-0.25, [uMetres])],
  ["inline focalLength 0.25", mLens(0.25, [uMetres])],
  ["focalLength by plan id f = -0.25", mLens("f", [uMetres, { id: "f", symbol: "f", value: -0.25, unit: "m" }])],
] as const) {
  const proof = explainPlannerOpticsProof(qSignedStem, document);
  check("G9", proof.proof === "proven", `the "-0.25 m" stem with ${name} must be proven; got ${proof.proof}: ${proof.reason}`);
  expectDrawnAsPlanner("G9", `the "-0.25 m" stem with ${name}`, qSignedStem, signedStemPlan, document);
}

// ---- G10: a mirror axis written as {start, direction} is read ----
const directionAxis = (base: Doc, direction: [number, number], signedRadius?: number): Doc => {
  const document = structuredClone(base);
  document.constructions = document.constructions.filter((construction) => construction.id !== "c_axis_l" && construction.id !== "c_axis_r");
  document.entities = document.entities.filter((entity) => entity.id !== "axis_l" && entity.id !== "axis_r");
  for (const construction of document.constructions) {
    if (construction.id === "c_axis") construction.inputs = { start: "P", direction };
    if (construction.id === "c_mirror" && signedRadius !== undefined) construction.inputs.signedRadius = signedRadius;
  }
  return document;
};
expectDrawnAsPlanner("G10", "the concave mirror with axis {start: P, direction: [1, 0]}", qMirror, mirrorPlan, directionAxis(goodMirror, [1, 0]));
expectDrawnAsPlanner("G10", "the concave mirror with axis {start: P, direction: [-1, 0]} and the radius flipped", qMirror, mirrorPlan,
  directionAxis(goodMirror, [-1, 0], 30));
expectDrawnAsPlanner("G10", "the convex mirror with axis {start: P, direction: [1, 0]}", qConvex, convexPlan, directionAxis(goodConvex, [1, 0]));
{
  // Control: once the axis is read, a mirror drawn with the wrong sense still fails on its sense.
  const wrongSense = directionAxis(goodMirror, [1, 0], 30);
  const proof = explainPlannerOpticsProof(qMirror, wrongSense);
  check("G10", proof.proof === "unproven" && /is not drawn concave/.test(proof.reason),
    `a direction-axis mirror drawn convex on a concave stem must fail on its sense; got ${proof.proof}: ${proof.reason}`);
  // The engine now reads the direction axis in the focal agreement check, so it refuses this figure itself.
  expectEngineRefuses("G10", "a direction-axis mirror drawn convex on a concave stem", qMirror, mirrorPlan, wrongSense);
}

// ---- G11: the element kind comes from the stem only when the stem names it or signs it ----
const qSpectacle = "A spectacle lens marked -6.25 D is held 112 cm from a lit sign 5.6 cm high. Work out the focal length of the lens, where the image of the sign is seen, how big it looks and whether it is upright.";
const spectaclePlan = (question: string): TurnPlanV3 => plan(question, [
  { id: "P", symbol: "P", value: -6.25, unit: "D", provenance: "given", sourceText: "P = -6.25" },
  { id: "do", symbol: "d_o", value: 112, unit: "cm", provenance: "given", sourceText: "do = 112" },
  { id: "ho", symbol: "h_o", value: 5.6, unit: "cm", provenance: "given", sourceText: "ho = 5.6" },
], [
  { id: "f", symbol: "f", value: -16, unit: "cm", provenance: "derived" },
  { id: "di", symbol: "d_i", value: -14, unit: "cm", provenance: "derived" },
  { id: "hi", symbol: "h_i", value: 0.7, unit: "cm", provenance: "derived" },
], ["lens_formula"]);
/** The recorded honest figure's shape: a diverging lens on the plan's d_o, |f| = 16 cm inline, u = 112 cm. */
function spectacleLens(question: string): Doc {
  const document = divergingLens(question, { u: 112, f: 16, h: 5.6, unit: "cm", scale: 1, focal: 16, quantities: [{ id: "do", symbol: "d_o", value: 112, unit: "cm" }] });
  for (const construction of document.constructions) {
    if (construction.id === "c_img") construction.inputs.objectDistance = "do";
    if (construction.id === "c_axis_l") construction.inputs.x = -130;
  }
  return document;
}
{
  const proof = explainPlannerOpticsProof(qSpectacle, spectacleLens(qSpectacle));
  check("G11", proof.proof === "proven", `the recorded "-6.25 D" stem names no kind; its diverging figure must be proven; got ${proof.proof}: ${proof.reason}`);
  expectDrawnAsPlanner("G11", 'the diverging figure on the recorded "-6.25 D" stem', qSpectacle, spectaclePlan(qSpectacle), spectacleLens(qSpectacle));
  // Controls: a named kind, or a power whose sign implies one, still decides.
  for (const [name, question, reason] of [
    ["a stem that names a convex lens", qSpectacle.replace("A spectacle lens marked -6.25 D", "A convex spectacle lens marked +6.25 D"), /contradicts a convex lens/],
    ["a stem that names a converging lens", qSpectacle.replace("A spectacle lens", "A converging spectacle lens").replace("-6.25 D", "+6.25 D"), /contradicts a convex lens/],
    ["a stem whose positive power implies a converging lens", qSpectacle.replace("-6.25 D", "+6.25 D"), /contradicts a convex lens/],
  ] as const) {
    const control = spectacleLens(question);
    const result = explainPlannerOpticsProof(question, control);
    check("G11", result.proof === "unproven" && reason.test(result.reason), `${name} must still reject a diverging form; got ${result.proof}: ${result.reason}`);
    expectNeverPlanner("G11", `a diverging figure on ${name}`, question, spectaclePlan(question), control);
  }
  // A converging figure on the negative power fails on its sign.
  const converging = spectacleLens(qSpectacle);
  for (const construction of converging.constructions) {
    if (construction.id === "c_img" || construction.id === "c_F") construction.inputs.form = "converging";
  }
  const wrongForm = explainPlannerOpticsProof(qSpectacle, converging);
  check("G11", wrongForm.proof === "unproven" && /contradicts a concave lens/.test(wrongForm.reason),
    `a converging figure on the "-6.25 D" stem must fail P2; got ${wrongForm.proof}: ${wrongForm.reason}`);
}

// ---- G12: rays traced by the engine (principal_rays) ----
/** Swap every hand ray, hit helper and ray assertion for one principal_rays construction. */
function traced(base: Doc, rays?: string[], image = "it"): Doc {
  const document = structuredClone(base);
  const handOperators = new Set(["segment", "ray", "vector", "perpendicular_through", "project", "rotate"]);
  const dropped = new Set(document.constructions
    .filter((construction) => handOperators.has(construction.operator) && !["c_object", "c_image"].includes(construction.id))
    .flatMap((construction) => construction.outputs));
  const outputs = (rays ?? ["parallel", "central"]).map((_, index) => `tr${index + 1}`);
  document.constructions = [
    ...document.constructions.filter((construction) => !construction.outputs.some((output) => dropped.has(output))),
    { id: "c_traced", operator: "principal_rays", inputs: { image, ...(rays ? { rays } : {}) }, outputs },
  ];
  document.entities = [
    ...document.entities.filter((entity) => !dropped.has(entity.id)),
    ...outputs.map((id, index) => ent(id, "polyline", `${(rays ?? ["parallel", "central"])[index]} principal ray`)),
  ] as Doc["entities"];
  document.assertions = document.assertions.filter((assertion) => !assertion.entities.some((id) => dropped.has(id)));
  document.requiredEntityIds = [...document.requiredEntityIds.filter((id) => !dropped.has(id)), ...outputs];
  document.revealGroups = document.revealGroups.map((group) => ({
    ...group, entityIds: group.id === "rays" ? outputs : group.entityIds.filter((id) => !dropped.has(id)),
  }));
  return document;
}
const withConverges = (document: Doc): Doc => {
  const copy = structuredClone(document);
  const outputs = copy.constructions.find((construction) => construction.operator === "principal_rays")!.outputs;
  copy.assertions = [...copy.assertions, fatal("meet", "converges", [...outputs, "it"])];
  return copy;
};
const expectUnproven = (gate: string, name: string, question: string, document: Doc, reason: RegExp): void => {
  const result = explainPlannerOpticsProof(question, document);
  check(gate, result.proof === "unproven" && reason.test(result.reason), `${name} must stay unproven by ${reason}; got ${result.proof}: ${result.reason}`);
};
{
  // G12a: proven without a hand-drawn converges, in both arms.
  for (const [name, question, turnPlan, document] of [
    ["the traced concave mirror (default rays)", qMirror, mirrorPlan, traced(goodMirror)],
    ["the traced concave mirror (parallel and focal)", qMirror, mirrorPlan, traced(goodMirror, ["parallel", "focal"])],
    ["the traced convex car mirror", qConvex, convexPlan, traced(goodConvex, ["parallel", "focal", "central"])],
    ["the traced convex lens, virtual image", qLens, lensPlan, traced(goodLens, ["parallel", "focal"])],
    ["the traced convex lens, real image", qLensReal, lensRealPlan, traced(goodLensReal, ["parallel", "focal", "central"])],
    ["the traced convex lens with a stray converges on its rays", qLensReal, lensRealPlan, withConverges(traced(goodLensReal))],
  ] as const) {
    check("G12a", !document.assertions.some((assertion) => assertion.predicate === "converges") || name.includes("stray"),
      `${name} must carry no hand-drawn converges`);
    const result = explainPlannerOpticsProof(question, document);
    check("G12a", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G12a", name, question, turnPlan, document);
  }

  // G12b: forged rays, a wrong image, a wrong element, one ray, free hand rays beside traced ones.
  const forgedPolyline = (withConvergence: boolean): Doc => {
    const document = traced(goodMirror);
    document.constructions = document.constructions.filter((construction) => construction.operator !== "principal_rays");
    document.constructions.push(
      { id: "c_fake1", operator: "polyline", inputs: { points: ["ot", [0, 2], "it"] }, outputs: ["tr1"] },
      { id: "c_fake2", operator: "polyline", inputs: { points: ["ot", "P", "it"] }, outputs: ["tr2"] },
    );
    if (withConvergence) document.assertions.push(fatal("meet", "converges", ["tr1", "tr2", "it"]));
    return document;
  };
  expectUnproven("G12b", "a free polyline posing as a principal ray", qMirror, forgedPolyline(false), /fewer than two principal_rays/);
  expectUnproven("G12b", "free polylines under a converges", qMirror, forgedPolyline(true), /converging line tr1 is not a drawn ray/);
  // Free segments through literal hits at the true heights (h = 2, h' = -6): exact geometry, no engine authority.
  const freeSegments = traced(goodMirror);
  freeSegments.constructions = freeSegments.constructions.filter((construction) => construction.operator !== "principal_rays");
  freeSegments.entities = freeSegments.entities.filter((entity) => !entity.id.startsWith("tr"));
  freeSegments.requiredEntityIds = freeSegments.requiredEntityIds.filter((id) => !id.startsWith("tr"));
  const fakeIds = ["H1", "H2", "in1", "out1", "in2", "out2"];
  freeSegments.constructions.push(pt("H1", 0, 2), pt("H2", 0, -6),
    { id: "c_in1", operator: "segment", inputs: { start: "ot", end: "H1" }, outputs: ["in1"] },
    { id: "c_out1", operator: "segment", inputs: { start: "H1", end: "it" }, outputs: ["out1"] },
    { id: "c_in2", operator: "segment", inputs: { start: "ot", end: "H2" }, outputs: ["in2"] },
    { id: "c_out2", operator: "segment", inputs: { start: "H2", end: "it" }, outputs: ["out2"] });
  freeSegments.entities.push(...fakeIds.map((id) => ent(id, id.startsWith("H") ? "point" : "segment", "principal ray") as Doc["entities"][number]));
  freeSegments.requiredEntityIds.push(...fakeIds);
  freeSegments.revealGroups = freeSegments.revealGroups.map((group) => (group.id === "rays" ? { ...group, entityIds: fakeIds } : group));
  freeSegments.assertions.push(fatal("meet", "converges", ["out1", "out2", "it"]));
  expectUnproven("G12b", "free segments posing as principal rays", qMirror, freeSegments, /endpoint the engine did not derive|does not leave the mirror|incident/);
  expectNeverPlanner("G12b", "free segments posing as principal rays", qMirror, mirrorPlan, freeSegments);
  expectUnproven("G12b", "rays traced from the image base", qMirror, traced(goodMirror, undefined, "ib"), /does not trace the gaussian image tip/);
  const secondImage = traced(goodMirror);
  secondImage.constructions.push({ ...structuredClone(secondImage.constructions.find((construction) => construction.operator === "gaussian_image")!), id: "c_img2", outputs: ["ob2", "ot2", "ib2", "it2"] });
  for (const id of ["ob2", "ot2", "ib2", "it2"]) secondImage.entities.push(ent(id, "point", "construction helper") as Doc["entities"][number]);
  secondImage.constructions.find((construction) => construction.operator === "principal_rays")!.inputs.image = "it2";
  expectUnproven("G12b", "rays traced from a second gaussian image", qMirror, secondImage, /gaussian_image count 2/);
  const lensOnMirror = traced(goodMirror);
  const surface = lensOnMirror.constructions.find((construction) => construction.operator === "spherical_surface")!;
  Object.assign(surface, { operator: "lens_section", inputs: { center: "P", axis: "axis", radius1: 19, radius2: -19, halfHeight: 9 } });
  expectUnproven("G12b", "a lens drawn on a mirror stem with traced rays", qMirror, lensOnMirror, /lens_section drawn on a mirror stem/);
  const oneRay = traced(goodMirror);
  const tracing = oneRay.constructions.find((construction) => construction.operator === "principal_rays")!;
  tracing.inputs.rays = ["parallel"]; tracing.outputs = ["tr1"];
  oneRay.entities = oneRay.entities.filter((entity) => entity.id !== "tr2");
  oneRay.requiredEntityIds = oneRay.requiredEntityIds.filter((id) => id !== "tr2");
  expectUnproven("G12b", "one traced ray", qMirror, oneRay, /fewer than two principal_rays/);
  const handBeside = traced(goodLensReal);
  handBeside.constructions.push(pt("Z", 6, 5), { id: "c_hand", operator: "segment", inputs: { start: "ot", end: "Z" }, outputs: ["hand"] });
  handBeside.entities.push(ent("Z", "point", "construction helper") as Doc["entities"][number], ent("hand", "segment", "extra ray") as Doc["entities"][number]);
  handBeside.requiredEntityIds.push("Z", "hand");
  handBeside.revealGroups = handBeside.revealGroups.map((group) => (group.id === "rays" ? { ...group, entityIds: [...group.entityIds, "Z", "hand"] } : group));
  expectUnproven("G12b", "a free hand ray beside traced rays", qLensReal, handBeside, /ray hand has an endpoint the engine did not derive/);
  expectNeverPlanner("G12b", "a free hand ray beside traced rays", qLensReal, lensRealPlan, handBeside);

  // G12c (P10): the focal ray of the virtual-image lens hits at h' = 6 cm; a 4 cm half height cannot carry it.
  const shortLens = traced(goodLens, ["parallel", "focal"]);
  shortLens.constructions.find((construction) => construction.operator === "lens_section")!.inputs.halfHeight = 4;
  expectUnproven("G12c", "a focal ray beyond the drawn lens", qLens, shortLens, /focal ray hits at 6 beyond the lens_section/);
  expectNeverPlanner("G12c", "a focal ray beyond the drawn lens", qLens, lensPlan, shortLens);
  const shortMirror = traced(goodConvex, ["parallel", "central"]);
  shortMirror.constructions.find((construction) => construction.operator === "spherical_surface")!.inputs.halfHeight = 4;
  expectUnproven("G12c", "a parallel ray beyond the drawn mirror", qConvex, shortMirror, /parallel ray hits at 4.5 beyond the spherical_surface/);
  // The central ray hits at the centre, so a short element still carries it with a parallel ray inside.
  const centralOnly = traced(goodConvex, ["focal", "central"]);
  centralOnly.constructions.find((construction) => construction.operator === "spherical_surface")!.inputs.halfHeight = 2;
  check("G12c", explainPlannerOpticsProof(qConvex, centralOnly).proof === "proven", "focal (1.8 cm) and central rays fit a 2 cm mirror");

  // G12d: the presentation dashes the back-extensions and guides, and only them.
  for (const [name, document] of [["virtual-image lens", traced(goodLens, ["parallel", "focal", "central"])], ["convex mirror", traced(goodConvex, ["parallel", "focal", "central"])]] as const) {
    const { result } = compiled(document);
    if (!result.ok || !result.renderScene) { check("G12d", false, `${name} must compile`); continue; }
    const presentation = buildVerifiedDiagramPresentation(document, result.renderScene);
    const rayCommands = presentation.diagram.commands.filter((command) => /^tr\d$/.test(command.semanticRef?.entityId ?? "") && command.type !== "LABEL");
    let dashedCount = 0;
    for (const command of rayCommands) {
      const index = Number(/_(\d+)$/.exec(command.semanticRef?.primitiveId ?? "")?.[1]);
      const dashed = command.visualStyle?.dashed === true;
      if (dashed) dashedCount += 1;
      check("G12d", dashed === index >= 2, `${name} ${command.semanticRef?.primitiveId} (${command.type}) dashed ${dashed}`);
      if (dashed) check("G12d", command.visualStyle?.strokeRole === "construction", `${name} ${command.semanticRef?.primitiveId} dashed ink is construction ink`);
    }
    check("G12d", dashedCount >= 3, `${name} must dash its back-extensions (${dashedCount} dashed commands)`);
  }
}

// ---- G13: a stated lens power fixes |f| = 1/|P|; each magnitude literal binds to its own plan quantity ----
{
  const withOptics = (base: Doc, image: Record<string, unknown>, focus: Record<string, unknown> = {}, drop: string[] = []): Doc => {
    const document = structuredClone(base);
    for (const construction of document.constructions) {
      if (construction.id === "c_img" || construction.id === "c_F") {
        for (const key of drop) delete construction.inputs[key];
        Object.assign(construction.inputs, construction.id === "c_img" ? image : focus);
      }
    }
    return document;
  };
  const spectacle = spectacleLens(qSpectacle);
  // The review's case: |f| = 112 cm, the plan's object distance, where -6.25 D gives 16 cm.
  for (const [name, document] of [
    ["focalLength 112 inline (form diverging)", withOptics(spectacle, { focalLength: 112 }, { focalLength: 112 })],
    ["focalLength by the object distance's id do", withOptics(spectacle, { focalLength: "do" }, { focalLength: "do" })],
    ["signed focalLength -112 (no form)", withOptics(spectacle, { objectDistance: -112, focalLength: -112 }, { focalLength: -112 }, ["form", "objectSide"])],
  ] as const) {
    expectUnproven("G13", `the "-6.25 D" lens with ${name}`, qSpectacle, document, /f = 112 cm contradicts the stem's power -6\.25 D \(\|f\| = 16 cm\)/);
    expectNeverPlanner("G13", `the "-6.25 D" lens with ${name}`, qSpectacle, spectaclePlan(qSpectacle), document);
  }
  // Production binds objectDistance to the plan's object distance and focalLength to its focal length.
  for (const [name, question, turnPlan, document, key] of [
    ['focalLength 112 on the "-6.25 D" lens', qSpectacle, spectaclePlan(qSpectacle), withOptics(spectacle, { focalLength: 112 }, { focalLength: 112 }), "focalLength"],
    ['focalLength by plan id do on the "-6.25 D" lens', qSpectacle, spectaclePlan(qSpectacle), withOptics(spectacle, { focalLength: "do" }, { focalLength: "do" }), "focalLength"],
    ['objectDistance 16 (the plan\'s f) on the "-6.25 D" lens', qSpectacle, spectaclePlan(qSpectacle), withOptics(spectacle, { objectDistance: 16 }), "objectDistance"],
    ["focalLength 36 (the plan's R) on the convex car mirror", qConvex, convexPlan,
      withInputs(goodConvex, { gaussian_image: { objectDistance: 27, focalLength: 36, form: "diverging", objectSide: "real" }, optical_focus: { focalLength: 36, form: "diverging" } }), "focalLength"],
  ] as const) {
    const issues = quantityIssues(question, turnPlan, document);
    check("G13", issues.some((issue) => issue.startsWith("scene_quantity_unverified@") && issue.endsWith(`.inputs.${key}`)),
      `${name} must fail scene_quantity_unverified on ${key}; got ${issues.join(", ") || "no quantity issue"}`);
  }
  // Controls: the honest figures, inline or by plan id, still prove and pass agreement.
  for (const [name, question, turnPlan, document] of [
    ['the "-6.25 D" lens with |f| = 16 inline and u by plan id do', qSpectacle, spectaclePlan(qSpectacle), spectacle],
    ['the "-6.25 D" lens with u = 112 and |f| = 16 inline', qSpectacle, spectaclePlan(qSpectacle), withOptics(spectacle, { objectDistance: 112 })],
    ["the convex car mirror with u = 27 and |f| = 18 inline", qConvex, convexPlan,
      withInputs(goodConvex, { gaussian_image: { objectDistance: 27, focalLength: 18, form: "diverging", objectSide: "real" }, optical_focus: { focalLength: 18, form: "diverging" } })],
  ] as const) {
    check("G13", quantityIssues(question, turnPlan, document).length === 0,
      `${name} must pass agreement; got ${quantityIssues(question, turnPlan, document).join(", ")}`);
    expectDrawnAsPlanner("G13", name, question, turnPlan, document);
  }
  // A power whose reciprocal is not a round number: |f| = 33.3 cm is 1/(3 D) to three figures; 30 cm is not.
  const qThree = "A spectacle lens marked -3 D is held 50 cm from a lit sign 4 cm high. Where is the image of the sign seen?";
  const threeLens = (focal: number) => divergingLens(qThree, { u: 50, f: focal, h: 4, unit: "cm", scale: 1, focal, quantities: [{ id: "u", symbol: "u", value: 50, unit: "cm" }] });
  const rounded = explainPlannerOpticsProof(qThree, threeLens(33.3));
  check("G13", rounded.proof === "proven", `|f| = 33.3 cm on a -3 D stem must be proven; got ${rounded.proof}: ${rounded.reason}`);
  expectUnproven("G13", "|f| = 30 cm on a -3 D stem", qThree, threeLens(30), /contradicts the stem's power -3 D/);
  // A converging power proves its own f in metres too.
  const qPlus = "A converging lens of power +2.5 D forms an image of an object placed 0.6 m from it. Draw the ray diagram.";
  const plusLens = (focal: number) => {
    const document = lensDoc(qPlus, { u: 60, f: focal, h: 2 });
    for (const construction of document.constructions) {
      if (construction.operator === "gaussian_image") Object.assign(construction.inputs, { objectDistance: -0.6, focalLength: focal / 100, objectHeight: 0.02, lengthUnit: "m", displayScale: 100 });
      if (construction.operator === "optical_focus") Object.assign(construction.inputs, { focalLength: focal / 100, lengthUnit: "m", displayScale: 100 });
    }
    document.quantities = [];
    return document;
  };
  check("G13", explainPlannerOpticsProof(qPlus, plusLens(40)).proof === "proven",
    `f = 0.4 m on a +2.5 D stem must be proven; got ${explainPlannerOpticsProof(qPlus, plusLens(40)).reason}`);
  expectUnproven("G13", "f = 0.6 m on a +2.5 D stem", qPlus, plusLens(60), /f = 60 cm contradicts the stem's power \+2\.5 D \(\|f\| = 40 cm\)/);
}

// ---- G14: a converges assertion with expected false proves nothing ----
{
  // Outgoing rays from the two hits to the object base and the focus: they never pass the image tip.
  const missing = structuredClone(goodMirror);
  missing.constructions = missing.constructions.map((construction) =>
    construction.id === "c_r1o" ? { ...construction, inputs: { start: "M1", end: "ob", approximation: "paraxial" } }
      : construction.id === "c_r2o" ? { ...construction, inputs: { start: "M2", end: "F", approximation: "paraxial" } } : construction);
  missing.entities = missing.entities.map((entity) => entity.id === "ray1_out" || entity.id === "ray2_out" ? { ...entity, role: "reflected ray (paraxial)" } : entity);
  missing.assertions = missing.assertions.filter((assertion) => assertion.id !== "par2")
    .map((assertion) => assertion.id === "conv" ? { ...assertion, expected: false } : assertion);
  expectUnproven("G14", "rays that miss the image tip under converges expected false", qMirror, missing, /no fatal converges assertion/);
  expectNeverPlanner("G14", "rays that miss the image tip under converges expected false", qMirror, mirrorPlan, missing);
  // Control: the same check on the honest mirror with expected written out as true.
  const explicitTrue = structuredClone(goodMirror);
  explicitTrue.assertions = explicitTrue.assertions.map((assertion) => assertion.id === "conv" ? { ...assertion, expected: true } : assertion);
  expectDrawnAsPlanner("G14", "the concave mirror with converges expected true", qMirror, mirrorPlan, explicitTrue);
}

// ---- G15: a ray hit must lie within the element as drawn (a curved face stops at 0.95 |R|) ----
{
  const pinched = (document: Doc): Doc => {
    const copy = structuredClone(document);
    Object.assign(copy.constructions.find((construction) => construction.operator === "lens_section")!.inputs, { radius1: 2, radius2: -2 });
    return copy;
  };
  // halfHeight 8, but faces of radius 2 end 1.9 from the axis: the parallel ray (h = 2) and focal ray (6) miss it.
  expectUnproven("G15", "traced rays beyond a lens whose faces stop at 1.9", qLens, pinched(traced(goodLens, ["parallel", "focal"])),
    /parallel ray hits at 2 beyond the lens_section c_lens drawn half height 1\.9/);
  expectNeverPlanner("G15", "traced rays beyond a lens whose faces stop at 1.9", qLens, lensPlan, pinched(traced(goodLens, ["parallel", "focal"])));
  // The same drawn extent holds a hand-drawn hit: L1 (h = 2) lies on the lens plane but off the drawn lens.
  expectUnproven("G15", "a hand ray hit beyond a lens whose faces stop at 1.9", qLens, pinched(goodLens), /converging line ext1 does not leave the lens/);
  expectNeverPlanner("G15", "a hand ray hit beyond a lens whose faces stop at 1.9", qLens, lensPlan, pinched(goodLens));
  // Controls: faces of radius 19 reach the 8 cm half height.
  check("G15", explainPlannerOpticsProof(qLens, traced(goodLens, ["parallel", "focal"])).proof === "proven", "the traced lens with radius 19 faces must stay proven");
  check("G15", explainPlannerOpticsProof(qLens, goodLens).proof === "proven", "the hand-drawn lens with radius 19 faces must stay proven");
}

// ---- G16: a hit on the element is accepted whatever parameter-free operator derived it ----
{
  /** Swap the second ray pair for ot -> S -> it, with S made by `hit`. */
  const viaHit = (hit: Construction): Doc => {
    const document = structuredClone(goodMirror);
    document.constructions = document.constructions.map((construction) =>
      construction.id === "c_r2i" ? { ...construction, inputs: { start: "ot", end: "S" } }
        : construction.id === "c_r2o" ? { ...construction, inputs: { start: "S", end: "it", approximation: "paraxial" } } : construction);
    document.constructions.splice(document.constructions.findIndex((construction) => construction.id === "c_r2i"), 0, hit);
    document.constructions = document.constructions.filter((construction) => construction.id !== "c_M2");
    document.entities = [
      ...document.entities.filter((entity) => entity.id !== "M2").map((entity) => entity.id === "ray2_in" ? { ...entity, role: "incident ray" }
        : entity.id === "ray2_out" ? { ...entity, role: "reflected ray (paraxial)" } : entity),
      ent("S", "point", "ray hit"),
    ] as Doc["entities"];
    document.requiredEntityIds = [...document.requiredEntityIds, "S"];
    document.revealGroups = document.revealGroups.map((group) => group.id === "rays" ? { ...group, entityIds: ["S", ...group.entityIds] } : group);
    document.assertions = document.assertions.filter((assertion) => assertion.id !== "par2");
    return document;
  };
  for (const [name, hit] of [
    ["midpoint of the pole and M1", { id: "c_S", operator: "midpoint", inputs: { a: "P", b: "M1" }, outputs: ["S"] }],
    ["M1 reflected in the axis", { id: "c_S", operator: "reflect_point", inputs: { point: "M1", line: "axis" }, outputs: ["S"] }],
    ["M1 turned half a turn about the pole", { id: "c_S", operator: "rotate", inputs: { point: "M1", center: "P", angle: 180, angleUnit: "degrees" }, outputs: ["S"] }],
  ] as Array<[string, Construction]>) {
    const document = viaHit(hit);
    const proof = explainPlannerOpticsProof(qMirror, document);
    check("G16", proof.proof === "proven", `a ray hit at ${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G16", `the concave mirror with a ray hit at ${name}`, qMirror, mirrorPlan, document);
  }
  // Controls: the same operators off the mirror stay unproven.
  for (const [name, hit] of [
    ["midpoint of the object tip and M1", { id: "c_S", operator: "midpoint", inputs: { a: "ot", b: "M1" }, outputs: ["S"] }],
    ["the object tip reflected in the mirror plane", { id: "c_S", operator: "reflect_point", inputs: { point: "ot", line: "lp" }, outputs: ["S"] }],
    ["M1 turned half a turn about the object tip", { id: "c_S", operator: "rotate", inputs: { point: "M1", center: "ot", angle: 180, angleUnit: "degrees" }, outputs: ["S"] }],
  ] as Array<[string, Construction]>) {
    expectUnproven("G16", `a ray hit at ${name}`, qMirror, viaHit(hit), /converging line ray2_out does not leave the mirror/);
  }
}

// ---- G17: a mirror on an endpoint axis toward -x, radius signed the way the engine draws it ----
{
  const reversed = structuredClone(goodMirror);
  for (const construction of reversed.constructions) {
    if (construction.id === "c_axis") construction.inputs = { start: "axis_r", end: "axis_l" };
    // The surface frame always points along +x; the object now sits on the +x side, so concave is R > 0.
    if (construction.id === "c_mirror") construction.inputs.signedRadius = 30;
  }
  expectDrawnAsPlanner("G17", "the concave mirror on the axis axis_r -> axis_l with signedRadius 30", qMirror, mirrorPlan, reversed);
  const drawnConvex = structuredClone(reversed);
  drawnConvex.constructions.find((construction) => construction.id === "c_mirror")!.inputs.signedRadius = -30;
  expectEngineRefuses("G17", "the same reversed-axis mirror drawn convex (signedRadius -30)", qMirror, mirrorPlan, drawnConvex);
}

// ---- G18: an optics input written as a plan quantity id binds to that quantity, whatever its name ----
{
  // Gaussian notation (1/p + 1/q = 1/f): the plan calls the object distance p, a name no role heuristic knows.
  const gaussPlan = plan(qLens, [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given", sourceText: "focal length 15 cm" },
    { id: "p", symbol: "p", value: 10, unit: "cm", provenance: "given", sourceText: "placed 10 cm" },
  ], [{ id: "q", symbol: "q", value: 30, unit: "cm", provenance: "derived" }], ["lens_formula"]);
  const pQuantities = (p = 10) => [{ id: "p", symbol: "p", value: p, unit: "cm" }, { id: "f", symbol: "f", value: 15, unit: "cm" }];
  const gaussLens = (image: Record<string, unknown>, focus: Record<string, unknown> = {}, quantities = pQuantities()): Doc => {
    const document = withInputs(goodLens, {
      gaussian_image: { objectDistance: "p", focalLength: "f", form: "converging", objectSide: "real", ...image },
      optical_focus: { focalLength: "f", form: "converging", ...focus },
    });
    document.quantities = quantities as Doc["quantities"];
    return document;
  };
  // The review's case and its inline twin: both draw, as p names the object distance.
  for (const [name, document] of [
    ["objectDistance by the plan id p", gaussLens({})],
    ["objectDistance 10 inline (10 cm is the plan's p)", gaussLens({ objectDistance: 10 })],
  ] as const) {
    check("G18", quantityIssues(qLens, gaussPlan, document).length === 0,
      `the p plan lens with ${name} must pass agreement; got ${quantityIssues(qLens, gaussPlan, document).join(", ")}`);
    expectDrawnAsPlanner("G18", `the p plan lens with ${name}`, qLens, gaussPlan, document);
  }
  // Wrong values still fail: a wrong object distance, and the object distance offered as f by its id or inline.
  for (const [name, document, key] of [
    ["objectDistance 12 inline", gaussLens({ objectDistance: 12 }), "objectDistance"],
    ["objectDistance by the id p declared as 12 cm", gaussLens({}, {}, pQuantities(12)), "objectDistance"],
    ["focalLength by the object distance's id p", gaussLens({ focalLength: "p" }, { focalLength: "p" }), "focalLength"],
    ["focalLength 10 inline", gaussLens({ focalLength: 10 }, { focalLength: 10 }), "focalLength"],
  ] as const) {
    const issues = quantityIssues(qLens, gaussPlan, document);
    check("G18", issues.some((issue) => issue.startsWith("scene_quantity_unverified@") && issue.endsWith(`.inputs.${key}`)),
      `the p plan lens with ${name} must fail scene_quantity_unverified on ${key}; got ${issues.join(", ") || "no quantity issue"}`);
    const { strict, current } = production(qLens, gaussPlan, document);
    for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
      check("G18", selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
        `the p plan lens with ${name} must never draw as the planner figure in the ${arm} arm`);
    }
  }
  // The "-6.25 D" spectacle lens on the same footing: its object distance called p, 112 cm offered as f.
  const spectacleP = (question: string): TurnPlanV3 => {
    const renamed = spectaclePlan(question);
    renamed.givens = renamed.givens.map((given) => given.id === "do" ? { ...given, id: "p", symbol: "p" } : given);
    return renamed;
  };
  const spectacleByP = (image: Record<string, unknown>, focus: Record<string, unknown> = {}): Doc => {
    const document = withInputs(spectacleLens(qSpectacle), { gaussian_image: { objectDistance: "p", ...image }, optical_focus: focus });
    document.quantities = [{ id: "p", symbol: "p", value: 112, unit: "cm" }] as Doc["quantities"];
    return document;
  };
  check("G18", quantityIssues(qSpectacle, spectacleP(qSpectacle), spectacleByP({})).length === 0,
    `the "-6.25 D" lens with u by plan id p and |f| = 16 inline must pass agreement; got ${quantityIssues(qSpectacle, spectacleP(qSpectacle), spectacleByP({})).join(", ")}`);
  expectDrawnAsPlanner("G18", 'the "-6.25 D" lens with u by plan id p', qSpectacle, spectacleP(qSpectacle), spectacleByP({}));
  for (const [name, document] of [
    ["focalLength 112 inline", spectacleByP({ focalLength: 112 }, { focalLength: 112 })],
    ["focalLength by the object distance's id p", spectacleByP({ focalLength: "p" }, { focalLength: "p" })],
  ] as const) {
    const issues = quantityIssues(qSpectacle, spectacleP(qSpectacle), document);
    check("G18", issues.some((issue) => issue.startsWith("scene_quantity_unverified@") && issue.endsWith(".inputs.focalLength")),
      `the "-6.25 D" lens (u called p) with ${name} must fail scene_quantity_unverified on focalLength; got ${issues.join(", ") || "no quantity issue"}`);
    expectNeverPlanner("G18", `the "-6.25 D" lens (u called p) with ${name}`, qSpectacle, spectacleP(qSpectacle), document);
  }
}

// ---- G19: every drawn light path is a ray the element forms, not only the two that prove the image ----
const qTall = "An object 2 cm tall is placed at 30 cm from a convex lens of focal length 10 cm. Draw the ray diagram.";
const tallPlan = plan(qTall, [
  { id: "h", symbol: "h_o", value: 2, unit: "cm", provenance: "given", sourceText: "2 cm tall" },
  { id: "u", symbol: "u", value: 30, unit: "cm", provenance: "given", sourceText: "at 30 cm" },
  { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
], [{ id: "v", symbol: "v", value: 15, unit: "cm", provenance: "derived" }], ["lens_formula"]);
const tallLens = (rays: string[]) => traced(lensDoc(qTall, { u: 30, f: 10, h: 2 }), rays);
/** A hand path: a segment, ray or vector from its first point to its second, or a polyline through all of them. */
interface HandPath { id: string; operator: string; points: string[]; role?: string; extra?: Record<string, unknown>; kind?: string; dashed?: boolean }
type HandPathInput = [id: string, operator: string, start: string, end: string] | HandPath;
/**
 * Hand paths beside traced rays. On hand: S, where a parallel ray from the object tip meets the
 * element plane; S2, where the focal ray does (the image tip's height); Sback, a focus turned half
 * a turn about S, which lies on the parallel ray's true line on the side its light never reaches.
 */
const handPaths = (base: Doc, plane: string, focus: string, input: HandPathInput[]): Doc => {
  const document = structuredClone(base);
  const paths: HandPath[] = input.map((path) => Array.isArray(path) ? { id: path[0], operator: path[1], points: [path[2], path[3]] } : path);
  // Only the helpers a path reads, so no helper is left unrequired.
  const ends = new Set(paths.flatMap((path) => path.points));
  if (ends.has("Sback")) ends.add("S");
  const helpers = ([
    { id: "c_lp", operator: "perpendicular_through", inputs: { through: plane, line: "axis" }, outputs: ["lp"] },
    { id: "c_S", operator: "project", inputs: { point: "ot", line: "lp" }, outputs: ["S"] },
    { id: "c_S2", operator: "project", inputs: { point: "it", line: "lp" }, outputs: ["S2"] },
    { id: "c_Sback", operator: "rotate", inputs: { point: focus, center: "S", angle: 180, angleUnit: "degrees" }, outputs: ["Sback"] },
  ] as Construction[]).filter((helper) => helper.id === "c_lp" ? ["S", "S2"].some((id) => ends.has(id)) : ends.has(helper.outputs[0]!));
  document.constructions.push(...helpers, ...paths.map(({ id, operator, points, extra }) => ({
    id: `c_${id}`, operator, outputs: [id],
    inputs: { ...(operator === "polyline" ? { points } : { start: points[0], end: points[1] }), ...extra },
  }) as Construction));
  document.entities.push(...helpers.map((helper) => ent(helper.outputs[0]!, helper.id === "c_lp" ? "line" : "point", "construction helper")),
    ...paths.map(({ id, operator, role, kind, dashed }) => dashedWhen(dashed === true, ent(id, kind ?? operator, role ?? "light ray"))));
  document.requiredEntityIds.push(...paths.map(({ id }) => id));
  document.revealGroups = document.revealGroups.map((group) =>
    group.id === "rays" ? { ...group, entityIds: [...group.entityIds, ...paths.map(({ id }) => id)] } : group);
  return document;
};
const lensWith = (paths: HandPathInput[], rays = ["parallel", "focal", "central"]) =>
  handPaths(tallLens(rays), "O", "F2", paths);
const mirrorWith = (paths: HandPathInput[], rays = ["parallel", "central"]) =>
  handPaths(traced(goodMirror, rays), "P", "F", paths);
{
  // The review's figures: each carries three traced rays that prove the image, plus one wrong ray.
  for (const [name, question, turnPlan, document, reason] of [
    ["a segment from the object base to the image tip", qTall, tallPlan, lensWith([["x1", "segment", "ob", "it"]]),
      /^ray x1 neither runs from the object tip to the lens nor leaves it \(it touches the object base\)$/],
    ["a hand parallel ray bent back to F1", qTall, tallPlan, lensWith([["x1", "segment", "ot", "S"], ["x2", "segment", "S", "F1"]]),
      /^ray x2 leaves the lens at S off the line to the image tip/],
    ["a hand parallel ray refracted to the image base, on the far side but off its line", qTall, tallPlan,
      lensWith([["x1", "segment", "ot", "S"], ["x2", "segment", "S", "ib"]]), /^ray x2 leaves the lens at S off the line to the image tip/],
    ["a vector from the object tip straight to F2", qTall, tallPlan, lensWith([["x1", "vector", "ot", "F2"]]),
      /^ray x1 neither runs from the object tip to the lens nor leaves it$/],
    ["a vector from the image tip back to F1", qTall, tallPlan, lensWith([["x1", "vector", "it", "F1"]]),
      /^ray x1 neither runs from the object tip to the lens nor leaves it$/],
    ["the parallel ray's true line drawn back across the lens", qTall, tallPlan, lensWith([["x1", "segment", "ot", "S"], ["x2", "segment", "S", "Sback"]]),
      /^ray x2 runs back across the lens toward the object/],
    ["a refracted ray with no incident ray", qTall, tallPlan, lensWith([["x1", "ray", "S", "F2"]]),
      /^ray x1 has no drawn incident ray from the object tip to S$/],
    ["a concave mirror's parallel ray drawn on behind the mirror", qMirror, mirrorPlan, mirrorWith([["x1", "segment", "ot", "S"], ["x2", "segment", "S", "Sback"]]),
      /^ray x2 runs behind the mirror/],
  ] as const) {
    expectUnproven("G19", name, question, document, reason);
    expectNeverPlanner("G19", name, question, turnPlan, document);
  }
  // Controls: traced rays alone, and a correct hand third ray beside two traced ones, still prove and draw.
  for (const [name, question, turnPlan, document] of [
    ["the review's lens with only its three traced rays", qTall, tallPlan, tallLens(["parallel", "focal", "central"])],
    ["a hand focal ray (ot to S2, then on through the image tip) beside traced parallel and central rays", qTall, tallPlan,
      lensWith([["x1", "segment", "ot", "S2"], ["x2", "ray", "S2", "it"]], ["parallel", "central"])],
    ["a hand parallel ray (ot to S, then on through F2) beside traced focal and central rays", qTall, tallPlan,
      lensWith([["x1", "segment", "ot", "S"], ["x2", "ray", "S", "F2"]], ["focal", "central"])],
    ["a concave mirror's hand focal ray beside traced parallel and central rays", qMirror, mirrorPlan,
      mirrorWith([["x1", "segment", "ot", "S2"], ["x2", "segment", "S2", "it"]])],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G19", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G19", name, question, turnPlan, document);
  }
}

// ---- G20: a stem that names no element kind takes it from the image it states, or declines ----
{
  const mirror15 = (question: string, kind: "concave" | "convex", f = 10) =>
    mirrorDoc(question, { u: 15, f, h: 2, kind, quantities: [{ id: "u", symbol: "u", value: 15 }, { id: "f", symbol: "f", value: f }] });
  // The review's case: a convex mirror cannot form a real image of a real object.
  const qRealMirror = "A mirror of focal length 10 cm forms a real image of an object placed at 15 cm. Draw the ray diagram.";
  const realMirrorPlan = plan(qRealMirror, [
    { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
    { id: "u", symbol: "u", value: 15, unit: "cm", provenance: "given", sourceText: "placed at 15 cm" },
  ], [{ id: "v", symbol: "v", value: 30, unit: "cm", provenance: "derived" }], ["mirror_formula"]);
  expectUnproven("G20", "a convex mirror on the real image stem", qRealMirror, mirror15(qRealMirror, "convex"), /contradicts a concave mirror/);
  expectNeverPlanner("G20", "a convex mirror on the real image stem", qRealMirror, realMirrorPlan, mirror15(qRealMirror, "convex"));
  check("G20", explainPlannerOpticsProof(qRealMirror, mirror15(qRealMirror, "concave")).proof === "proven",
    `the concave mirror on the real image stem must be proven; got ${explainPlannerOpticsProof(qRealMirror, mirror15(qRealMirror, "concave")).reason}`);
  expectDrawnAsPlanner("G20", "the concave mirror on the real image stem", qRealMirror, realMirrorPlan, mirror15(qRealMirror, "concave"));
  // The stated nature or side decides; the other kind stays unproven.
  const lensFigure = (question: string, form: "converging" | "diverging", u: number, f: number): Doc => form === "converging"
    ? lensDoc(question, { u, f, h: 2 })
    : divergingLens(question, { u, f, h: 2, unit: "cm", scale: 1, focal: f, quantities: [{ id: "u", symbol: "u", value: u, unit: "cm" }] });
  for (const [name, question, right, wrong, reason] of [
    ["a lens forming a real, magnified image", "A lens forms a real, magnified image of an object placed 15 cm from it. Draw the ray diagram.",
      lensFigure("", "converging", 15, 10), lensFigure("", "diverging", 15, 10), /contradicts a convex lens/],
    ["a lens forming a virtual, diminished image", "A lens forms a virtual, diminished image of an object placed 50 cm from it. Draw the ray diagram.",
      lensFigure("", "diverging", 50, 25), lensFigure("", "converging", 50, 25), /contradicts a concave lens/],
    ["a mirror forming a virtual, magnified image", "A mirror of focal length 30 cm forms a virtual, magnified image of an object at 15 cm. Draw the ray diagram.",
      mirror15("", "concave", 30), mirror15("", "convex", 30), /contradicts a concave mirror/],
    ["a mirror forming an image 30 cm behind it (virtual, larger than the object)", "An object placed 15 cm in front of a mirror forms an image 30 cm behind it. Draw the ray diagram.",
      mirror15("", "concave", 30), mirror15("", "convex", 30), /contradicts a concave mirror/],
    ["a mirror forming an image 6 cm behind it (virtual, smaller than the object)", "An object placed 15 cm in front of a mirror forms an image 6 cm behind it. Draw the ray diagram.",
      mirror15("", "convex"), mirror15("", "concave"), /contradicts a convex mirror/],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, right);
    check("G20", proof.proof === "proven", `the right kind for ${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectUnproven("G20", `the wrong kind for ${name}`, question, wrong, reason);
  }
  // Nothing in the stem states the image, so the kind is unknown: both figures decline and never draw.
  for (const question of [
    "A mirror of focal length 10 cm has an object placed 15 cm in front of it. Draw the ray diagram.",
    "An object 2 cm tall is placed at 15 cm from a spherical mirror of focal length -10 cm. Draw the ray diagram.",
    "A mirror of focal length 10 cm has an object placed 15 cm in front of it. Does it form a real image?",
    "A mirror of focal length 10 cm has an object placed 15 cm in front of it. State whether the image is real.",
    "A mirror of focal length 10 cm forms a virtual or real image of an object 15 cm in front of it, depending on its kind.",
    "A pin stands upright 15 cm in front of a mirror of focal length 10 cm. Draw the ray diagram.",
    "A real object is placed 15 cm from a mirror of focal length 10 cm. Draw the ray diagram.",
  ]) {
    const declinePlan = plan(question, [
      { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
      { id: "u", symbol: "u", value: 15, unit: "cm", provenance: "given", sourceText: "15 cm" },
    ], [], ["mirror_formula"]);
    for (const kind of ["concave", "convex"] as const) {
      expectUnproven("G20", `a ${kind} figure on "${question}"`, question, mirror15(question, kind), /^the stem names no mirror kind/);
      expectNeverPlanner("G20", `a ${kind} figure on "${question}"`, question, declinePlan, mirror15(question, kind));
    }
  }
}

// ---- G21 (P6): the object and image arrows sit on the engine's anchors ----
{
  const tracedLens = traced(goodLensReal, ["parallel", "focal", "central"]);
  check("G21", explainPlannerOpticsProof(qLensReal, tracedLens).proof === "proven", "the traced lens with both arrows on the anchors must be proven");
  /** The traced lens with one arrow redrawn; none of these is a light path, so only P6 reads them. */
  const arrowAs = (id: "c_object" | "c_image", edit: Partial<Construction> | null): Doc => {
    const document = structuredClone(tracedLens);
    const output = id === "c_object" ? "object" : "image";
    if (edit === null) {
      document.constructions = document.constructions.filter((construction) => construction.id !== id);
      document.entities = document.entities.filter((entity) => entity.id !== output);
      document.requiredEntityIds = document.requiredEntityIds.filter((entity) => entity !== output);
      document.revealGroups = document.revealGroups.map((group) => ({ ...group, entityIds: group.entityIds.filter((entity) => entity !== output) }));
      return document;
    }
    document.constructions = document.constructions.map((construction) => construction.id === id ? { ...construction, ...edit } as Construction : construction);
    if (edit.operator) document.entities = document.entities.map((entity) => entity.id === output ? { ...entity, kind: edit.operator! } : entity) as Doc["entities"];
    return document;
  };
  for (const [name, document] of [
    ["an object arrow drawn as a polyline to a tip 5 cm high (the engine's tip is 2 cm)", arrowAs("c_object", { operator: "polyline", inputs: { points: ["ob", [-30, 5]] } })],
    ["an image arrow drawn as a polyline to a tip 3 cm below the axis (the engine's tip is 1 cm)", arrowAs("c_image", { operator: "polyline", inputs: { points: ["ib", [15, -3]] } })],
    ["an object arrow drawn flat along the axis to F1", arrowAs("c_object", { inputs: { start: "ob", end: "F1" } })],
    ["an image arrow drawn flat along the axis to F2", arrowAs("c_image", { inputs: { start: "ib", end: "F2" } })],
    ["no image arrow", arrowAs("c_image", null)],
  ] as const) {
    expectUnproven("G21", name, qLensReal, document, /^object or image arrow is not drawn on the gaussian_image anchors$/);
    expectNeverPlanner("G21", name, qLensReal, lensRealPlan, document);
  }
}

/** Named cases whose own verdict is printed after the gate summary. */
const namedCases: Array<[name: string, failed: number]> = [];
function named(name: string, run: () => void): void {
  const before = failures.length;
  run();
  namedCases.push([name, failures.length - before]);
}

// ---- G22: every open polyline is a light path too; a wrong one beside traced rays never proves ----
{
  const polyline = (id: string, points: string[], role?: string): HandPath => ({ id, operator: "polyline", points, ...(role ? { role } : {}) });
  named("traced principal_rays plus one wrong extra polyline is rejected", () => {
    const document = lensWith([polyline("x1", ["ob", "it"])]);
    expectUnproven("G22", "traced principal_rays plus one wrong extra polyline (a \"light ray\" from the object base to the image tip)", qTall, document,
      /^ray x1 neither runs from the object tip to the lens nor leaves it \(it touches the object base\)$/);
    expectNeverPlanner("G22", "traced principal_rays plus one wrong extra polyline", qTall, tallPlan, document);
  });
  for (const [name, question, turnPlan, document, reason] of [
    ["the same polyline under a helper role", qTall, tallPlan, lensWith([polyline("x1", ["ob", "it"], "construction helper")]),
      /^ray x1 neither runs from the object tip to the lens nor leaves it \(it touches the object base\)$/],
    ["a polyline from the object tip straight to F2", qTall, tallPlan, lensWith([polyline("x1", ["ot", "F2"])]),
      /^ray x1 neither runs from the object tip to the lens nor leaves it$/],
    ["a hand parallel ray drawn as one polyline bent back to F1", qTall, tallPlan, lensWith([polyline("x1", ["ot", "S", "F1"])]),
      /^ray x1 leaves the lens at S off the line to the image tip/],
    ["a concave mirror's polyline from the object base to the image tip", qMirror, mirrorPlan, mirrorWith([polyline("x1", ["ob", "it"])]),
      /^ray x1 neither runs from the object tip to the mirror nor leaves it \(it touches the object base\)$/],
  ] as const) {
    expectUnproven("G22", name, question, document, reason);
    expectNeverPlanner("G22", name, question, turnPlan, document);
  }
  // Controls: traced rays alone, and a correct hand third ray drawn as one polyline, still prove and draw.
  for (const [name, question, turnPlan, document] of [
    ["the review's lens with only its three traced rays", qTall, tallPlan, tallLens(["parallel", "focal", "central"])],
    ["a hand parallel ray as one polyline (object tip, S, image tip) beside traced focal and central rays", qTall, tallPlan,
      lensWith([polyline("x1", ["ot", "S", "it"])], ["focal", "central"])],
    ["a concave mirror's hand focal ray as one polyline (object tip, S2, image tip) beside traced parallel and central rays", qMirror, mirrorPlan,
      mirrorWith([polyline("x1", ["ot", "S2", "it"])])],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G22", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G22", name, question, turnPlan, document);
  }
}

// ---- G23: a direction redraws a vector off its end, so a proof-owned vector carries none ----
{
  const tracedLens = traced(goodLensReal, ["parallel", "focal", "central"]);
  const redirected = (id: "c_object" | "c_image", direction: [number, number]): Doc => {
    const document = structuredClone(tracedLens);
    document.constructions.find((construction) => construction.id === id)!.inputs.direction = direction;
    return document;
  };
  for (const [name, document, reason] of [
    ["an object arrow kept on ob and ot with direction [1, 0] (the compiler lays it flat along the axis)", redirected("c_object", [1, 0]),
      /^object or image arrow object carries a direction, which the compiler draws in place of its end$/],
    ["an image arrow kept on ib and it with direction [0, 1] (the compiler draws the inverted image upright)", redirected("c_image", [0, 1]),
      /^object or image arrow image carries a direction, which the compiler draws in place of its end$/],
  ] as const) {
    expectUnproven("G23", name, qLensReal, document, reason);
    expectNeverPlanner("G23", name, qLensReal, lensRealPlan, document);
  }
  // A hand parallel ray whose incident vector ot to S is redrawn up and away by a direction.
  const handVector = (extra?: Record<string, unknown>) =>
    lensWith([{ id: "x1", operator: "vector", points: ["ot", "S"], ...(extra ? { extra } : {}) }, ["x2", "ray", "S", "F2"]], ["focal", "central"]);
  expectUnproven("G23", "a hand incident vector ot to S with direction [1, 1]", qTall, handVector({ direction: [1, 1] }),
    /^ray x1 carries a direction, which the compiler draws in place of its end$/);
  expectNeverPlanner("G23", "a hand incident vector ot to S with direction [1, 1]", qTall, tallPlan, handVector({ direction: [1, 1] }));
  // Controls: the arrows and the hand vector on their ends prove and draw.
  for (const [name, question, turnPlan, document] of [
    ["the traced lens with a correct object arrow (start ob, end ot)", qLensReal, lensRealPlan, tracedLens],
    ["a hand incident vector ot to S, then a ray on through F2, beside traced focal and central rays", qTall, tallPlan, handVector()],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G23", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G23", name, question, turnPlan, document);
  }
}

// ---- G24: an image distance the stem states is the one the engine draws, on the stated side ----
{
  const mirrorAt = (question: string, u: number, f: number) =>
    mirrorDoc(question, { u, f, h: 2, kind: "concave", quantities: [{ id: "u", symbol: "u", value: u }, { id: "f", symbol: "f", value: f }] });
  const stated = (question: string, u: number, v: number, f: number, law: string) => plan(question, [
    { id: "u", symbol: "u", value: u, unit: "cm", provenance: "given", sourceText: `${u} cm` },
    { id: "v", symbol: "v", value: v, unit: "cm", provenance: "given", sourceText: `${v} cm` },
  ], [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "derived" }], [law]);
  const qBehind = "An object placed 15 cm in front of a mirror forms an image 30 cm behind it. Draw the ray diagram.";
  const qFront = "An object placed 15 cm in front of a mirror forms an image 30 cm in front of it. Draw the ray diagram.";
  const qOther = "An object placed 20 cm from a lens forms an image 60 cm on the other side of it. Draw the ray diagram.";
  const qLensBehind = "An object placed 20 cm in front of a convex lens forms an image 60 cm behind the lens. Draw the ray diagram.";
  for (const [name, question, turnPlan, document, reason] of [
    // The review's figure: u = -15 and f = -20 put the image 60 cm behind the mirror.
    ["a concave mirror of f 20 cm on the 30 cm behind stem (image 60 cm behind)", qBehind, stated(qBehind, 15, 30, 30, "mirror_formula"),
      mirrorAt(qBehind, 15, 20), /^the image at 60 cm behind the mirror contradicts the stem's image 30 cm behind it$/],
    ["a concave mirror of f 30 cm on the 30 cm in front stem (image 30 cm behind, the wrong side)", qFront, stated(qFront, 15, 30, 10, "mirror_formula"),
      mirrorAt(qFront, 15, 30), /^the image at 30 cm behind the mirror contradicts the stem's image 30 cm in front of it$/],
    ["a convex lens of f 10 cm on the 60 cm other side stem (image 20 cm)", qOther, stated(qOther, 20, 60, 15, "lens_formula"),
      lensDoc(qOther, { u: 20, f: 10, h: 2 }), /^the image at 20 cm on the far side of the lens contradicts the stem's image 60 cm on the other side of it$/],
    ["a convex lens of f 10 cm on the 60 cm behind the lens stem (image 20 cm, side unread)", qLensBehind, stated(qLensBehind, 20, 60, 15, "lens_formula"),
      lensDoc(qLensBehind, { u: 20, f: 10, h: 2 }), /^the image at 20 cm on the far side of the lens contradicts the stem's image 60 cm behind the lens$/],
  ] as const) {
    expectUnproven("G24", name, question, document, reason);
    expectNeverPlanner("G24", name, question, turnPlan, document);
  }
  // Controls: the stated distance on the stated side proves and draws; 33.3 cm is 33.33 cm within 1 percent.
  for (const [name, question, turnPlan, document] of [
    ["a concave mirror of f 30 cm on the 30 cm behind stem", qBehind, stated(qBehind, 15, 30, 30, "mirror_formula"), mirrorAt(qBehind, 15, 30)],
    ["a concave mirror of f 10 cm on the 30 cm in front stem", qFront, stated(qFront, 15, 30, 10, "mirror_formula"), mirrorAt(qFront, 15, 10)],
    ["a convex lens of f 15 cm on the 60 cm other side stem", qOther, stated(qOther, 20, 60, 15, "lens_formula"), lensDoc(qOther, { u: 20, f: 15, h: 2 })],
    ["a convex lens of f 15 cm on the 60 cm behind the lens stem", qLensBehind, stated(qLensBehind, 20, 60, 15, "lens_formula"), lensDoc(qLensBehind, { u: 20, f: 15, h: 2 })],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G24", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G24", name, question, turnPlan, document);
  }
  // A place against the object is no side of the mirror: 6 cm behind the object is a real image 18 cm in
  // front of the mirror (f 7.2 cm), never a virtual one 6 cm behind it. The stem states no kind, so both decline.
  const qObject = "An object is placed 12 cm in front of a mirror of focal length 7.2 cm, and its image forms 6 cm behind the object. Draw the ray diagram.";
  const objectPlan = plan(qObject, [
    { id: "u", symbol: "u", value: 12, unit: "cm", provenance: "given", sourceText: "12 cm" },
    { id: "f", symbol: "f", value: 7.2, unit: "cm", provenance: "given", sourceText: "focal length 7.2 cm" },
  ], [{ id: "v", symbol: "v", value: 18, unit: "cm", provenance: "derived" }], ["mirror_formula"]);
  for (const kind of ["concave", "convex"] as const) {
    const document = mirrorDoc(qObject, { u: 12, f: 7.2, h: 2, kind, quantities: [{ id: "u", symbol: "u", value: 12 }, { id: "f", symbol: "f", value: 7.2 }] });
    expectUnproven("G24", `a ${kind} mirror on the 6 cm behind the object stem`, qObject, document, /^the stem names no mirror kind/);
    expectNeverPlanner("G24", `a ${kind} mirror on the 6 cm behind the object stem`, qObject, objectPlan, document);
  }
  const qRounded = "An object placed 20 cm in front of a mirror forms an image 33.3 cm in front of it. Draw the ray diagram.";
  const rounded = explainPlannerOpticsProof(qRounded, mirrorAt(qRounded, 20, 12.5));
  check("G24", rounded.proof === "proven", `an image 33.33 cm in front on a 33.3 cm stem must be proven (1 percent); got ${rounded.proof}: ${rounded.reason}`);
}

// ---- G25: a question reads the facts stated before it asks ----
{
  const mirror15 = (question: string, kind: "concave" | "convex") =>
    mirrorDoc(question, { u: 15, f: 10, h: 2, kind, quantities: [{ id: "u", symbol: "u", value: 15 }, { id: "f", symbol: "f", value: 10 }] });
  const mirrorPlanFor = (question: string, derived: TurnPlanV3["derived"]) => plan(question, [
    { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
    { id: "u", symbol: "u", value: 15, unit: "cm", provenance: "given", sourceText: "15 cm" },
  ], derived, ["mirror_formula"]);
  // The review's case: the real image is stated before the question.
  const qWhere = "A mirror of focal length 10 cm forms a real image of an object placed at 15 cm; where does the image form?";
  const wherePlan = mirrorPlanFor(qWhere, [{ id: "v", symbol: "v", value: 30, unit: "cm", provenance: "derived" }]);
  const concave = explainPlannerOpticsProof(qWhere, mirror15(qWhere, "concave"));
  check("G25", concave.proof === "proven", `the concave mirror on "${qWhere}" must be proven; got ${concave.proof}: ${concave.reason}`);
  expectDrawnAsPlanner("G25", `the concave mirror on "${qWhere}"`, qWhere, wherePlan, mirror15(qWhere, "concave"));
  expectUnproven("G25", `the convex mirror on "${qWhere}"`, qWhere, mirror15(qWhere, "convex"), /contradicts a concave mirror/);
  expectNeverPlanner("G25", `the convex mirror on "${qWhere}"`, qWhere, wherePlan, mirror15(qWhere, "convex"));
  const lensFigure = (form: "converging" | "diverging", u: number, f: number): Doc => form === "converging"
    ? lensDoc("", { u, f, h: 2 })
    : divergingLens("", { u, f, h: 2, unit: "cm", scale: 1, focal: f, quantities: [{ id: "u", symbol: "u", value: u, unit: "cm" }] });
  for (const [question, right, wrong, reason] of [
    ["A lens forms a virtual, diminished image of an object placed 50 cm from it, so what is its focal length?",
      lensFigure("diverging", 50, 25), lensFigure("converging", 50, 25), /contradicts a concave lens/],
    ["A lens forms a real, magnified image of an object placed 15 cm from it, and how far away is the image?",
      lensFigure("converging", 15, 10), lensFigure("diverging", 15, 10), /contradicts a convex lens/],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, right);
    check("G25", proof.proof === "proven", `the right kind on "${question}" must be proven; got ${proof.proof}: ${proof.reason}`);
    expectUnproven("G25", `the wrong kind on "${question}"`, question, wrong, reason);
  }
  // A question that states no nature before it asks still declines both kinds.
  for (const question of [
    "A mirror of focal length 10 cm has an object placed 15 cm in front of it; is the image real?",
    "Where does a mirror of focal length 10 cm form a real image of an object placed at 15 cm?",
    "An object is placed 15 cm in front of a mirror of focal length 10 cm, and is its image real or virtual?",
    "A mirror of focal length 10 cm has an object 15 cm in front of it, does it form a real image?",
  ]) {
    for (const kind of ["concave", "convex"] as const) {
      expectUnproven("G25", `a ${kind} figure on "${question}"`, question, mirror15(question, kind), /^the stem names no mirror kind/);
      expectNeverPlanner("G25", `a ${kind} figure on "${question}"`, question, mirrorPlanFor(question, []), mirror15(question, kind));
    }
  }
}

// ---- G26: on a virtual image figure the back side of S is only the extension: dashed, no arrow ----
{
  // The diverging lens (f -25 cm, u 50 cm: image 16.7 cm on the object's side) and the convex car mirror
  // (image 10.8 cm behind it), each proven by traced rays. S is the parallel ray's hit; F2 (lens) and F
  // (mirror) are the virtual foci, so Sback, the focus turned half a turn about S, lies on the side the
  // reflected or refracted light leaves toward.
  const virtualLens = (paths: HandPathInput[], rays = ["parallel", "focal", "central"]) =>
    handPaths(traced(cmLens(-25), rays), "O", "F2", paths);
  const virtualMirror = (paths: HandPathInput[], rays = ["parallel", "focal", "central"]) =>
    handPaths(traced(goodConvex, rays), "P", "F", paths);
  const incident: HandPathInput = ["x1", "segment", "ot", "S"];
  for (const [name, question, turnPlan, document, reason] of [
    // The review's case: arrows on the same ray pointing opposite ways.
    ["a diverging lens's hand incident segment ot to S and a solid vector S to it", qDiverging, signedPlan,
      virtualLens([incident, ["x2", "vector", "S", "it"]]), /^ray x2 runs back across the lens toward the object as an arrow/],
    ["a convex mirror's hand incident segment ot to S and a solid vector S to it", qConvex, convexPlan,
      virtualMirror([incident, ["x2", "vector", "S", "it"]]), /^ray x2 runs behind the mirror as an arrow/],
    ["a diverging lens's ray from S through it", qDiverging, signedPlan,
      virtualLens([incident, ["x2", "ray", "S", "it"]]), /^ray x2 runs back across the lens toward the object as an arrow/],
    ["a convex mirror's ray from S through it", qConvex, convexPlan,
      virtualMirror([incident, ["x2", "ray", "S", "it"]]), /^ray x2 runs behind the mirror as an arrow/],
    ["a diverging lens's solid segment S to it", qDiverging, signedPlan,
      virtualLens([incident, ["x2", "segment", "S", "it"]]), /^ray x2 runs back across the lens toward the object as solid ink/],
    ["a convex mirror's solid segment S to it", qConvex, convexPlan,
      virtualMirror([incident, ["x2", "segment", "S", "it"]]), /^ray x2 runs behind the mirror as solid ink/],
    ["a diverging lens's solid line through S and it (light on one side of S, the extension on the other)", qDiverging, signedPlan,
      virtualLens([incident, ["x2", "line", "S", "it"]]), /^ray x2 runs back across the lens toward the object as solid ink/],
    ["a diverging lens's dashed segment S to it whose entity is a vector (drawn with an arrowhead)", qDiverging, signedPlan,
      virtualLens([incident, { id: "x2", operator: "segment", points: ["S", "it"], kind: "vector", dashed: true }]),
      /^ray x2 runs back across the lens toward the object as an arrow/],
    ["a diverging lens's chief vector from the optical centre back to it", qDiverging, signedPlan,
      virtualLens([["x2", "vector", "O", "it"]]), /^chief ray x2 points back toward the object, against its light$/],
    ["a magnifier's solid chief segment from the object tip back to its virtual image", qLens, lensPlan,
      handPaths(traced(goodLens, ["parallel", "focal"]), "O", "F2", [["x2", "segment", "ot", "it"]]),
      /^chief ray x2 runs back past the object tip to the virtual image as solid ink/],
    // The chief line's arrow rule holds on a real image too.
    ["a chief vector from a real image tip back to the object tip", qTall, tallPlan, lensWith([["x2", "vector", "it", "ot"]]),
      /^chief ray x2 points back toward the object, against its light$/],
  ] as const) {
    expectUnproven("G26", name, question, document, reason);
    expectNeverPlanner("G26", name, question, turnPlan, document);
  }
  // Controls: traced rays alone; the extension drawn dashed with no arrow beside a directed ray leaving S.
  const allowed = (back: string): HandPathInput[] => [incident, ["x2", "ray", "S", "Sback"], { id: "x3", operator: "segment", points: ["S", back], dashed: true }];
  for (const [name, question, turnPlan, document] of [
    ["the diverging lens with only its traced rays", qDiverging, signedPlan, traced(cmLens(-25), ["parallel", "focal", "central"])],
    ["the convex mirror with only its traced rays", qConvex, convexPlan, traced(goodConvex, ["parallel", "focal", "central"])],
    ["a diverging lens's hand ray leaving S away from F2, with a dashed segment S to it", qDiverging, signedPlan,
      virtualLens(allowed("it"), ["focal", "central"])],
    ["a convex mirror's hand ray leaving S away from F, with a dashed segment S to it", qConvex, convexPlan,
      virtualMirror(allowed("it"), ["focal", "central"])],
    ["a convex mirror's hand vector leaving S away from F, with a dashed segment on to F", qConvex, convexPlan,
      virtualMirror([incident, ["x2", "vector", "S", "Sback"], { id: "x3", operator: "segment", points: ["S", "F"], dashed: true }], ["focal", "central"])],
    ["a magnifier's dashed chief segment from the object tip back to its virtual image", qLens, lensPlan,
      handPaths(traced(goodLens, ["parallel", "focal"]), "O", "F2", [{ id: "x2", operator: "segment", points: ["ot", "it"], dashed: true }])],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G26", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G26", name, question, turnPlan, document);
  }
  // The allowed extension reaches the board dashed and with no arrowhead.
  const extension = virtualLens(allowed("it"), ["focal", "central"]);
  const { result } = compiled(extension);
  const commands = result.ok && result.renderScene
    ? buildVerifiedDiagramPresentation(extension, result.renderScene).diagram.commands.filter((command) => command.semanticRef?.entityId === "x3" && command.type !== "LABEL")
    : [];
  check("G26", commands.length > 0 && commands.every((command) => command.type === "DRAW_LINE" && command.visualStyle?.dashed === true),
    `the dashed extension S to it must draw as dashed lines with no arrow; got ${commands.map((command) => `${command.type} dashed ${command.visualStyle?.dashed === true}`).join(", ") || "no ink"}`);
}


// ---- G27: the image nature the stem states is the engine image's ----
{
  const naturePlan = (question: string, u: number, f: number, law: string) => plan(question, [
    { id: "u", symbol: "u", value: u, unit: "cm", provenance: "given", sourceText: `${u} cm` },
  ], [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "derived" }], [law]);
  const concaveAt = (question: string, u: number, f: number) =>
    mirrorDoc(question, { u, f, h: 2, kind: "concave", quantities: [{ id: "u", symbol: "u", value: u }, { id: "f", symbol: "f", value: f }] });
  const diverging = (question: string, u: number, f: number) =>
    divergingLens(question, { u, f, h: 2, unit: "cm", scale: 1, focal: f, quantities: [{ id: "u", symbol: "u", value: u, unit: "cm" }] });
  const qRealMagnified = "A lens forms a real, magnified image of an object placed 15 cm from it. Draw the ray diagram.";
  const qRealDiminished = "A concave mirror forms a real, diminished image of an object placed 15 cm in front of it. Draw the ray diagram.";
  const qErectMagnified = "A concave mirror forms an erect, magnified image of an object placed 15 cm in front of it. Draw the ray diagram.";
  const qDiminished = "A diverging lens forms a diminished image of an object placed 50 cm in front of it. Draw the ray diagram.";
  const qRealMagnifiedMirror = "A concave mirror forms a real, magnified image of an object placed 30 cm in front of it. Draw the ray diagram.";
  for (const [name, question, turnPlan, document, reason] of [
    // The review's figure: u = -15 and f = 20 put a virtual image 60 cm on the object's side, four times the object.
    ["a convex lens of f 20 cm on the real, magnified stem (virtual image)", qRealMagnified, naturePlan(qRealMagnified, 15, 20, "lens_formula"),
      lensDoc(qRealMagnified, { u: 15, f: 20, h: 2 }), /^the engine image \(virtual, \|m\| = 4\) contradicts the stem's real image$/],
    ["a concave mirror of f 10 cm on the real, diminished stem (|m| = 2)", qRealDiminished, naturePlan(qRealDiminished, 15, 10, "mirror_formula"),
      concaveAt(qRealDiminished, 15, 10), /^the engine image \(real, \|m\| = 2\) contradicts the stem's diminished image$/],
    ["a concave mirror of f 10 cm on the erect, magnified stem (real image)", qErectMagnified, naturePlan(qErectMagnified, 15, 10, "mirror_formula"),
      concaveAt(qErectMagnified, 15, 10), /^the engine image \(real, \|m\| = 2\) contradicts the stem's virtual image$/],
    ["a concave mirror of f 10 cm on the real, magnified stem at 30 cm (|m| = 0.5)", qRealMagnifiedMirror, naturePlan(qRealMagnifiedMirror, 30, 10, "mirror_formula"),
      concaveAt(qRealMagnifiedMirror, 30, 10), /^the engine image \(real, \|m\| = 0.5\) contradicts the stem's enlarged image$/],
  ] as const) {
    expectUnproven("G27", name, question, document, reason);
    expectNeverPlanner("G27", name, question, turnPlan, document);
  }
  // Controls: the same stems drawn with the stated nature prove and draw.
  for (const [name, question, turnPlan, document] of [
    ["a convex lens of f 10 cm on the real, magnified stem (real, |m| = 2)", qRealMagnified, naturePlan(qRealMagnified, 15, 10, "lens_formula"),
      lensDoc(qRealMagnified, { u: 15, f: 10, h: 2 })],
    ["a concave mirror of f 5 cm on the real, diminished stem (|m| = 0.5)", qRealDiminished, naturePlan(qRealDiminished, 15, 5, "mirror_formula"),
      concaveAt(qRealDiminished, 15, 5)],
    ["a concave mirror of f 30 cm on the erect, magnified stem (virtual, |m| = 2)", qErectMagnified, naturePlan(qErectMagnified, 15, 30, "mirror_formula"),
      concaveAt(qErectMagnified, 15, 30)],
    ["a diverging lens of f 25 cm on the diminished stem (virtual, |m| = 1/3)", qDiminished, naturePlan(qDiminished, 50, 25, "lens_formula"),
      diverging(qDiminished, 50, 25)],
    ["a concave mirror of f 20 cm on the real, magnified stem at 30 cm (|m| = 2)", qRealMagnifiedMirror, naturePlan(qRealMagnifiedMirror, 30, 20, "mirror_formula"),
      concaveAt(qRealMagnifiedMirror, 30, 20)],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G27", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G27", name, question, turnPlan, document);
  }
  // A stem that asks about the nature, or names a real object, states none: a diminished or a virtual image still proves.
  for (const [question, u, f] of [
    ["A convex lens of focal length 10 cm has an object placed 30 cm from it. Is the image magnified?", 30, 10],
    ["A convex lens of focal length 10 cm has an object placed 30 cm from it; is the image magnified or diminished?", 30, 10],
    ["A convex lens of focal length 20 cm has an object placed 15 cm from it. Is the image real or virtual?", 15, 20],
    ["A convex lens of focal length 20 cm forms a real or virtual image of an object 15 cm from it, depending on where it stands.", 15, 20],
    ["A convex lens of focal length 20 cm has an object placed 15 cm from it. State whether the image is real and magnified.", 15, 20],
    ["A real object is placed 15 cm from a convex lens of focal length 20 cm. Draw the ray diagram.", 15, 20],
  ] as const) {
    const document = lensDoc(question, { u, f, h: 2 });
    const result = explainPlannerOpticsProof(question, document);
    check("G27", result.proof === "proven", `the lens on "${question}" must be proven; got ${result.proof}: ${result.reason}`);
  }
  const qAsks = "A convex lens of focal length 10 cm has an object placed 30 cm from it. Is the image magnified?";
  expectDrawnAsPlanner("G27", `the diminished image on "${qAsks}"`, qAsks, plan(qAsks, [
    { id: "f", symbol: "f", value: 10, unit: "cm", provenance: "given", sourceText: "focal length 10 cm" },
    { id: "u", symbol: "u", value: 30, unit: "cm", provenance: "given", sourceText: "30 cm" },
  ], [{ id: "v", symbol: "v", value: 15, unit: "cm", provenance: "derived" }], ["lens_formula"]), lensDoc(qAsks, { u: 30, f: 10, h: 2 }));
}

// ---- G28: a negated nature or side states nothing; the engine image must not be what it denies ----
{
  // f is given when the stem states it, else derived (G27).
  const lensPlanFor = (question: string, u: number, f: number, given = true) => plan(question, [
    { id: "u", symbol: "u", value: u, unit: "cm", provenance: "given", sourceText: `${u} cm` },
    ...(given ? [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "given" as const, sourceText: `focal length ${f} cm` }] : []),
  ], given ? [{ id: "v", symbol: "v", value: f * u / Math.abs(u - f), unit: "cm", provenance: "derived" }]
    : [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "derived" }], ["lens_formula"]);
  const mirrorPlanFor = (question: string, u: number, f: number) => plan(question, [
    { id: "u", symbol: "u", value: u, unit: "cm", provenance: "given", sourceText: `${u} cm` },
  ], [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "derived" }], ["mirror_formula"]);
  const concaveAt = (question: string, u: number, f: number) =>
    mirrorDoc(question, { u, f, h: 2, kind: "concave", quantities: [{ id: "u", symbol: "u", value: u }, { id: "f", symbol: "f", value: f }] });
  const diverging = (question: string, u: number, f: number) =>
    divergingLens(question, { u, f, h: 2, unit: "cm", scale: 1, focal: f, quantities: [{ id: "u", symbol: "u", value: u, unit: "cm" }] });
  const lens20 = (verb: string, u: number) => `A lens of focal length 20 cm ${verb} of an object placed ${u} cm from it. Draw the ray diagram.`;
  // The review's stem: a convex lens of f 20 cm with the object at 15 cm forms a virtual image, as it says.
  const qReview = "A convex lens of focal length 20 cm does not form a real image of an object placed 15 cm from it. Draw the ray diagram.";
  const qSideNamed = "A concave mirror forms a magnified image of an object placed 15 cm in front of it, and the image does not form behind the mirror. Draw the ray diagram.";
  const qSideNo = "A concave mirror forms a magnified image of an object placed 15 cm in front of it; no image forms behind the mirror. Draw the ray diagram.";
  const qSideUnnamed = "A mirror forms a magnified image of an object placed 15 cm in front of it, and the image does not form behind the mirror. Draw the ray diagram.";
  const qLensSide = "A lens forms a diminished image of an object placed 50 cm from it; the image does not form on the same side as the object. Draw the ray diagram.";
  const qUnnamed = "A lens does not form a real image of an object placed 30 cm from it. Draw the ray diagram.";
  // Wrong figures: an unsigned focal length of 20 cm reads as a convex lens, which at 30 cm forms a
  // real image 60 cm away, twice the object: the very image each stem denies.
  const realImage = /^the engine image \(real, \|m\| = 2\) is the (?:real|inverted|magnified|real, magnified) image the stem denies$/;
  const wrong: Array<[string, string, TurnPlanV3, Doc, RegExp]> = [
    ...[
      "does not form a real image", "doesn't form a real image", "cannot form a real image", "never forms a real image",
      "forms no real image", "forms neither a real nor an inverted image", "forms an image which is not real",
      "forms an image that isn't inverted", "does not form an image which is real", "does not form a magnified image",
      "does not form a real, magnified image",
    ].map((verb): [string, string, TurnPlanV3, Doc, RegExp] => [`a convex lens of f 20 cm at 30 cm on "${verb}"`, lens20(verb, 30),
      lensPlanFor(lens20(verb, 30), 30, 20), lensDoc(lens20(verb, 30), { u: 30, f: 20, h: 2 }), realImage]),
    // No kind named and no focal length: the denial implies no kind, so the stem declines.
    ["a convex lens of f 20 cm at 30 cm on the unnamed lens that does not form a real image", qUnnamed, lensPlanFor(qUnnamed, 30, 20, false),
      lensDoc(qUnnamed, { u: 30, f: 20, h: 2 }), /^the stem names no lens kind/],
    // A negated side: the image is not behind the mirror, so it is real, not the virtual image of f 20 cm (|m| = 4).
    ["a concave mirror of f 20 cm on the image that does not form behind the mirror", qSideNamed, mirrorPlanFor(qSideNamed, 15, 20),
      concaveAt(qSideNamed, 15, 20), /^the engine image \(virtual, \|m\| = 4\) is the virtual image the stem denies$/],
    ["a concave mirror of f 20 cm on no image forming behind the mirror", qSideNo, mirrorPlanFor(qSideNo, 15, 20),
      concaveAt(qSideNo, 15, 20), /^the engine image \(virtual, \|m\| = 4\) is the virtual image the stem denies$/],
    ["a concave mirror of f 20 cm on the unnamed mirror whose image does not form behind it", qSideUnnamed, mirrorPlanFor(qSideUnnamed, 15, 20),
      concaveAt(qSideUnnamed, 15, 20), /^the stem names no mirror kind/],
    ["a diverging lens of f 25 cm on the image that does not form on the object's side", qLensSide, lensPlanFor(qLensSide, 50, 25, false),
      diverging(qLensSide, 50, 25), /^the stem names no lens kind/],
  ];
  for (const [name, question, turnPlan, document, reason] of wrong) {
    expectUnproven("G28", name, question, document, reason);
    expectNeverPlanner("G28", name, question, turnPlan, document);
  }
  // Controls: a figure without the denied nature proves and draws, and an affirmative stem still holds.
  const qAffirmative = lens20("forms a real image", 30);
  const qAffirmativeVirtual = lens20("forms a real image", 15);
  const qParallax = "A lens forms an image of an object placed 30 cm from it, and a pin shows no parallax with the inverted image. Draw the ray diagram.";
  for (const [name, question, turnPlan, document] of [
    ["the review's convex lens of f 20 cm at 15 cm (virtual, |m| = 4)", qReview, lensPlanFor(qReview, 15, 20), lensDoc(qReview, { u: 15, f: 20, h: 2 })],
    ["a convex lens of f 20 cm at 15 cm on the unnamed lens that does not form a real image", lens20("does not form a real image", 15),
      lensPlanFor(lens20("does not form a real image", 15), 15, 20), lensDoc(lens20("does not form a real image", 15), { u: 15, f: 20, h: 2 })],
    ["a convex lens of f 20 cm at 15 cm on the image that is not real", lens20("forms an image which is not real", 15),
      lensPlanFor(lens20("forms an image which is not real", 15), 15, 20), lensDoc(lens20("forms an image which is not real", 15), { u: 15, f: 20, h: 2 })],
    ["a convex lens of f 20 cm at 60 cm on the lens that does not form a real, magnified image (real, |m| = 0.5)",
      lens20("does not form a real, magnified image", 60), lensPlanFor(lens20("does not form a real, magnified image", 60), 60, 20),
      lensDoc(lens20("does not form a real, magnified image", 60), { u: 60, f: 20, h: 2 })],
    ["a concave mirror of f 10 cm on the image that does not form behind the mirror (real, |m| = 2)", qSideNamed, mirrorPlanFor(qSideNamed, 15, 10),
      concaveAt(qSideNamed, 15, 10)],
    ["a convex lens of f 20 cm at 30 cm on the affirmative real image", qAffirmative, lensPlanFor(qAffirmative, 30, 20),
      lensDoc(qAffirmative, { u: 30, f: 20, h: 2 })],
    ["a convex lens of f 20 cm at 30 cm on the inverted image a pin shows no parallax with", qParallax, lensPlanFor(qParallax, 30, 20, false),
      lensDoc(qParallax, { u: 30, f: 20, h: 2 })],
  ] as const) {
    const result = explainPlannerOpticsProof(question, document);
    check("G28", result.proof === "proven", `${name} must be proven; got ${result.proof}: ${result.reason}`);
    expectDrawnAsPlanner("G28", name, question, turnPlan, document);
  }
  // The affirmative stem still refuses the image it contradicts, and the inverted image a pin sees still implies the kind.
  expectUnproven("G28", "a convex lens of f 20 cm at 15 cm on the affirmative real image", qAffirmativeVirtual,
    lensDoc(qAffirmativeVirtual, { u: 15, f: 20, h: 2 }), /^the engine image \(virtual, \|m\| = 4\) contradicts the stem's real image$/);
  expectNeverPlanner("G28", "a convex lens of f 20 cm at 15 cm on the affirmative real image", qAffirmativeVirtual,
    lensPlanFor(qAffirmativeVirtual, 15, 20), lensDoc(qAffirmativeVirtual, { u: 15, f: 20, h: 2 }));
  expectUnproven("G28", "a diverging lens on the inverted image a pin shows no parallax with", qParallax,
    diverging(qParallax, 30, 20), /contradicts a convex lens/);
}

// ---- G29: every line that can show light is a light path; only the axis and lines across it are not ----
{
  // Beside the traced rays that prove the image (the convex lens of G19, real image 15 cm on, and the
  // concave mirror of G1), one more line.
  const line = (id: string, points: string[], kind: string, role: string, extra?: Record<string, unknown>): HandPath =>
    ({ id, operator: "line", points, kind, role, ...(extra ? { extra } : {}) });
  const baseRule = /^ray (\w+) neither runs from the object tip to the (?:lens|mirror) nor leaves it \(it touches the object base\)$/;
  for (const [name, question, turnPlan, document, reason] of [
    // The review's case: a vector entity, which the compiler draws with an arrowhead, named a light path.
    ["a line from the object base to the image tip, a vector entity named light path", qTall, tallPlan,
      lensWith([line("x1", ["ob", "it"], "vector", "light path")]), baseRule],
    ["the same line named light path with no arrowhead", qTall, tallPlan, lensWith([line("x1", ["ob", "it"], "line", "light path")]), baseRule],
    ["a concave mirror's line from the object base to the image tip, a vector entity named light path", qMirror, mirrorPlan,
      mirrorWith([line("x1", ["ob", "it"], "vector", "light path")]), baseRule],
    ["a line from the object base to the image tip, a ray entity named construction helper", qTall, tallPlan,
      lensWith([line("x1", ["ob", "it"], "ray", "construction helper")]), baseRule],
    ["a line from the object base to the image tip named an incident beam", qTall, tallPlan,
      lensWith([line("x1", ["ob", "it"], "line", "incident beam")]), baseRule],
    ["a line from the object base to the image tip whose id names a path", qTall, tallPlan,
      lensWith([line("path1", ["ob", "it"], "line", "construction helper")]), baseRule],
    // Unmarked: drawn across the figure at a slant, a line can only show light.
    ["an unmarked line from the object base to the image tip", qTall, tallPlan,
      lensWith([line("x1", ["ob", "it"], "line", "construction helper")]), baseRule],
    ["an unmarked line along the refracted parallel ray, beside its incident segment", qTall, tallPlan,
      lensWith([["x1", "segment", "ot", "S"], line("x2", ["S", "F2"], "line", "construction helper")]),
      /^ray x2 runs back across the lens toward the object where its light does not go$/],
  ] as const) {
    expectUnproven("G29", name, question, document, reason);
    expectNeverPlanner("G29", name, question, turnPlan, document);
  }
  // The compiler draws the review's line with an arrowhead.
  const review = lensWith([line("x1", ["ob", "it"], "vector", "light path")]);
  const { result } = compiled(review);
  const ink = result.ok && result.renderScene
    ? buildVerifiedDiagramPresentation(review, result.renderScene).diagram.commands.filter((command) => command.semanticRef?.entityId === "x1" && command.type !== "LABEL")
    : [];
  check("G29", ink.some((command) => command.type === "ARROW"), `the review's line must draw with an arrowhead; got ${ink.map((command) => command.type).join(", ") || "no ink"}`);
  // Controls: the axis, a line along it, the element plane, a screen across the axis, and an axial ray
  // drawn as a marked line all prove and draw.
  const directionAxis = (document: Doc): Doc => {
    const copy = structuredClone(document);
    copy.constructions = copy.constructions.filter((construction) => !["c_axis_l", "c_axis_r"].includes(construction.id)).map((construction) =>
      construction.id === "c_axis" ? { ...construction, inputs: { start: "O", direction: [1, 0] } } : construction);
    copy.entities = copy.entities.filter((entity) => !["axis_l", "axis_r"].includes(entity.id));
    return copy;
  };
  const screen = (document: Doc): Doc => {
    const copy = structuredClone(document);
    copy.constructions.push({ id: "c_screen", operator: "line", inputs: { start: "ib", direction: [0, 1] }, outputs: ["screen"] } as Construction);
    copy.entities.push(ent("screen", "line", "screen", "screen") as Doc["entities"][number]);
    copy.requiredEntityIds.push("screen");
    return copy;
  };
  const tracedLens = tallLens(["parallel", "focal", "central"]);
  check("G29", tracedLens.constructions.some((construction) => construction.operator === "line" && construction.outputs[0] === "axis"),
    "the traced lens must draw its principal axis as a line");
  for (const [name, question, turnPlan, document] of [
    ["the traced lens alone (its axis a line between two points)", qTall, tallPlan, tracedLens],
    ["the traced lens with its axis drawn from the centre along a direction", qTall, tallPlan, directionAxis(tracedLens)],
    ["the traced concave mirror alone", qMirror, mirrorPlan, traced(goodMirror, ["parallel", "central"])],
    ["an unmarked line along the axis from F1 to F2", qTall, tallPlan, lensWith([line("x1", ["F1", "F2"], "line", "optical bench")])],
    // On the convex lenses of f 10 cm a line through O leaves its label no room; the magnifier and the diverging lens draw.
    ["the magnifier's lens plane drawn as a line from the centre to S", qLens, lensPlan,
      handPaths(traced(goodLens, ["parallel", "focal"]), "O", "F2", [line("x1", ["O", "S"], "line", "lens plane")])],
    ["the diverging lens's plane drawn as a line from the centre to S", qDiverging, signedPlan,
      handPaths(traced(cmLens(-25), ["parallel", "focal", "central"]), "O", "F2", [line("x1", ["O", "S"], "line", "lens plane")])],
    ["the mirror plane drawn as a line from the pole to S", qMirror, mirrorPlan, mirrorWith([line("x1", ["P", "S"], "line", "mirror plane")])],
    ["a screen drawn as a line from the image foot across the axis", qTall, tallPlan, screen(tracedLens)],
    ["the axial ray drawn as a line with an arrowhead, named light path", qTall, tallPlan, lensWith([line("x1", ["F1", "F2"], "vector", "light path")])],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, document);
    check("G29", proof.proof === "proven", `${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G29", name, question, turnPlan, document);
  }
}

// ---- G30: a nature choice states no nature, but its sentence's image distance and side still hold ----
{
  // f is the planner's derivation; the stem gives u and where the image forms.
  const choicePlan = (question: string, u: number, f: number, law: string) => plan(question, [
    { id: "u", symbol: "u", value: u, unit: "cm", provenance: "given", sourceText: `${u} cm` },
  ], [{ id: "f", symbol: "f", value: f, unit: "cm", provenance: "derived" }], [law]);
  const concaveAt = (question: string, u: number, f: number) =>
    mirrorDoc(question, { u, f, h: 2, kind: "concave", quantities: [{ id: "u", symbol: "u", value: u }, { id: "f", symbol: "f", value: f }] });
  // The review's stem: f 10 cm puts the image 20 cm on the far side, not the 60 cm it states.
  const qReview = "An object placed 20 cm from a convex lens forms an image 60 cm on the other side of it; determine its nature (real or virtual).";
  const qUpright = "An object placed 20 cm from a convex lens forms an image 60 cm on the other side of it; state its nature (upright or inverted).";
  const qEnlarged = "An object placed 20 cm from a convex lens forms an image 60 cm on the other side of it; describe it as enlarged or diminished.";
  const qSameSide = "An object placed 15 cm from a convex lens forms an image 60 cm on the same side as the object; determine its nature (real or virtual).";
  const qMirrorChoice = "An object placed 15 cm in front of a concave mirror forms an image 30 cm in front of it; determine its nature (real or virtual).";
  for (const [name, question, turnPlan, document, reason] of [
    ["a convex lens of f 10 cm on the review's stem (image 20 cm on the far side)", qReview, choicePlan(qReview, 20, 10, "lens_formula"),
      lensDoc(qReview, { u: 20, f: 10, h: 2 }), /^the image at 20 cm on the far side of the lens contradicts the stem's image 60 cm on the other side of it$/],
    ["a convex lens of f 10 cm on the upright or inverted stem", qUpright, choicePlan(qUpright, 20, 10, "lens_formula"),
      lensDoc(qUpright, { u: 20, f: 10, h: 2 }), /^the image at 20 cm on the far side of the lens contradicts the stem's image 60 cm on the other side of it$/],
    ["a convex lens of f 10 cm on the enlarged or diminished stem", qEnlarged, choicePlan(qEnlarged, 20, 10, "lens_formula"),
      lensDoc(qEnlarged, { u: 20, f: 10, h: 2 }), /^the image at 20 cm on the far side of the lens contradicts the stem's image 60 cm on the other side of it$/],
    ["a convex lens of f 10 cm on the same side stem (real image 30 cm on the far side)", qSameSide, choicePlan(qSameSide, 15, 10, "lens_formula"),
      lensDoc(qSameSide, { u: 15, f: 10, h: 2 }), /^the image at 30 cm on the far side of the lens contradicts the stem's image 60 cm on the same side as the object$/],
    ["a concave mirror of f 5 cm on the mirror stem (image 7.5 cm in front)", qMirrorChoice, choicePlan(qMirrorChoice, 15, 5, "mirror_formula"),
      concaveAt(qMirrorChoice, 15, 5), /^the image at 7.5 cm in front of the mirror contradicts the stem's image 30 cm in front of it$/],
  ] as const) {
    expectUnproven("G30", name, question, document, reason);
    expectNeverPlanner("G30", name, question, turnPlan, document);
  }
  // Controls: the figure with the stated image proves and draws.
  for (const [name, question, turnPlan, document] of [
    ["a convex lens of f 15 cm on the review's stem (image 60 cm on the other side)", qReview, choicePlan(qReview, 20, 15, "lens_formula"),
      lensDoc(qReview, { u: 20, f: 15, h: 2 })],
    ["a convex lens of f 15 cm on the upright or inverted stem", qUpright, choicePlan(qUpright, 20, 15, "lens_formula"), lensDoc(qUpright, { u: 20, f: 15, h: 2 })],
    ["a convex lens of f 15 cm on the enlarged or diminished stem", qEnlarged, choicePlan(qEnlarged, 20, 15, "lens_formula"), lensDoc(qEnlarged, { u: 20, f: 15, h: 2 })],
    ["a convex lens of f 20 cm on the same side stem (virtual image 60 cm on the object's side)", qSameSide, choicePlan(qSameSide, 15, 20, "lens_formula"),
      lensDoc(qSameSide, { u: 15, f: 20, h: 2 })],
    ["a concave mirror of f 10 cm on the mirror stem (real image 30 cm in front)", qMirrorChoice, choicePlan(qMirrorChoice, 15, 10, "mirror_formula"),
      concaveAt(qMirrorChoice, 15, 10)],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, document);
    check("G30", proof.proof === "proven", `${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G30", name, question, turnPlan, document);
  }
  // The choice itself states no nature: with no image distance or side, a real and a virtual image both
  // prove, and a stem that names no kind still declines.
  for (const choice of ["determine the nature of the image (real or virtual)", "say whether it is upright or inverted",
    "describe the image as upright or inverted", "describe the image as enlarged or diminished"]) {
    for (const [u, nature] of [[15, "virtual"], [30, "real"]] as const) {
      const question = `A convex lens of focal length 20 cm has an object placed ${u} cm from it; ${choice}.`;
      const proof = explainPlannerOpticsProof(question, lensDoc(question, { u, f: 20, h: 2 }));
      check("G30", proof.proof === "proven", `the ${nature} image on "${question}" must be proven; got ${proof.proof}: ${proof.reason}`);
    }
    const unnamed = `A lens has an object placed 30 cm from it; ${choice}.`;
    expectUnproven("G30", `a convex lens on "${unnamed}"`, unnamed, lensDoc(unnamed, { u: 30, f: 20, h: 2 }), /^the stem names no lens kind/);
  }
}

// ---- G31: every mark the compiler inks is read, whatever operator draws it ----
{
  // Beside the traced rays that prove the image (the convex lens of G19, real image 15 cm on, and the
  // concave mirror of G1), one more mark, drawn in the rays group. S is where a ray parallel to the axis
  // from the object tip meets the element plane.
  interface Mark { c: Construction; kind: string; role: string; helper?: boolean }
  const withMarks = (base: Doc, plane: string, marks: Mark[]): Doc => {
    const document = structuredClone(base);
    const reads = (id: string) => marks.some((mark) => JSON.stringify(mark.c.inputs).includes(`"${id}"`));
    const helpers: Mark[] = [
      { c: { id: "c_lp2", operator: "perpendicular_through", inputs: { through: plane, line: "axis" }, outputs: ["lp2"] } as Construction, kind: "line", role: "construction helper", helper: true },
      ...(reads("S") ? [{ c: { id: "c_S", operator: "project", inputs: { point: "ot", line: "lp2" }, outputs: ["S"] } as Construction, kind: "point", role: "construction helper", helper: true }] : []),
    ];
    for (const { c, kind, role, helper } of [...(reads("S") || reads("lp2") ? helpers : []), ...marks]) {
      document.constructions.push(c);
      document.entities.push(ent(c.outputs[0]!, kind, role) as Doc["entities"][number]);
      if (helper) continue;
      document.requiredEntityIds.push(c.outputs[0]!);
      document.revealGroups = document.revealGroups.map((group) =>
        group.id === "rays" ? { ...group, entityIds: [...group.entityIds, c.outputs[0]!] } : group);
    }
    return document;
  };
  const mark = (operator: string, inputs: Record<string, unknown>, kind: string, role: string): Mark =>
    ({ c: { id: "c_x", operator, inputs, outputs: ["x"] } as Construction, kind, role });
  const lens = tallLens(["parallel", "focal", "central"]);
  const mirror = traced(goodMirror, ["parallel", "central"]);
  const onLens = (marks: Mark[]) => withMarks(lens, "O", marks);
  const onMirror = (marks: Mark[]) => withMarks(mirror, "P", marks);
  // A thin band at the object tip's height, centred where it meets the element: the parallel ray drawn
  // straight on through it, as a rectangle.
  const band = (base: Doc, plane: string): Doc =>
    withMarks(base, plane, [mark("rectangle", { center: "S", width: 50, height: 4 }, "rectangle", "incident ray parallel to the axis")]);
  const offLine = /^ray x neither runs from the object tip to the (?:lens|mirror) nor leaves it$/;
  for (const [name, question, turnPlan, document, reason] of [
    // The review's polygons: each edge is read, the closing one included.
    ["a polygon [ot, S, F1] named a light ray on the lens", qTall, tallPlan,
      onLens([mark("polygon", { points: ["ot", "S", "F1"] }, "polygon", "light ray")]),
      /^ray x leaves the lens at S off the line to the image tip/],
    ["a polygon [ot, F2, ob] named a ray on the lens", qTall, tallPlan,
      onLens([mark("polygon", { points: ["ot", "F2", "ob"] }, "polygon", "ray")]), offLine],
    ["a polygon [ot, S, F] named a reflected ray on the mirror", qMirror, mirrorPlan,
      onMirror([mark("polygon", { points: ["ot", "S", "F"] }, "polygon", "reflected ray")]), offLine],
    // The review's parallel_through: the parallel ray drawn straight on through the element.
    ["parallel_through(ot, axis) named the incident ray parallel to the axis on the lens", qTall, tallPlan,
      onLens([mark("parallel_through", { through: "ot", line: "axis" }, "line", "incident ray parallel to the axis")]), offLine],
    ["parallel_through(ot, axis) named a guide on the lens", qTall, tallPlan,
      onLens([mark("parallel_through", { through: "ot", line: "axis" }, "line", "guide")]), offLine],
    ["parallel_through(ot, axis) named an incident ray on the mirror", qMirror, mirrorPlan,
      onMirror([mark("parallel_through", { through: "ot", line: "axis" }, "line", "incident ray")]), offLine],
    ["parallel_through(ot, axis) named a guide on the mirror", qMirror, mirrorPlan,
      onMirror([mark("parallel_through", { through: "ot", line: "axis" }, "line", "guide")]), offLine],
    // perpendicular_through: square to a traced ray (the review's), and square to the object arrow, which
    // is the same parallel ray straight through.
    ["perpendicular_through(ot, tr3) named a ray on the lens", qTall, tallPlan,
      onLens([mark("perpendicular_through", { through: "ot", line: "tr3" }, "line", "ray")]), /^ray x has an endpoint the engine did not derive$/],
    ["perpendicular_through(ot, object) named a guide on the lens", qTall, tallPlan,
      onLens([mark("perpendicular_through", { through: "ot", line: "object" }, "line", "guide")]), offLine],
    ["perpendicular_through(ot, object) named a guide on the mirror", qMirror, mirrorPlan,
      onMirror([mark("perpendicular_through", { through: "ot", line: "object" }, "line", "guide")]), offLine],
    // Ink no rule reads: a routed connector and a rectangle.
    ["connect ot to F2 named a light ray on the lens", qTall, tallPlan,
      onLens([mark("connect", { start: "ot", end: "F2" }, "polyline", "light ray")]),
      /^connect x inks a polyline the proof does not read as the element, an arrow, a traced ray or a light path$/],
    ["connect ot to F named a light ray on the mirror", qMirror, mirrorPlan,
      onMirror([mark("connect", { start: "ot", end: "F" }, "polyline", "light ray")]),
      /^connect x inks a (?:polyline|line) the proof does not read/],
    ["a rectangle band at the object tip's height across the lens", qTall, tallPlan, band(lens, "O"),
      /^rectangle x inks a rectangle the proof does not read/],
    ["a rectangle band at the object tip's height across the mirror", qMirror, mirrorPlan, band(mirror, "P"),
      /^rectangle x inks a rectangle the proof does not read/],
  ] as const) {
    expectUnproven("G31", name, question, document, reason);
    expectNeverPlanner("G31", name, question, turnPlan, document);
  }
  // The review's parallel line is drawn across the whole figure, through the lens.
  const through = onLens([mark("parallel_through", { through: "ot", line: "axis" }, "line", "guide")]);
  const { result } = compiled(through);
  const ink = result.ok && result.renderScene ? result.renderScene.primitives.filter((primitive) => primitive.entityId === "x") : [];
  check("G31", ink.length === 1 && ink[0]!.kind === "line", `the review's parallel_through must ink one line; got ${ink.map((primitive) => primitive.kind).join(", ") || "no ink"}`);
  // Controls: traced rays alone, the element plane and a screen across the axis still prove and draw.
  for (const [name, question, turnPlan, document] of [
    ["the traced lens alone", qTall, tallPlan, lens],
    ["the traced concave mirror alone", qMirror, mirrorPlan, mirror],
    ["the mirror plane drawn as perpendicular_through(P, axis)", qMirror, mirrorPlan,
      onMirror([mark("perpendicular_through", { through: "P", line: "axis" }, "line", "mirror plane")])],
    ["a screen at the image drawn as perpendicular_through(ib, axis) on the lens", qTall, tallPlan,
      onLens([mark("perpendicular_through", { through: "ib", line: "axis" }, "line", "screen")])],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, document);
    check("G31", proof.proof === "proven", `${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G31", name, question, turnPlan, document);
  }
}

// ---- G32: signed inline u and f are the plan's, by magnitude, when the stem fixes the image another way ----
{
  type Row = TurnPlanV3["givens"][number];
  const given = (id: string, value: number, unit = "cm", symbol = id): Row => ({ id, symbol, value, unit, provenance: "given", sourceText: `${symbol} ${value}` });
  const derived = (id: string, value: number, unit = "cm", symbol = id): Row => ({ id, symbol, value, unit, provenance: "derived" });
  /**
   * The gate's builders traced by the engine (parallel and central rays), with signed literals inline and
   * no `form`; only the stem's own u is declared as a quantity, or nothing at all.
   */
  const signed = (element: "lens" | "mirror", question: string, kind: "concave" | "convex", u: number, f: number, declared: boolean): Doc => {
    const quantities = declared ? [{ id: "u", symbol: "u", value: u }] : [];
    if (element === "mirror") return traced(mirrorDoc(question, { u, f, h: 2, kind, quantities }), ["parallel", "central"]);
    const document = traced(lensDoc(question, { u, f: kind === "convex" ? f : -f, h: 2 }), ["parallel", "central"]);
    document.quantities = quantities.map((quantity) => ({ ...quantity, unit: "cm" })) as Doc["quantities"];
    return document;
  };
  const rows: Array<{ name: string; element: "lens" | "mirror"; kind: "concave" | "convex"; question: string; givens: Row[]; derived: Row[]; law: string; wrong: [number, number]; right: [number, number] }> = [
    { name: "S1", element: "mirror", kind: "concave", question: "An object is placed 20 cm in front of a concave mirror. A real image is formed 30 cm from the mirror. Draw the ray diagram.",
      givens: [given("u", 20), given("v", 30)], derived: [derived("f", 12)], law: "mirror_formula", wrong: [20, 5], right: [20, 12] },
    { name: "S2", element: "lens", kind: "convex", question: "An object placed 15 cm from a convex lens forms a real image at 30 cm from the lens. Draw the ray diagram.",
      givens: [given("u", 15), given("v", 30)], derived: [derived("f", 10)], law: "lens_formula", wrong: [15, 5], right: [15, 10] },
    { name: "S2b", element: "lens", kind: "convex", question: "An object is placed 15 cm from a convex lens. The image distance is 30 cm. Draw the ray diagram.",
      givens: [given("u", 15), given("v", 30)], derived: [derived("f", 10)], law: "lens_formula", wrong: [15, 5], right: [15, 10] },
    { name: "S3", element: "lens", kind: "convex", question: "A convex lens of focal length 10 cm forms a real image three times the size of the object. Draw the ray diagram.",
      givens: [given("f", 10), given("m", 3, "", "|m|")], derived: [derived("u", 40 / 3), derived("v", 40)], law: "lens_formula", wrong: [30, 10], right: [40 / 3, 10] },
    { name: "S3b", element: "lens", kind: "convex", question: "A convex lens of focal length 10 cm produces a magnification of -3. Draw the ray diagram.",
      givens: [given("f", 10), given("m", -3, "", "m")], derived: [derived("u", 40 / 3), derived("v", 40)], law: "lens_formula", wrong: [30, 10], right: [40 / 3, 10] },
    { name: "S4", element: "mirror", kind: "concave", question: "An object 2 cm tall forms a real image 6 cm tall in a concave mirror of focal length 10 cm. Draw the ray diagram.",
      givens: [given("h", 2, "cm", "h_o"), given("hi", 6, "cm", "|h_i|"), given("f", 10)], derived: [derived("u", 40 / 3), derived("v", 40)], law: "mirror_formula", wrong: [30, 10], right: [40 / 3, 10] },
    { name: "S5", element: "lens", kind: "convex", question: "An object 10 cm from a convex lens forms a sharp image on a screen 40 cm from the lens. Draw the ray diagram.",
      givens: [given("u", 10), given("v", 40)], derived: [derived("f", 8)], law: "lens_formula", wrong: [10, 20], right: [10, 8] },
    { name: "S8", element: "mirror", kind: "concave", question: "An object is placed at the centre of curvature of a concave mirror of focal length 10 cm. Draw the ray diagram.",
      givens: [given("f", 10)], derived: [derived("u", 20), derived("v", 20)], law: "mirror_formula", wrong: [30, 10], right: [20, 10] },
    { name: "S10", element: "mirror", kind: "concave", question: "A concave mirror of focal length 15 cm forms a real image of the same size as the object. Draw the ray diagram.",
      givens: [given("f", 15)], derived: [derived("u", 30), derived("v", 30)], law: "mirror_formula", wrong: [20, 15], right: [30, 15] },
  ];
  for (const row of rows) {
    const turnPlan = plan(row.question, row.givens, row.derived, [row.law]);
    // The stem's own u, when it states one, is declared as a quantity; or nothing is.
    const statesU = row.givens.some((quantity) => quantity.id === "u");
    for (const declared of statesU ? [true, false] : [false]) {
      const where = declared ? "with the stem's u declared" : "with no quantities";
      const [u, f] = row.wrong;
      const name = `${row.name} signed u ${+u.toFixed(2)} f ${f} ${where}`;
      const wrong = signed(row.element, row.question, row.kind, u, f, declared);
      check("G32", !wrong.constructions.some((construction) => construction.inputs.form !== undefined) &&
        wrong.constructions.find((construction) => construction.operator === "gaussian_image")!.inputs.objectDistance === -u,
        `${name} must carry signed literals inline and no form`);
      // Nothing the proof reads from the stem refuses it; the plan does.
      const { candidateValidation, strict, current } = production(row.question, turnPlan, wrong);
      const codes = candidateValidation.valid ? [] : candidateValidation.errors.filter((issue) => issue.severity === "fatal")
        .map((issue) => `${issue.code}@${issue.path}`);
      check("G32", explainPlannerOpticsProof(row.question, wrong).proof === "unproven" ||
        codes.some((code) => /^scene_quantity_unverified@constructions\[\d+\]\.inputs\.(?:objectDistance|focalLength)$/.test(code)),
        `${name} must be unproven or fail the plan on an inline objectDistance or focalLength; got ${codes.join(", ") || "valid"}`);
      for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
        check("G32", selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
          `${name} must never be drawn as a planner figure in the ${arm} arm; got ${selection.representation?.figureSource}`);
      }
    }
    // The figure the stem needs, signed and inline, still draws.
    const [u, f] = row.right;
    expectDrawnAsPlanner("G32", `${row.name} signed u ${+u.toFixed(2)} f ${f}`, row.question, turnPlan,
      signed(row.element, row.question, row.kind, u, f, statesU));
  }
  // An input whose role the plan does not name fails: no other plan length stands in, and a figure's own
  // u cannot be held to "beyond 2F". Greptile's stem gives only f, so u 30 fails as u 20 would.
  const magnitudeMode = (document: Doc): Doc => {
    const copy = structuredClone(document);
    for (const construction of copy.constructions) {
      const focal = Math.abs(Number(construction.inputs.focalLength));
      if (construction.operator === "gaussian_image") {
        Object.assign(construction.inputs, { objectDistance: Math.abs(Number(construction.inputs.objectDistance)), focalLength: focal, form: "converging", objectSide: "real" });
      }
      if (construction.operator === "optical_focus") Object.assign(construction.inputs, { focalLength: focal, form: "converging" });
    }
    return copy;
  };
  const convexLens = (question: string, u: number, f: number, declareF: boolean): Doc => {
    const document = signed("lens", question, "convex", u, f, false);
    if (declareF) document.quantities = [{ id: "f", symbol: "f", value: 10, unit: "cm" }] as Doc["quantities"];
    return document;
  };
  const expectInlineRefused = (name: string, question: string, turnPlan: TurnPlanV3, document: Doc, input: string): void => {
    const { candidateValidation, strict, current } = production(question, turnPlan, document);
    const codes = candidateValidation.valid ? [] : candidateValidation.errors.filter((issue) => issue.severity === "fatal")
      .map((issue) => `${issue.code}@${issue.path}`);
    check("G32", codes.some((code) => new RegExp(`^scene_quantity_unverified@constructions\\[\\d+\\]\\.inputs\\.${input}$`).test(code)),
      `${name} must fail the plan on its inline ${input}; got ${codes.join(", ") || "valid"}`);
    for (const [arm, selection] of [["strict", strict], ["current", current]] as const) {
      check("G32", selection.representation?.figureSource !== "planner" && selection.attemptedRepresentation?.figureSource !== "planner",
        `${name} must never be drawn as a planner figure in the ${arm} arm; got ${selection.representation?.figureSource}`);
    }
  };
  const qBeyond = "Draw a convex lens of focal length 10 cm with an object beyond 2F.";
  const fOnlyPlan = plan(qBeyond, [given("f", 10)], [], ["lens_formula"]);
  // The plan writes the object distance under a symbol no role reads (x), so it names no object distance.
  const qX = "An object is placed at a distance x = 30 cm from a convex lens of focal length 10 cm. Draw the ray diagram.";
  const xPlan = plan(qX, [given("f", 10), given("x", 30)], [derived("v", 15)], ["lens_formula"]);
  for (const [mode, written] of [["signed", (document: Doc) => document], ["magnitude", magnitudeMode]] as const) {
    for (const declareF of [false, true]) {
      const where = declareF ? "with f declared" : "with no quantities";
      expectInlineRefused(`Greptile's ${mode} u 30 f 10 under a plan of f = 10 cm only, ${where}`, qBeyond, fOnlyPlan,
        written(convexLens(qBeyond, 30, 10, declareF)), "objectDistance");
    }
    expectInlineRefused(`${mode} u 30 f 12 under a plan of f = 10 cm only`, qBeyond, fOnlyPlan, written(convexLens(qBeyond, 30, 12, false)), "focalLength");
    expectInlineRefused(`${mode} u 20 f 10 under a plan of x = 30 cm`, qX, xPlan, written(convexLens(qX, 20, 10, false)), "objectDistance");
    expectInlineRefused(`${mode} u 30 f 10 under a plan of x = 30 cm`, qX, xPlan, written(convexLens(qX, 30, 10, false)), "objectDistance");
  }
}

// ---- G33: annotation ink and label leaders are read, not skipped ----
{
  // Beside the traced rays that prove the image (the convex lens of G19, the concave mirror of G1 and
  // the magnifier of G2), marks drawn in the rays group, and annotations. S is where a ray parallel to
  // the axis from the object tip meets the element plane.
  interface Item { c: Construction; kind: string; role: string; provenance?: Record<string, unknown>; helper?: boolean }
  const annotated = (base: Doc, items: Item[], annotations: Array<Record<string, unknown>> = []): Doc => {
    const document = structuredClone(base);
    for (const { c, kind, role, provenance, helper } of items) {
      document.constructions.push(c);
      document.entities.push({ ...ent(c.outputs[0]!, kind, role), ...(provenance ? { provenance } : {}) } as Doc["entities"][number]);
      if (helper) continue;
      document.requiredEntityIds.push(c.outputs[0]!);
      document.revealGroups = document.revealGroups.map((group) =>
        group.id === "rays" ? { ...group, entityIds: [...group.entityIds, c.outputs[0]!] } : group);
    }
    document.annotations = [...document.annotations, ...annotations] as Doc["annotations"];
    return document;
  };
  const item = (id: string, operator: string, inputs: Record<string, unknown>, kind: string, role: string, provenance?: Record<string, unknown>): Item =>
    ({ c: { id: `c_${id}`, operator, inputs, outputs: [id] } as Construction, kind, role, ...(provenance ? { provenance } : {}) });
  const towardPlane = (plane: string): Item[] => [
    { ...item("lp2", "perpendicular_through", { through: plane, line: "axis" }, "line", "construction helper"), helper: true },
    { ...item("S", "project", { point: "ot", line: "lp2" }, "point", "construction helper"), helper: true },
    item("inc", "segment", { start: "ot", end: "S" }, "segment", "incident ray parallel to the axis"),
  ];
  const lens = tallLens(["parallel", "focal", "central"]);
  const mirror = traced(goodMirror, ["parallel", "central"]);
  const magnifier = traced(goodLens, ["parallel", "central"]);
  const leaderFlag = { labelLeader: true };
  const annotationInk = (kind: string) => new RegExp(`^annotation ann1 \\(${kind}\\) inks an? \\w+ of its own`);
  const unread = (operator: string) => new RegExp(`^${operator} x inks an? \\w+ the proof does not read`);
  for (const [name, question, turnPlan, document, reason] of [
    // D1, D2, D4: extend draws a dashed line on past its target, through the lens or behind the mirror.
    ["D1: extend on a hand incident ray on the lens", qTall, tallPlan,
      annotated(lens, towardPlane("O"), [{ id: "ann1", kind: "extend", targetIds: ["inc"] }]), annotationInk("extend")],
    ["D2: extend on the traced parallel ray on the lens", qTall, tallPlan,
      annotated(lens, [], [{ id: "ann1", kind: "extend", targetIds: ["tr1"] }]), annotationInk("extend")],
    ["D4: extend on a hand incident ray on the mirror", qMirror, mirrorPlan,
      annotated(mirror, towardPlane("P"), [{ id: "ann1", kind: "extend", targetIds: ["inc"] }]), annotationInk("extend")],
    // D6 and D8: the planner's recorded use on the magnifier (6c1676e09ec2, 1a9a42fb587c).
    ["D6: extend on both traced rays of the magnifier", qLens, lensPlan,
      annotated(magnifier, [], [{ id: "ann1", kind: "extend", targetIds: ["tr1", "tr2"] }]), annotationInk("extend")],
    ["D8: ghost on both traced rays of the magnifier", qLens, lensPlan,
      annotated(magnifier, [], [{ id: "ann1", kind: "ghost", targetIds: ["tr1", "tr2"] }]), annotationInk("ghost")],
    // A4, A5, A7: ink whose entity writes the labelLeader flag a leader carries; A6 is still read by P11.
    ["A4: a connect ot to F2 flagged labelLeader on the lens", qTall, tallPlan,
      annotated(lens, [item("x", "connect", { start: "ot", end: "F2" }, "polyline", "light ray", leaderFlag)]), unread("connect")],
    ["A5: a connect ot to F flagged labelLeader on the mirror", qMirror, mirrorPlan,
      annotated(mirror, [item("x", "connect", { start: "ot", end: "F" }, "polyline", "ray", leaderFlag)]), unread("connect")],
    ["A6: a segment ot to F2 flagged labelLeader on the lens", qTall, tallPlan,
      annotated(lens, [item("x", "segment", { start: "ot", end: "F2" }, "segment", "light ray", leaderFlag)]), /^ray x /],
    ["A7: a circle at F2 flagged labelLeader on the lens", qTall, tallPlan,
      annotated(lens, [item("x", "circle", { center: "F2", radius: 3 }, "circle", "focal spot", leaderFlag)]), unread("circle")],
    // A connect named so its ink takes the id a leader of the label on it would have.
    ["a connect ot to F2 whose ink takes a label leader's id", qTall, tallPlan,
      annotated(lens, [item("Q_leader", "connect", { start: "ot", end: "F2" }, "polyline", "light ray",
        { labelLeader: true, annotation: "callout", dashed: true, strokeRole: "construction" })],
      [{ id: "primitive_Q", kind: "label", targetIds: ["Q_leader"], text: "light ray" }]), /^connect Q_leader inks a polyline the proof does not read/],
    // Every other annotation kind that draws on a traced ray adds its own geometry. A spin needs a sense in its text (#196).
    ...["ghost", "frame", "sense", "spin", "hatch", "loop", "brace", "badge", "endpoint", "equal_tick", "parallel_mark"].map((kind) =>
      [`${kind} on the traced parallel ray on the lens`, qTall, tallPlan,
        annotated(lens, [], [{ id: "ann1", kind, targetIds: ["tr1"], ...(kind === "spin" ? { text: "clockwise" } : {}) }]), annotationInk(kind)] as const),
  ] as const) {
    expectUnproven("G33", name, question, document, reason);
    expectNeverPlanner("G33", name, question, turnPlan, document);
  }
  // The review's extend inks a line of its own beyond the incident ray.
  const extended = annotated(lens, towardPlane("O"), [{ id: "ann1", kind: "extend", targetIds: ["inc"] }]);
  const { result } = compiled(extended);
  const ink = result.ok && result.renderScene ? result.renderScene.primitives.filter((primitive) => primitive.entityId === "ann1") : [];
  check("G33", ink.length === 1 && ink[0]!.kind === "line", `the review's extend must ink one line; got ${ink.map((primitive) => primitive.kind).join(", ") || "no ink"}`);
  // Controls: a hand incident ray, a trace (it retraces read ink), a polarity mark (text) and the
  // magnifier alone prove and draw; the traced mirror carries a real label leader, which is label ink.
  const mirrorLeaders = (() => {
    const { result: mirrorCompile } = compiled(mirror);
    return mirrorCompile.renderScene?.primitives.filter((primitive) => primitive.id.endsWith("_leader")) ?? [];
  })();
  check("G33", mirrorLeaders.length > 0 && mirrorLeaders.every((primitive) => primitive.provenance?.labelLeader === true),
    `the traced mirror must carry a compiler label leader; got ${mirrorLeaders.map((primitive) => primitive.id).join(", ") || "none"}`);
  for (const [name, question, turnPlan, document] of [
    ["D5: a hand incident ray on the lens", qTall, tallPlan, annotated(lens, towardPlane("O"))],
    ["a trace on the traced parallel ray on the lens", qTall, tallPlan, annotated(lens, [], [{ id: "ann1", kind: "trace", targetIds: ["tr1"] }])],
    ["a polarity mark on the traced parallel ray on the lens", qTall, tallPlan, annotated(lens, [], [{ id: "ann1", kind: "polarity", targetIds: ["tr1"] }])],
    ["D7: the traced magnifier", qLens, lensPlan, magnifier],
    ["the traced concave mirror with its label leader", qMirror, mirrorPlan, mirror],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, document);
    check("G33", proof.proof === "proven", `${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G33", name, question, turnPlan, document);
  }
}

// ---- G34: u and f are each a quantity the plan names in that role, and nothing else ----
type PlanQuantity = TurnPlanV3["givens"][number];
const givenRow = (id: string, value: number, unit = "cm", symbol = id): PlanQuantity => ({ id, symbol, value, unit, provenance: "given", sourceText: `${symbol} ${value}` });
const derivedRow = (id: string, value: number, unit = "cm", symbol = id): PlanQuantity => ({ id, symbol, value, unit, provenance: "derived" });
/** The gate's builders traced by the engine (parallel and central rays), signed literals inline, no `form`. */
const tracedFigure = (element: "lens" | "mirror", question: string, kind: "concave" | "convex", u: number, f: number,
  h = 2, quantities: Array<{ id: string; symbol: string; value: number }> = []): Doc => {
  if (element === "mirror") return traced(mirrorDoc(question, { u, f, h, kind, quantities }), ["parallel", "central"]);
  const document = traced(lensDoc(question, { u, f: kind === "convex" ? f : -f, h }), ["parallel", "central"]);
  document.quantities = quantities.map((quantity) => ({ ...quantity, unit: "cm" })) as Doc["quantities"];
  return document;
};
/** Unproven under the turn's plan, and never drawn in either arm. */
const expectRefusedByPlan = (gate: string, name: string, question: string, turnPlan: TurnPlanV3, document: Doc, reason: RegExp): void => {
  const proof = explainPlannerOpticsProof(question, document, turnPlan);
  check(gate, proof.proof === "unproven" && reason.test(proof.reason), `${name} must stay unproven by ${reason}; got ${proof.proof}: ${proof.reason}`);
  expectNeverPlanner(gate, name, question, turnPlan, document);
};
// The review's stems (E1 to E5) under the review's plans; E1's is the recorded plan of f777a2907df5.
const qE1 = "A thin converging lens at x=0 has focal length 12 cm. An upright object of height 3 cm stands at x=-18 cm on the principal axis, and light travels left to right. Draw a principal-ray diagram, label both focal points, and locate the image with its height and orientation.";
const e1Givens = [givenRow("f", 12), givenRow("ho", 3, "cm", "h_o"), givenRow("xo", -18, "cm", "x_o"), givenRow("xl", 0, "cm", "x_l")];
const e1Derived = [derivedRow("xi", 36, "cm", "x_i"), derivedRow("hi", -6, "cm", "h_i"), derivedRow("fl", -12, "cm", "x_{F_L}"), derivedRow("fr", 12, "cm", "x_{F_R}")];
const e1Plan = plan(qE1, e1Givens, e1Derived, ["thin-lens-equation", "transverse-magnification"]);
const qE2 = "An object 2 cm tall forms an image 6 cm tall in a concave mirror of focal length 10 cm. Draw the ray diagram.";
const e2Plan = plan(qE2, [givenRow("h", 2, "cm", "h_o"), givenRow("hi", 6, "cm", "h_i"), givenRow("f", 10)], [], ["mirror_formula"]);
const qE3 = "An object 10 cm from a convex lens forms a sharp image on a screen 40 cm from the lens. Draw the ray diagram.";
const e3Plan = plan(qE3, [givenRow("u", 10), givenRow("v", 40)], [], ["lens_formula"]);
const qE4 = "A convex lens of focal length 10 cm forms a real image three times the size of the object. Draw the ray diagram.";
const e4Plan = plan(qE4, [givenRow("f", 10), givenRow("m", 3, "", "m")], [], ["lens_formula", "magnification"]);
const qE5 = "An object is placed at the centre of curvature of a concave mirror of focal length 10 cm. Draw the ray diagram.";
const e5Plan = plan(qE5, [givenRow("f", 10)], [], ["mirror_formula"]);
const uDeclared = (u: number) => [{ id: "u", symbol: "u", value: u }];
{
  const noU = /^the plan names no object distance, so the figure's u = [\d.]+ cm is its own$/;
  const noF = /^the plan names no focal length, so the figure's f = [\d.]+ cm is its own$/;
  for (const [name, question, turnPlan, document, reason] of [
    ["E1a: u 36 (the plan's x_i) on the recorded stem and plan", qE1, e1Plan, tracedFigure("lens", qE1, "convex", 36, 12, 3), noU],
    ["E1b: u 6 (the plan's |h_i|) on the recorded stem and plan", qE1, e1Plan, tracedFigure("lens", qE1, "convex", 6, 12, 3), noU],
    ["E1c: u 18 on the recorded stem and plan, which writes the object only as a position", qE1, e1Plan, tracedFigure("lens", qE1, "convex", 18, 12, 3), noU],
    ["E2a: u 6 (the plan's h_i) on the image height stem", qE2, e2Plan, tracedFigure("mirror", qE2, "concave", 6, 10), noU],
    ["E2b: u 30 on the image height stem", qE2, e2Plan, tracedFigure("mirror", qE2, "concave", 30, 10), noU],
    ["E2c: u 13.33 on the image height stem", qE2, e2Plan, tracedFigure("mirror", qE2, "concave", 40 / 3, 10), noU],
    ["E3a: f 40 (the plan's v) on the screen stem", qE3, e3Plan, tracedFigure("lens", qE3, "convex", 10, 40, 2, uDeclared(10)), noF],
    ["E3b: f 20 on the screen stem", qE3, e3Plan, tracedFigure("lens", qE3, "convex", 10, 20, 2, uDeclared(10)), noF],
    ["E3c: f 8 on the screen stem", qE3, e3Plan, tracedFigure("lens", qE3, "convex", 10, 8, 2, uDeclared(10)), noF],
    ["E4a: u 30 (representative) on the magnification stem", qE4, e4Plan, tracedFigure("lens", qE4, "convex", 30, 10), noU],
    ["E4b: u 13.33 on the magnification stem", qE4, e4Plan, tracedFigure("lens", qE4, "convex", 40 / 3, 10), noU],
    ["E5a: u 30 (representative) on the at C stem", qE5, e5Plan, tracedFigure("mirror", qE5, "concave", 30, 10), noU],
    ["E5b: u 20 on the at C stem", qE5, e5Plan, tracedFigure("mirror", qE5, "concave", 20, 10), noU],
  ] as const) {
    expectRefusedByPlan("G34", name, question, turnPlan, document, reason);
    // Production refuses it too: no plan length stands in for the role the plan does not name.
    const { candidateValidation } = production(question, turnPlan, document);
    const codes = candidateValidation.valid ? [] : candidateValidation.errors.map((issue) => `${issue.code}@${issue.path}`);
    check("G34", codes.some((code) => /^scene_quantity_unverified@constructions\[\d+\]\.inputs\.(?:objectDistance|focalLength)$/.test(code)),
      `${name} must fail production on its inline objectDistance or focalLength; got ${codes.join(", ") || "valid"}`);
  }
  // With no readable plan the proof has nothing to hold u and f to.
  for (const [name, turnPlan] of [["no plan", null], ["a plan with no givens array", { derived: [] }]] as const) {
    const proof = explainPlannerOpticsProof(qTall, tallLens(["parallel", "central"]), turnPlan);
    check("G34", proof.proof === "unproven" && proof.reason === "no turn plan states u and f", `the traced lens under ${name} must be unproven; got ${proof.proof}: ${proof.reason}`);
  }
  // A plan length in a unit the proof cannot place, and an id that names a role its symbol does not, name no role.
  const inches = plan(qTall, [givenRow("h", 2, "cm", "h_o"), givenRow("u", 30, "in"), givenRow("f", 10)], [], ["lens_formula"]);
  const inchesProof = explainPlannerOpticsProof(qTall, tallLens(["parallel", "central"]), inches);
  check("G34", inchesProof.proof === "unproven" && /^the plan names no object distance/.test(inchesProof.reason),
    `the traced lens under a plan with u in inches must be unproven; got ${inchesProof.proof}: ${inchesProof.reason}`);
  const byIdOnly = plan(qTall, [givenRow("h", 2, "cm", "h_o"), givenRow("u", 30, "cm", "x_o"), givenRow("f", 10)], [], ["lens_formula"]);
  const byIdProof = explainPlannerOpticsProof(qTall, tallLens(["parallel", "central"]), byIdOnly);
  check("G34", byIdProof.proof === "unproven" && /^the plan names no object distance/.test(byIdProof.reason),
    `a quantity with the id u and the symbol x_o is not an object distance; got ${byIdProof.proof}: ${byIdProof.reason}`);
  // Controls: the same stems under plans that name u and f draw the right figure and refuse the wrong one.
  const notU = /^u = [\d.]+ cm is not the plan's object distance \(u = [\d.]+ cm\)$/;
  const notF = /^f = [\d.]+ cm is not the plan's focal length \(f = [\d.]+ cm\)$/;
  const e1Named = plan(qE1, [...e1Givens, givenRow("u", 18)], e1Derived, ["thin-lens-equation"]);
  const e2Named = plan(qE2, [givenRow("h", 2, "cm", "h_o"), givenRow("f", 10)], [derivedRow("u", 40 / 3), derivedRow("v", 40), derivedRow("hi", -6, "cm", "h_i")], ["mirror_formula"]);
  const e3Named = plan(qE3, e3Plan.givens, [derivedRow("f", 8)], ["lens_formula"]);
  const e4Named = plan(qE4, [givenRow("f", 10), givenRow("m", -3, "", "m")], [derivedRow("u", 40 / 3), derivedRow("v", 40)], ["lens_formula"]);
  const e5Named = plan(qE5, e5Plan.givens, [derivedRow("u", 20), derivedRow("v", 20)], ["mirror_formula"]);
  for (const [name, question, turnPlan, right, wrongs] of [
    ["E1 with u 18 named", qE1, e1Named, tracedFigure("lens", qE1, "convex", 18, 12, 3),
      [tracedFigure("lens", qE1, "convex", 36, 12, 3), tracedFigure("lens", qE1, "convex", 6, 12, 3)]],
    ["E2 with u 40/3 named", qE2, e2Named, tracedFigure("mirror", qE2, "concave", 40 / 3, 10), [tracedFigure("mirror", qE2, "concave", 6, 10)]],
    ["E3 with f 8 named", qE3, e3Named, tracedFigure("lens", qE3, "convex", 10, 8, 2, uDeclared(10)),
      [tracedFigure("lens", qE3, "convex", 10, 40, 2, uDeclared(10))]],
    ["E4 with u 40/3 named", qE4, e4Named, tracedFigure("lens", qE4, "convex", 40 / 3, 10), [tracedFigure("lens", qE4, "convex", 30, 10)]],
    ["E5 with u 20 named", qE5, e5Named, tracedFigure("mirror", qE5, "concave", 20, 10), [tracedFigure("mirror", qE5, "concave", 30, 10)]],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, right, turnPlan);
    check("G34", proof.proof === "proven", `${name}: the right figure must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G34", `${name}: the right figure`, question, turnPlan, right);
    for (const wrong of wrongs) {
      const u = -Number(wrong.constructions.find((construction) => construction.operator === "gaussian_image")!.inputs.objectDistance);
      expectRefusedByPlan("G34", `${name}: u ${+u.toFixed(2)}`, question, turnPlan, wrong, name.startsWith("E3") ? notF : notU);
    }
  }
  // The plan's own rounding: a derived u of 13.3 cm holds the engine's 40/3, not 13.6.
  const rounded = plan(qE4, [givenRow("f", 10), givenRow("m", -3, "", "m")], [derivedRow("u", 13.3), derivedRow("v", 40)], ["lens_formula"]);
  const roundedProof = explainPlannerOpticsProof(qE4, tracedFigure("lens", qE4, "convex", 40 / 3, 10), rounded);
  check("G34", roundedProof.proof === "proven", `u 40/3 under a plan's u = 13.3 cm must be proven; got ${roundedProof.proof}: ${roundedProof.reason}`);
  const offProof = explainPlannerOpticsProof(qE4, tracedFigure("lens", qE4, "convex", 13.6, 10), rounded);
  check("G34", offProof.proof === "unproven" && notU.test(offProof.reason), `u 13.6 under a plan's u = 13.3 cm must be unproven; got ${offProof.proof}: ${offProof.reason}`);
}

// ---- G35: the engine image agrees with every image fact the plan states ----
{
  const notAt = /^the engine image \((?:real|virtual), \|v\| = [\d.]+ cm, m = -?[\d.]+\) is not at the plan's /;
  const notM = /^the engine image \((?:real|virtual), \|v\| = [\d.]+ cm, m = -?[\d.]+\) does not have the plan's magnification /;
  const notH = /^the engine image \((?:real|virtual), \|v\| = [\d.]+ cm, m = -?[\d.]+\) does not have the plan's image height /;
  const screen = /^the engine image \(virtual, \|v\| = [\d.]+ cm, m = -?[\d.]+\) is virtual, but the (?:stem|plan) names a screen$/;
  const tallFigure = tracedFigure("lens", qTall, "convex", 30, 10);
  const tallWith = (derived: PlanQuantity[], givens: PlanQuantity[] = []) =>
    plan(qTall, [givenRow("h", 2, "cm", "h_o"), givenRow("u", 30), givenRow("f", 10), ...givens], derived, ["lens_formula"]);
  // E1 with u named twice: the second lens's u_2 = 36 cm lets u 36 pass P13, and the image facts refuse it.
  const e1Twice = plan(qE1, [...e1Givens, givenRow("u", 18), givenRow("u2", 36, "cm", "u_2")], e1Derived, ["thin-lens-equation"]);
  // The screen stems: a convex lens inside f forms no image on a screen.
  const qScreenInside = "An object placed 10 cm from a convex lens of focal length 20 cm forms an image on a screen. Draw the ray diagram.";
  const screenInsidePlan = plan(qScreenInside, [givenRow("u", 10), givenRow("f", 20)], [derivedRow("v", -20)], ["lens_formula"]);
  const magnifierScreenPlan = plan(qLens, [...lensPlan.givens, givenRow("screen", 40, "cm", "d_s")], lensPlan.derived, ["lens_formula"]);
  for (const [name, question, turnPlan, document, reason] of [
    // |v| against an image distance, and against x_i less x_l.
    ["the real image 15 cm on under a plan's v = 20 cm", qTall, tallWith([derivedRow("v", 20)]), tallFigure, notAt],
    ["the real image under a plan's q = 20 cm (Gaussian notation)", qTall, tallWith([derivedRow("q", 20)]), tallFigure, notAt],
    ["the real image under a plan's d_i = 20 cm", qTall, tallWith([derivedRow("di", 20, "cm", "d_i")]), tallFigure, notAt],
    ["E1, u 36 passing P13 as the plan's u_2, against x_i 36 less x_l 0", qE1, e1Twice, tracedFigure("lens", qE1, "convex", 36, 12, 3), notAt],
    ["E1 with u 18 named, the plan's x_i = 30 cm", qE1, plan(qE1, [...e1Givens, givenRow("u", 18)], [derivedRow("xi", 30, "cm", "x_i")], []),
      tracedFigure("lens", qE1, "convex", 18, 12, 3), notAt],
    ["E1 with u 18 named, x_i = 36 cm but the lens at x_l = 6 cm", qE1,
      plan(qE1, [givenRow("f", 12), givenRow("u", 18), givenRow("xl", 6, "cm", "x_l")], [derivedRow("xi", 36, "cm", "x_i")], []),
      tracedFigure("lens", qE1, "convex", 18, 12, 3), notAt],
    ["E1 with u 18 named, x_i = 36 cm and no lens position", qE1,
      plan(qE1, [givenRow("f", 12), givenRow("u", 18)], [derivedRow("xi", 36, "cm", "x_i")], []),
      tracedFigure("lens", qE1, "convex", 18, 12, 3), /^the plan places the image at x_i = 36 cm but gives no single lens position$/],
    // m in sign and size, against m or h_i/h_o.
    ["the real image under a plan's m = -1 (size)", qTall, tallWith([derivedRow("m", -1, "", "m")]), tallFigure, notM],
    ["the real image under a plan's m = 0.5 (upright, sign)", qTall, tallWith([derivedRow("m", 0.5, "", "m")]), tallFigure, notM],
    ["E4 with u 40/3 named and the review's m = 3 for a real image (upright, sign)", qE4,
      plan(qE4, [givenRow("f", 10), givenRow("m", 3, "", "m")], [derivedRow("u", 40 / 3)], ["lens_formula"]), tracedFigure("lens", qE4, "convex", 40 / 3, 10), notM],
    ["the real image under a plan's h_i = -2 cm (size)", qTall, tallWith([derivedRow("hi", -2, "cm", "h_i")]), tallFigure, notH],
    ["the real image under a plan's h_i = 1 cm (upright, sign)", qTall, tallWith([derivedRow("hi", 1, "cm", "h_i")]), tallFigure, notH],
    ["E2 with u 40/3 named and the review's h_i = 6 cm for a real image (upright, sign)", qE2,
      plan(qE2, e2Plan.givens, [derivedRow("u", 40 / 3)], ["mirror_formula"]), tracedFigure("mirror", qE2, "concave", 40 / 3, 10), notH],
    ["the real image under a plan's h_i = -1 cm and no object height", qTall,
      plan(qTall, [givenRow("u", 30), givenRow("f", 10)], [derivedRow("hi", -1, "cm", "h_i")], ["lens_formula"]), tallFigure,
      /^the plan gives the image height h_i = -1 cm but no single object height$/],
    // A real image when the stem or the plan names a screen.
    ["a virtual image on a screen stem", qScreenInside, screenInsidePlan, tracedFigure("lens", qScreenInside, "convex", 10, 20), screen],
    ["the magnifier under a plan that names a screen", qLens, magnifierScreenPlan, traced(goodLens, ["parallel", "central"]), screen],
  ] as const) {
    expectRefusedByPlan("G35", name, question, turnPlan, document, reason);
  }
  // Controls: the same figures under plans whose image facts agree prove and draw; a value the plan writes
  // between bars is held by size only; and the plan's rounding holds (v = 13.3 cm for 40/3).
  for (const [name, question, turnPlan, document] of [
    ["the real image under v = 15, m = -0.5, h_i = -1 cm", qTall,
      tallWith([derivedRow("v", 15), derivedRow("m", -0.5, "", "m"), derivedRow("hi", -1, "cm", "h_i")]), tallFigure],
    ["the real image under |m| = 0.5 and |h_i| = 1 cm", qTall,
      tallWith([derivedRow("m", 0.5, "", "|m|"), derivedRow("hi", 1, "cm", "|h_i|")]), tallFigure],
    ["E1 with u 18 named under its recorded x_i, x_l and h_i", qE1, plan(qE1, [...e1Givens, givenRow("u", 18)], e1Derived, ["thin-lens-equation"]),
      tracedFigure("lens", qE1, "convex", 18, 12, 3)],
    ["E2 with u 40/3 named and |h_i| = 6 cm", qE2,
      plan(qE2, [givenRow("h", 2, "cm", "h_o"), givenRow("hi", 6, "cm", "|h_i|"), givenRow("f", 10)], [derivedRow("u", 40 / 3)], ["mirror_formula"]),
      tracedFigure("mirror", qE2, "concave", 40 / 3, 10)],
    ["E3 with f 8 named on the screen stem", qE3, plan(qE3, e3Plan.givens, [derivedRow("f", 8)], ["lens_formula"]),
      tracedFigure("lens", qE3, "convex", 10, 8, 2, uDeclared(10))],
    ["the magnifier under its plan", qLens, lensPlan, traced(goodLens, ["parallel", "central"])],
  ] as const) {
    const proof = explainPlannerOpticsProof(question, document, turnPlan);
    check("G35", proof.proof === "proven", `${name} must be proven; got ${proof.proof}: ${proof.reason}`);
    expectDrawnAsPlanner("G35", name, question, turnPlan, document);
  }
  // The plan's rounding: u 25 with f 10 puts the image 16.67 cm on (m = -2/3), which a plan's v = 16.7 cm,
  // m = -0.67 and h_i = -1.33 cm hold; an integer v = 17 cm (held to 1 percent) does not.
  const q25 = "An object 2 cm tall is placed at 25 cm from a convex lens of focal length 10 cm. Draw the ray diagram.";
  const plan25 = (derived: PlanQuantity[]) => plan(q25, [givenRow("h", 2, "cm", "h_o"), givenRow("u", 25), givenRow("f", 10)], derived, ["lens_formula"]);
  const lens25 = tracedFigure("lens", q25, "convex", 25, 10);
  const rounded = plan25([derivedRow("v", 16.7), derivedRow("m", -0.67, "", "m"), derivedRow("hi", -1.33, "cm", "h_i")]);
  const roundedProof = explainPlannerOpticsProof(q25, lens25, rounded);
  check("G35", roundedProof.proof === "proven", `u 25 f 10 under v = 16.7 cm, m = -0.67, h_i = -1.33 cm must be proven; got ${roundedProof.proof}: ${roundedProof.reason}`);
  expectDrawnAsPlanner("G35", "u 25 f 10 under the plan's rounded image", q25, rounded, lens25);
  expectRefusedByPlan("G35", "u 25 f 10 under an integer v = 17 cm", q25, plan25([derivedRow("v", 17)]), lens25, notAt);
}

for (const gate of ["G1", "G2", "G3", "G1a", "G1b", "G2c", "G2d", "G6a", "G5a", "G5b", "G7", "G8", "G9", "G10", "G11", "G12a", "G12b", "G12c", "G12d", "G13", "G14", "G15", "G16", "G17", "G18", "G19", "G20", "G21", "G22", "G23", "G24", "G25", "G26", "G27", "G28", "G29", "G30", "G31", "G32", "G33", "G34", "G35"]) {
  console.log(`${gate}: ${gates.get(gate) ? `FAIL (${gates.get(gate)} checks)` : "pass"}`);
}
for (const [name, failed] of namedCases) console.log(`  ${name}: ${failed ? `FAIL (${failed} checks)` : "pass"}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-optics-proof: proven lens and mirror figures draw; wrong and forged optics figures never do");
