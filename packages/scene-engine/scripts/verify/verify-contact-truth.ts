/**
 * Contact truth (compile/contactTruth.ts), on figures built here and on the shapes production and the lab drew.
 *
 * A block inside its wedge, a block across its floor and a string through a table all passed as verified: their assertions cover force
 * directions and labels, never which side of a surface a body is on. Every refuse row must carry its code. Every keep row is a true figure
 * that must compile with no contact issue: refusing it would cost a right figure.
 *
 *   npx tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-contact-truth.ts   (from packages/scene-engine)
 */
import { compileSceneDocument } from "../../src/index";

type Doc = Record<string, unknown>;
type Xy = readonly [number, number];
type Item = { id: string; role: string; kind: string; at?: unknown; label?: string; inputs?: Record<string, unknown>; operator?: string };

const seg = (id: string, role: string, a: Xy, b: Xy): Item[] => [
  { id: `${id}_a`, role: "end", kind: "point", at: a },
  { id: `${id}_b`, role: "end", kind: "point", at: b },
  { id, role, kind: "segment", operator: "segment", inputs: { start: `${id}_a`, end: `${id}_b` } },
];
const poly = (id: string, role: string, corners: Xy[], label = "m"): Item[] => [
  ...corners.map((c, i): Item => ({ id: `${id}_${i}`, role: "corner", kind: "point", at: c })),
  { id, role, kind: "polygon", label, operator: "polygon", inputs: { points: corners.map((_, i) => `${id}_${i}`) } },
];
const rect = (id: string, role: string, center: Xy, width: number, height: number, label = "m"): Item[] => [
  { id: `${id}_c`, role: "centre", kind: "point", at: center },
  { id, role, kind: "rectangle", label, operator: "rectangle", inputs: { center: `${id}_c`, width, height } },
];
const disc = (id: string, role: string, center: Xy, radius: number, label = "m"): Item[] => [
  { id: `${id}_c`, role: "centre", kind: "point", at: center },
  { id, role, kind: "circle", label, operator: "circle", inputs: { center: `${id}_c`, radius } },
];
const arrow = (id: string, role: string, start: Xy, direction: Xy, label: string): Item[] => [
  { id: `${id}_s`, role: "tail", kind: "point", at: start },
  { id, role, kind: "vector", label, operator: "vector", inputs: { start: `${id}_s`, direction: [...direction], length: 1 } },
];

function scene(question: string, items: Item[], annotations: unknown[] = []): Doc {
  const entities = items.map(({ id, role, kind, label }) => ({ id, role, kind, ...(label ? { label } : {}) }));
  const constructions = items.map((item) => item.at
    ? { id: `make_${item.id}`, operator: "point", inputs: { x: (item.at as Xy)[0], y: (item.at as Xy)[1], coordinateSpace: "world" }, outputs: [item.id] }
    : { id: `make_${item.id}`, operator: item.operator!, inputs: item.inputs!, outputs: [item.id] });
  return {
    schemaVersion: "scene-document/v2",
    source: { question, nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "contact truth fixture" },
    entities, relations: [], assertions: [], quantities: [], annotations, teachingTimeline: [],
    revealGroups: [{ id: "setup", dependsOn: [], entityIds: entities.map((e) => e.id), narrationCue: "setup" }],
    constructions, requiredEntityIds: entities.map((e) => e.id),
  };
}

const wedge = (mirror = 1): Item[] => [
  ...seg("incline", "rough inclined plane", [0, 0], [mirror * 4.6, 2.6]),
  ...seg("ground", "horizontal ground", [0, 0], [mirror * 4.6, 0]),
  ...seg("rise", "vertical side", [mirror * 4.6, 0], [mirror * 4.6, 2.6]),
];
const x = (mirror: number, corners: Xy[]): Xy[] => corners.map(([a, b]) => [mirror * a, b] as const);
const UNDER: Xy[] = [[1.9, 1.074], [2.9, 1.639], [3.19, 1.15], [2.19, 0.58]];
const ON: Xy[] = [[1.9, 1.074], [2.9, 1.639], [2.61, 2.13], [1.61, 1.57]];
const ACROSS: Xy[] = [[1.61, 1.57], [2.19, 0.58], [3.19, 1.15], [2.61, 2.13]];

const refuse: { name: string; code: string; doc: Doc }[] = [
  { name: "incline card: block under the slope, on a closed wedge", code: "body_inside_surface", doc: scene("Block on a rough incline.", [...wedge(), ...poly("body", "block", [...UNDER])]) },
  { name: "the same, wedge rising to the left", code: "body_inside_surface", doc: scene("Block on a rough incline.", [...wedge(-1), ...poly("body", "block", x(-1, UNDER))]) },
  { name: "the same, slope drawn top to foot", code: "body_inside_surface", doc: scene("Block on a rough incline.", [...seg("incline", "inclined plane", [4.6, 2.6], [0, 0]), ...seg("ground", "ground", [0, 0], [4.6, 0]), ...seg("rise", "side", [4.6, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER])]) },
  { name: "open slope: only the normal reaction names the free side", code: "body_inside_surface", doc: scene("Block on a slope.", [...seg("slope", "slope", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER]), ...arrow("N", "normal reaction on the block", [2.5, 1.1], [-0.4924, 0.8704], "N")]) },
  { name: "floor: block hangs under the floor, flush", code: "body_inside_surface", doc: scene("A box on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, -0.5], 1, 1)]) },
  { name: "floor drawn right to left: block under it, flush", code: "body_inside_surface", doc: scene("A box on a floor.", [...seg("floor", "floor", [6, 0], [0, 0]), ...rect("box", "box", [3, -0.5], 1, 1)]) },
  { name: "ball under a road, tangent", code: "body_inside_surface", doc: scene("A wheel on a road.", [...seg("road", "road", [0, 0], [8, 0]), ...disc("wheel", "wheel", [3, -0.6], 0.6)]) },
  { name: "production b5ba0604 shape: slope through the middle of the block", code: "body_straddles_surface", doc: scene("A body slides up a 45 degree plane.", [...wedge(), ...poly("body", "block", [...ACROSS])]) },
  { name: "floor through the middle of a box", code: "body_straddles_surface", doc: scene("A box on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0], 1, 1)]) },
  { name: "ball centred on the ground line", code: "body_straddles_surface", doc: scene("A ball on the ground.", [...seg("ground", "ground", [0, 0], [6, 0]), ...disc("ball", "ball", [3, 0], 0.5)]) },
  { name: "hatched line with no surface word through a box", code: "body_straddles_surface", doc: scene("A box.", [...seg("s", "support line", [0, 0], [6, 0]), ...rect("box", "box", [3, 0], 1, 1)], [{ id: "h", kind: "hatch", targetIds: ["s"] }]) },
  { name: "block overlapping a table drawn as a solid", code: "body_inside_surface", doc: scene("A block on a table.", [...rect("table", "table top", [0, -0.5], 6, 1, "table"), ...rect("box", "block", [0, -0.2], 1, 1)]) },
  { name: "block overlapping a wedge polygon", code: "body_inside_surface", doc: scene("A block on a wedge.", [...poly("wedge", "wedge", [[0, 0], [4.6, 0], [4.6, 2.6]], "M"), ...poly("body", "block", [...UNDER])]) },
  { name: "production 4fb87931 shape: string to the hanging block through the table", code: "string_through_surface", doc: scene("Block A on a table joined over a pulley to B.", [...seg("surface", "horizontal surface", [-3, 0], [0, 0]), ...seg("string", "vertical string", [-1.25, 0.55], [-1.25, -1.1]), ...rect("blockB", "block B", [-1.25, -1.4], 0.6, 0.6, "B")]) },
  { name: "only the closed triangle names the solid side: a hatched face, no resting word", code: "body_inside_surface", doc: scene("A block.", [...seg("face", "sloping face", [0, 0], [4.6, 2.6]), ...seg("base", "base line", [0, 0], [4.6, 0]), ...seg("back", "back line", [4.6, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER])], [{ id: "h", kind: "hatch", targetIds: ["face"] }]) },
  { name: "only the normal reaction names the free side: a surface with no resting word", code: "body_inside_surface", doc: scene("A block.", [...seg("face", "slanted surface", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER]), ...arrow("N", "normal reaction on the block", [2.5, 1.1], [-0.4924, 0.8704], "N")]) },
  { name: "floor hatched from right to left: the ticks fall inside the box on it", code: "hatch_inside_body", doc: scene("A box on a floor.", [...seg("floor", "floor", [6, 0], [0, 0]), ...rect("box", "box", [3, 0.5], 1, 1)], [{ id: "h", kind: "hatch", targetIds: ["floor"] }]) },
  { name: "a string well inside the table's end still crosses it", code: "string_through_surface", doc: scene("A block on a table joined over a pulley to B.", [...seg("table", "table", [-3, 0], [0, 0]), ...seg("string", "vertical string", [-0.5, 0.3], [-0.5, -1.2]), ...rect("m", "hanging block", [-0.5, -1.5], 0.6, 0.6, "M")]) },
  { name: "a stem that says as well as does not switch the check off", code: "body_straddles_surface", doc: scene("A block slides on the floor as well as on the slope.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a level road is a surface", code: "body_straddles_surface", doc: scene("A car on a level road.", [...seg("road", "level road", [0, 0], [8, 0]), ...rect("car", "car", [4, 0], 2, 1)]) },
  { name: "a stray normal arrow cannot make the underside free: gravity decides on a slope", code: "body_inside_surface", doc: scene("Block on a slope.", [...seg("slope", "slope", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER]), ...arrow("N", "weight component normal to the plane", [2.5, 1.1], [0.4924, -0.8704], "w")]) },
  { name: "a block clear of the faces, wholly inside a three line wedge", code: "body_inside_surface", doc: scene("A block on a wedge.", [...wedge(), ...rect("box", "block", [3.4, 0.7], 0.5, 0.5)]) },
  { name: "a block across a thin table: no corner lies inside the table", code: "body_inside_surface", doc: scene("A block on a table.", [...rect("table", "table", [0, 0], 8, 0.2, "table"), ...rect("box", "block", [0, 0], 1, 2)]) },
  { name: "a rope through a thick table between any sample points", code: "string_through_surface", doc: scene("A rope.", [...rect("table", "table", [0, 0], 8, 0.1, "table"), ...seg("rope", "rope", [1, 2], [1, -2])]) },
  { name: "a wedge of mass M drawn as a polygon is still solid", code: "body_inside_surface", doc: scene("A block on a wedge.", [...poly("wedge", "wedge of mass M", [[0, 0], [4.6, 0], [4.6, 2.6]], "M"), ...rect("box", "block", [3.4, 0.7], 0.5, 0.5)]) },
  { name: "a polyline ground runs through a block", code: "body_straddles_surface", doc: scene("A block on the ground.", [{ id: "g0", role: "end", kind: "point", at: [0, 0] }, { id: "g1", role: "end", kind: "point", at: [3, 0] }, { id: "g2", role: "end", kind: "point", at: [6, 0] }, { id: "ground", role: "ground", kind: "polyline", operator: "polyline", inputs: { points: ["g0", "g1", "g2"] } }, ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a train across a bridge deck", code: "body_straddles_surface", doc: scene("A train on a bridge.", [...seg("deck", "bridge deck", [0, 0], [10, 0]), ...rect("t", "train", [5, 0], 3, 1)]) },
  { name: "only the reaction on this body names a wall's free side", code: "body_inside_surface", doc: scene("A block against a wall.", [...seg("wall", "vertical wall", [0, 0], [0, 4]), ...rect("box", "block", [-0.5, 2], 1, 1), ...arrow("N", "normal reaction on the block", [-0.5, 2], [1, 0], "N")]) },
  { name: "rope through a solid table", code: "string_through_surface", doc: scene("A rope.", [...rect("table", "table", [0, -0.5], 6, 1, "table"), ...seg("rope", "rope", [1, 1], [1, -2])]) },
];

const keep: { name: string; doc: Doc }[] = [
  { name: "block on the slope's free side", doc: scene("Block on a rough incline.", [...wedge(), ...poly("body", "block", [...ON])]) },
  { name: "the same, wedge rising to the left", doc: scene("Block on a rough incline.", [...wedge(-1), ...poly("body", "block", x(-1, ON))]) },
  { name: "the same, slope drawn top to foot", doc: scene("Block on a rough incline.", [...seg("incline", "inclined plane", [4.6, 2.6], [0, 0]), ...seg("ground", "ground", [0, 0], [4.6, 0]), ...seg("rise", "side", [4.6, 0], [4.6, 2.6]), ...poly("body", "block", [...ON])]) },
  { name: "open slope with normal reaction, block on top", doc: scene("Block on a slope.", [...seg("slope", "slope", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...ON]), ...arrow("N", "normal reaction on the block", [2.2, 1.6], [-0.4924, 0.8704], "N")]) },
  { name: "ball tangent to a slope from above", doc: scene("A sphere rolls down a slope.", [...seg("slope", "slope", [0, 0], [4, 3]), ...disc("ball", "rolling sphere", [1.7, 1.875], 0.5)]) },
  { name: "wheel tangent to a road from above", doc: scene("A wheel on a road.", [...seg("road", "road", [0, 0], [8, 0]), ...disc("wheel", "wheel", [3, 0.6], 0.6)]) },
  { name: "box on a floor", doc: scene("A box on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0.5], 1, 1)]) },
  { name: "box on a table drawn as a solid", doc: scene("A block on a table.", [...rect("table", "table top", [0, -0.5], 6, 1, "table"), ...rect("box", "block", [0, 0.5], 1, 1)]) },
  { name: "block on a wedge polygon's face", doc: scene("A block on a wedge.", [...poly("wedge", "wedge", [[0, 0], [4.6, 0], [4.6, 2.6]], "M"), ...poly("body", "block", [...ON])]) },
  { name: "block below a table, clear of it", doc: scene("A hanging block.", [...seg("table", "table", [-3, 0], [0, 0]), ...rect("box", "block B", [0.6, -1.5], 0.6, 0.6, "B")]) },
  { name: "string off the table's edge", doc: scene("Block A on a table joined over a pulley to B.", [...seg("table", "table", [-3, 0], [0, 0]), ...seg("string", "vertical string", [0.3, 0.3], [0.3, -1.2]), ...rect("blockB", "block B", [0.3, -1.5], 0.6, 0.6, "B")]) },
  { name: "string through a stated hole in the table", doc: scene("A block on a table is tied by a string through a hole in the table to a hanging mass.", [...seg("table", "table", [-3, 0], [3, 0]), ...seg("string", "string", [0, 0.5], [0, -1.2]), ...rect("box", "hanging mass", [0, -1.5], 0.6, 0.6, "M")]) },
  { name: "floating block across the water surface", doc: scene("A block floats in water.", [...seg("water", "water surface", [0, 0], [6, 0]), ...rect("box", "floating block", [3, 0], 1, 1)]) },
  { name: "hatched free surface of a liquid through a body", doc: scene("A body partly immersed.", [...seg("lvl", "liquid level", [0, 0], [6, 0]), ...rect("box", "body", [3, 0], 1, 1)], [{ id: "h", kind: "hatch", targetIds: ["lvl"] }]) },
  { name: "block pressed up against a ceiling, normal down", doc: scene("A block is pressed against a ceiling.", [...seg("ceiling", "ceiling", [0, 2], [6, 2]), ...rect("box", "block", [3, 1.5], 1, 1), ...arrow("N", "normal reaction from the ceiling", [3, 1.5], [0, -1], "N")]) },
  { name: "block pressed against a wall on either side", doc: scene("A block is held against a wall.", [...seg("wall", "vertical wall", [0, 0], [0, 4]), ...rect("box", "block", [-0.5, 2], 1, 1)]) },
  { name: "third law arrow: force on the surface points into it", doc: scene("The block presses on the floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.5], 1, 1), ...arrow("N", "normal force on the floor by the block", [3, 0], [0, -1], "N")]) },
  { name: "box under a ladder: floor, wall and ladder close a triangle of air", doc: scene("A ladder leans on a wall above a box.", [...seg("floor", "floor", [0, 0], [4, 0]), ...seg("wall", "wall", [4, 0], [4, 3]), ...seg("ladder", "ladder", [0, 0], [4, 3]), ...rect("box", "box", [2.8, 0.4], 0.8, 0.8)]) },
  { name: "block on a slope with a ladder closing the triangle", doc: scene("A ladder.", [...seg("ramp", "ramp", [0, 0], [4, 3]), ...seg("ladder", "ladder", [4, 3], [4, 0]), ...seg("ground", "ground", [0, 0], [4, 0]), ...rect("box", "box", [3, 0.4], 0.8, 0.8)]) },
  { name: "block in a lift: floor, walls and roof close a room", doc: scene("A block in a lift.", [...seg("floor", "lift floor", [0, 0], [4, 0]), ...seg("wr", "wall", [4, 0], [4, 3]), ...seg("roof", "roof", [4, 3], [0, 3]), ...seg("wl", "wall", [0, 3], [0, 0]), ...rect("box", "block", [2, 0.5], 1, 1)]) },
  { name: "the closed triangle overrules gravity: a block under an overhanging slope", doc: scene("A block held under an overhang.", [...seg("slope", "sloping wedge face", [0, 0], [4.6, 2.6]), ...seg("top", "top line", [0, 2.6], [4.6, 2.6]), ...seg("back", "back line", [0, 0], [0, 2.6]), ...poly("body", "block", [...UNDER])]) },
  { name: "the normal reaction overrules gravity: a block under a ramp, normal down", doc: scene("A block is pressed up against the underside of a ramp.", [...seg("ramp", "ramp", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER]), ...arrow("N", "normal reaction on the block", [2.5, 1.1], [0.4924, -0.8704], "N")]) },
  { name: "a flat floor closed by a wall and a diagonal is a triangle of air", doc: scene("A box under a support.", [...seg("floor", "floor", [0, 0], [4, 0]), ...seg("wall", "side line", [4, 0], [4, 3]), ...seg("diag", "diagonal support line", [0, 0], [4, 3]), ...rect("box", "box", [2.8, 0.4], 0.8, 0.8)]) },
  { name: "a ladder does not close a wedge: block on a ramp under a ladder", doc: scene("A ladder above a ramp.", [...seg("ramp", "ramp", [0, 0], [4.6, 2.6]), ...seg("ladder", "ladder", [4.6, 2.6], [0, 2.6]), ...seg("back", "back line", [0, 2.6], [0, 0]), ...poly("body", "block", [...ON])]) },
  { name: "a block against the vertical side of a wedge makes no gravity claim", doc: scene("A block against a wedge side.", [...seg("side", "vertical side of the wedge", [4, 0], [4, 3]), ...rect("box", "block", [4.5, 1], 1, 1)]) },
  { name: "a box level with the floor but past its end", doc: scene("A box past the floor's edge.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [8, -0.5], 1, 1)]) },
  { name: "a line of motion along a ramp through two bodies is not a surface", doc: scene("Two bodies on a line.", [...seg("axis", "line of motion along the ramp", [0, 0], [6, 0]), ...disc("b1", "body 1", [1, 0], 0.5), ...disc("b2", "body 2", [4, 0], 0.5)]) },
  { name: "a ground state line through a ring is not a surface", doc: scene("A ring.", [...seg("g", "ground state line", [0, 0], [6, 0]), ...disc("o", "ring", [3, 0], 1)]) },
  { name: "a diameter in the plane of a disc runs through it", doc: scene("Perpendicular axes for a disc.", [...seg("xa", "diameter in disk plane", [-3, 0], [3, 0]), ...disc("d", "uniform thin disk", [0, 0], 1.5)]) },
  { name: "a line lying in a stated plane is not a surface", doc: scene("A plate in a plane.", [...seg("ya", "line in the horizontal plane", [-3, 0], [3, 0]), ...rect("b", "rectangular body", [0, 0], 2, 1)]) },
  { name: "floor hatched from left to right: the ticks fall under the box", doc: scene("A box on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0.5], 1, 1)], [{ id: "h", kind: "hatch", targetIds: ["floor"] }]) },
  { name: "floor hatched from right to left, box between two ticks", doc: scene("A box on a floor.", [...seg("floor", "floor", [7, 0], [0, 0]), ...rect("box", "box", [3.5, 0.3], 0.6, 0.6)], [{ id: "h", kind: "hatch", targetIds: ["floor"] }]) },
  { name: "a block partly sunk in sand", doc: scene("A heavy block is partly sunk in sand.", [...seg("sand", "sand surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.1], 1, 1)]) },
  { name: "a stem that says partly sunk keeps a plain ground line", doc: scene("A block sinks into the ground and comes to rest partly buried.", [...seg("ground", "ground", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.1], 1, 1)]) },
  { name: "a stone in a well, below the ground line", doc: scene("A stone is dropped into a well.", [...seg("ground", "ground", [-3, 0], [3, 0]), ...disc("stone", "stone", [0, -2], 0.3), ...seg("rope", "rope", [0, 1], [0, -1.7])]) },
  { name: "a ball in a tunnel through the ground", doc: scene("A ball is dropped into a tunnel through the earth.", [...seg("ground", "ground", [-3, 0], [3, 0]), ...disc("ball", "ball", [0, 0], 0.4)]) },
  { name: "a string over a pulley clamped at the table's edge", doc: scene("A block on a table is tied over a pulley at the table's edge to a hanging mass.", [...seg("table", "table", [-3, 0], [0, 0]), ...seg("string", "vertical string", [-0.15, 0.3], [-0.15, -1.2]), ...rect("m", "hanging block", [-0.15, -1.5], 0.6, 0.6, "M")]) },
  { name: "a ball tangent to a slope hatched on its side: the ticks stay outside the ball", doc: scene("A ball rolls down a slope.", [...seg("slope", "slope", [4, 3], [0, 0]), ...disc("ball", "rolling sphere", [1.7, 1.875], 0.5)], [{ id: "h", kind: "hatch", targetIds: ["slope"] }]) },
  { name: "a block across a water surface, with no stem word for it", doc: scene("A block in water.", [...seg("water", "water surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a block across a sand surface, with no stem word for it", doc: scene("A block on sand.", [...seg("sand", "sand surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a diameter across a plane disc", doc: scene("A disc.", [...seg("xa", "diameter across the plane disc", [-3, 0], [3, 0]), ...disc("d", "uniform thin disk", [0, 0], 1.5)]) },
  { name: "a ray whose role says surface contact crosses a block", doc: scene("A block and a ray.", [...seg("ray", "surface contact geometry", [-2, 0], [2, 0]), ...rect("box", "block", [0, 0], 1, 1)]) },
  { name: "a glass block crossed by the surface of a hatched line", doc: scene("A glass block.", [...seg("s", "entry surface", [-2, 0], [2, 0]), ...rect("g", "glass block", [0, 0], 1, 1)]) },
  { name: "a truck's floor runs inside the truck", doc: scene("A crate rests on the floor of a truck.", [...rect("truck", "truck", [0, 0.8], 6, 2.4), ...seg("floor", "truck floor", [-3, 0], [3, 0]), ...rect("crate", "crate", [0, 0.4], 0.8, 0.8)]) },
  { name: "a gas cylinder with a piston surface", doc: scene("A gas is held in a cylinder fitted with a piston.", [...rect("cyl", "gas cylinder", [0, 0], 2, 5), ...seg("p", "piston surface", [-1, 0.5], [1, 0.5])]) },
  { name: "stacked blocks: the normal on the lower block by the upper one", doc: scene("Two stacked blocks.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("b1", "lower block", [3, 0.5], 2, 1, "M"), ...arrow("N", "normal force on lower block by upper block", [3, 1], [0, -1], "N")]) },
  { name: "a block between two walls with a reaction from each", doc: scene("A block is held between two walls.", [...seg("w1", "wall", [0, 0], [0, 3]), ...seg("w2", "wall", [2, 0], [2, 3]), ...rect("box", "block", [1, 1.5], 2, 1), ...arrow("N1", "normal reaction from the left wall", [1, 1.5], [1, 0], "N1"), ...arrow("N2", "normal reaction from the right wall", [1, 1.5], [-1, 0], "N2")]) },
  { name: "a normal from another panel says nothing about this body", doc: scene("Two panels.", [...seg("w", "wall", [0, 0], [0, 3]), ...rect("box", "block", [0.5, 1.5], 1, 1), ...rect("other", "block", [8, 1.5], 1, 1), ...arrow("N", "normal reaction", [8, 1.5], [-1, 0], "N")]) },
  { name: "a cylinder in a V groove closed by a rim: the triangle is air", doc: scene("A cylinder rests in a V groove.", [...seg("l", "left inclined surface", [-3, 3], [0, 0]), ...seg("r", "right inclined surface", [0, 0], [3, 3]), ...seg("rim", "rim line", [-3, 3], [3, 3]), ...disc("c", "cylinder", [0, 1.414], 1)]) },
  { name: "a sphere inscribed in a cone", doc: scene("A sphere is inscribed in a right circular cone.", [...seg("l", "lateral surface", [-2, 0], [0, 3]), ...seg("r", "lateral surface", [0, 3], [2, 0]), ...seg("base", "base line", [-2, 0], [2, 0]), ...disc("s", "sphere", [0, 1.07], 1.07)]) },
  { name: "a block under a shelf", doc: scene("A block hangs close under a shelf.", [...seg("s", "shelf", [0, 2], [4, 2]), ...rect("box", "block", [2, 1.5], 1, 1)]) },
  { name: "a platform on two rollers", doc: scene("A platform moves on two rollers.", [...seg("p", "platform", [0, 1], [6, 1]), ...disc("r1", "cylinder", [1.5, 0.5], 0.5), ...disc("r2", "cylinder", [4.5, 0.5], 0.5)]) },
  { name: "a ramp propped on a block", doc: scene("A ramp is propped on a wooden block.", [...seg("ramp", "ramp", [0, 0], [4.6, 2.6]), ...poly("body", "wooden block", [...UNDER])]) },
  { name: "words: a cutting plane through a sphere", doc: scene("A sphere is cut by a plane.", [...seg("c", "cutting plane", [-3, 0], [3, 0]), ...disc("s", "sphere", [0, 0], 1.5)]) },
  { name: "words: a molecular plane through a benzene ring", doc: scene("Benzene.", [...seg("m", "molecular plane", [-3, 0], [3, 0]), ...disc("r", "benzene ring", [0, 0], 1.5)]) },
  { name: "words: a periodic table row beside a box", doc: scene("The periodic table.", [...seg("t", "periodic table row", [-3, 0], [3, 0]), ...rect("b", "box", [0, 0], 1, 1)]) },
  { name: "words: a hash table row through a box", doc: scene("A hash table.", [...seg("t", "hash table row", [-3, 0], [3, 0]), ...rect("b", "box", [0, 0], 1, 1)]) },
  { name: "words: a height above the ground to a ball's centre", doc: scene("A ball above the ground.", [...seg("g", "ground", [-3, 0], [3, 0]), ...disc("b", "ball", [0, 3], 0.4), ...seg("h", "height above the ground", [0, 0], [0, 3])]) },
  { name: "words: a direction along the incline through a block", doc: scene("A block on an incline.", [...seg("d", "direction along the incline", [-3, 0], [3, 0]), ...rect("b", "block", [0, 0], 1, 1)]) },
  { name: "words: a ladder against the wall above a box", doc: scene("A ladder leans against a wall.", [...seg("floor", "floor", [0, 0], [4, 0]), ...seg("wall", "wall", [4, 0], [4, 3]), ...seg("ladder", "ladder against the wall", [0, 0], [4, 3]), ...rect("box", "box", [2.8, 0.4], 0.8, 0.8)]) },
  { name: "words: a cell body on a ground rail in a circuit", doc: scene("A circuit.", [...seg("g", "ground rail", [0, 0], [6, 0]), ...rect("c", "cell body", [3, 0], 1, 0.5)]) },
  { name: "words: a rope into a borewell, a string in a tube, a Hindi hole", doc: scene("A stone tied to a rope is lowered into a deep borewell.", [...seg("g", "ground", [-3, 0], [3, 0]), ...seg("rope", "rope", [0, 1], [0, -2]), ...disc("stone", "stone", [0, -2.3], 0.3)]) },
  { name: "words: a Hindi stem naming a hole", doc: scene("मेज़ में एक छेद है और डोरी उसमें से गुजरती है।", [...seg("t", "table", [-3, 0], [3, 0]), ...seg("str", "string", [0, 1], [0, -2]), ...rect("m", "hanging mass", [0, -2.3], 0.6, 0.6, "M")]) },
  { name: "words: an electric cable and a spinal cord are not strings", doc: scene("A cable.", [...seg("w", "wall", [0, -3], [0, 3]), ...seg("c", "spinal cord", [-2, 0], [2, 0]), ...seg("e", "electric cord", [-2, 1], [2, 1])]) },
  { name: "ice with a quarter of its volume above the surface", doc: scene("An ice cube in a tumbler has a quarter of its volume above the top surface.", [...seg("s", "surface", [-3, 0], [3, 0]), ...rect("c", "ice cube", [0, -0.25], 1, 1)]) },
  { name: "a ball centred on a table's edge, leaving it", doc: scene("A ball leaves a table's edge horizontally.", [...seg("t", "table", [-4, 2], [0, 2]), ...disc("ball", "ball", [0, 2], 0.2)]) },
  { name: "a small ball centred on a launch point", doc: scene("A ball is thrown from the ground at 30 degrees.", [...seg("g", "ground", [0, 0], [10, 0]), ...disc("ball", "ball", [5, 0], 0.2)]) },
  { name: "a string to a hook just above the ceiling", doc: scene("A pendulum hangs from a hook in the ceiling.", [...seg("ceiling", "ceiling", [-2, 3], [2, 3]), ...seg("str", "string", [0, 3.2], [0, 0.6]), ...disc("bob", "bob", [0, 0.3], 0.3)]) },
  { name: "third law on a wall: the force on the wall points into it", doc: scene("The block presses on the wall.", [...seg("wall", "vertical wall", [0, 0], [0, 4]), ...rect("box", "block", [-0.5, 2], 1, 1), ...arrow("N", "normal force on the wall by the block", [-0.5, 2], [1, 0], "N")]) },
  { name: "a dot marking a particle on a long slope", doc: scene("A particle on an incline.", [...seg("slope", "slope", [0, 0], [40, 30]), ...disc("p", "particle", [20, 15], 0.3)]) },
  { name: "ball in flight above the ground", doc: scene("A projectile.", [...seg("ground", "ground", [0, 0], [10, 0]), ...disc("ball", "ball", [5, 3], 0.3)]) },
  { name: "plane mirror hatched behind an object", doc: scene("An object in front of a mirror.", [...seg("m", "plane mirror", [0, 0], [0, 4]), ...rect("box", "object", [0, 2], 1, 1)], [{ id: "h", kind: "hatch", targetIds: ["m"] }]) },
  { name: "capacitor plate through a dielectric slab", doc: scene("A capacitor.", [...seg("plate", "capacitor plate", [0, 0], [4, 0]), ...rect("box", "dielectric object", [2, 0], 2, 1)], [{ id: "h", kind: "hatch", targetIds: ["plate"] }]) },
  { name: "the axis of motion through two bodies is not a surface", doc: scene("Two bodies collide.", [...seg("axis", "line of motion", [0, 0], [6, 0]), ...disc("b1", "body 1", [1, 0], 0.5), ...disc("b2", "body 2", [4, 0], 0.5)]) },
  { name: "a block on another block is not a surface", doc: scene("Two blocks.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("b1", "lower block", [3, 0.5], 2, 1, "M"), ...rect("b2", "upper block", [3, 1.5], 1, 1, "m")]) },
  { name: "ground state level across an electron orbit is not a surface", doc: scene("An atom.", [...seg("g", "ground state energy level", [0, 0], [6, 0]), ...disc("o", "electron shell ring", [3, 0], 1)]) },
];

const CODES = new Set(["body_straddles_surface", "body_inside_surface", "string_through_surface", "hatch_inside_body"]);
const codesOf = (doc: Doc): string[] => {
  const result = compileSceneDocument(doc as never, { figureConsistency: true });
  return result.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
};
const failures: string[] = [];
let passed = 0;
for (const row of refuse) {
  const codes = codesOf(row.doc);
  if (codes.includes(row.code)) passed += 1;
  else failures.push(`REFUSE ${row.name}: wanted ${row.code}, got ${codes.join(",") || "no fatal issue"}`);
}
for (const row of keep) {
  const hits = codesOf(row.doc).filter((code) => CODES.has(code));
  if (hits.length === 0) passed += 1;
  else failures.push(`KEEP ${row.name}: refused with ${hits.join(",")}`);
}
// A saved board compiles without admission options, so an old figure still reopens. Every refuse row is one.
for (const row of refuse) {
  if (!codesOf(row.doc).includes(row.code)) continue;
  const reopened = compileSceneDocument(row.doc as never).report.issues.filter((issue) => CODES.has(issue.code));
  if (reopened.length) failures.push(`SAVED BOARD ${row.name}: a compile without admission options was refused with ${reopened.map((issue) => issue.code).join(",")}`);
}
passed += 1;
// A refusing check must not throw on a large outline.
try {
  const many = Array.from({ length: 1000 }, (_, i): Xy => [3 + Math.cos((i * 2 * Math.PI) / 1000), 1.2 + Math.sin((i * 2 * Math.PI) / 1000)]);
  compileSceneDocument(scene("A ball on the floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...poly("body", "block", many)]) as never, { figureConsistency: true });
  passed += 1;
} catch (error) {
  failures.push(`LARGE OUTLINE threw: ${String(error).slice(0, 100)}`);
}
for (const failure of failures) console.error(failure);
console.log(`verify-contact-truth: ${passed} passed, ${failures.length} failed of ${refuse.length + keep.length + 2}`);
if (failures.length) process.exit(1);
