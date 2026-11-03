/**
 * Contact truth (compile/contactTruth.ts), on figures built here.
 *
 * A block inside its wedge, a block across its floor and a string through a table all passed as verified: their
 * assertions cover force directions and labels, never which side of a surface a body is on. These rows have those
 * shapes, with every number and word authored here. Every refuse row must carry its code. Every keep row is a true
 * figure that must compile with no contact issue: refusing it would cost a right figure.
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

/** Each named group becomes a reveal group of its own, unconnected, so the compiler packs them into separate slots. */
function grouped(question: string, groups: Record<string, Item[]>): Doc {
  const doc = scene(question, Object.values(groups).flat()) as { revealGroups: unknown[] };
  doc.revealGroups = Object.entries(groups).map(([id, items]) => ({ id, dependsOn: [], entityIds: items.map((item) => item.id), narrationCue: id }));
  return doc as unknown as Doc;
}

/** A plain link, so a panel's parts are one connected figure. */
const link = (id: string, start: string, end: string): Item => ({ id, role: "link", kind: "segment", operator: "segment", inputs: { start, end } });

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
  { name: "floor: block hangs under the floor, flush", code: "body_inside_surface", doc: scene("A box rests on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, -0.5], 1, 1)]) },
  { name: "floor drawn right to left: block under it, flush", code: "body_inside_surface", doc: scene("A box rests on a floor.", [...seg("floor", "floor", [6, 0], [0, 0]), ...rect("box", "box", [3, -0.5], 1, 1)]) },
  { name: "ball under a road, tangent", code: "body_inside_surface", doc: scene("A wheel rolls on a road.", [...seg("road", "road", [0, 0], [8, 0]), ...disc("wheel", "wheel", [3, -0.6], 0.6)]) },
  { name: "the slope runs through the middle of the block", code: "body_straddles_surface", doc: scene("A body slides up a rough plane.", [...wedge(), ...poly("body", "block", [...ACROSS])]) },
  { name: "floor through the middle of a box", code: "body_straddles_surface", doc: scene("A box rests on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0], 1, 1)]) },
  { name: "ball centred on the ground line", code: "body_straddles_surface", doc: scene("A ball rests on the ground.", [...seg("ground", "ground", [0, 0], [6, 0]), ...disc("ball", "ball", [3, 0], 0.5)]) },
  { name: "a string alone is the evidence: no mechanics word in the stem", code: "string_through_surface", doc: scene("Block A and block B.", [...seg("surface", "horizontal surface", [-4, 0], [0, 0]), ...seg("string", "vertical string", [-1.6, 0.8], [-1.6, -1.4])]) },
  { name: "the string to the hanging block runs through the table", code: "string_through_surface", doc: scene("Block A on a table joined over a pulley to B.", [...seg("surface", "horizontal surface", [-4, 0], [0, 0]), ...seg("string", "vertical string", [-1.6, 0.8], [-1.6, -1.4]), ...rect("blockB", "block B", [-1.6, -1.8], 0.8, 0.8, "B")]) },
  { name: "a string well inside the table's end still crosses it", code: "string_through_surface", doc: scene("A block on a table joined over a pulley to B.", [...seg("table", "table", [-4, 0], [0, 0]), ...seg("string", "vertical string", [-0.5, 0.3], [-0.5, -1.2]), ...rect("m", "hanging block", [-0.5, -1.5], 0.6, 0.6, "M")]) },
  { name: "a stem that says as well as does not switch the check off", code: "body_straddles_surface", doc: scene("A block slides on the floor as well as on the slope.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a level road is a surface", code: "body_straddles_surface", doc: scene("A car moves at speed on a level road.", [...seg("road", "level road", [0, 0], [8, 0]), ...rect("car", "car", [4, 0], 2, 1)]) },
  { name: "a car across its road", code: "body_straddles_surface", doc: scene("A car moves at speed on a road.", [...seg("road", "road", [0, 0], [8, 0]), ...rect("car", "car", [4, 0], 2, 1)]) },
  { name: "a stray normal arrow cannot make the underside free: gravity decides on a slope", code: "body_inside_surface", doc: scene("Block on a slope.", [...seg("slope", "slope", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...UNDER]), ...arrow("N", "weight component normal to the plane", [2.5, 1.1], [0.4924, -0.8704], "w")]) },
  { name: "a polyline ground runs through a block", code: "body_straddles_surface", doc: scene("A block rests on the ground.", [{ id: "g0", role: "end", kind: "point", at: [0, 0] }, { id: "g1", role: "end", kind: "point", at: [3, 0] }, { id: "g2", role: "end", kind: "point", at: [6, 0] }, { id: "ground", role: "ground", kind: "polyline", operator: "polyline", inputs: { points: ["g0", "g1", "g2"] } }, ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a rough plane is a surface", code: "body_straddles_surface", doc: scene("A block rests on a rough plane.", [...seg("p", "rough plane", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a force arrow alone is the evidence: no mechanics word in the stem", code: "body_straddles_surface", doc: scene("A box and a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0], 1, 1), ...arrow("W", "weight", [3, 0], [0, -1], "W")]) },
  { name: "a stem saying well labelled does not switch the check off", code: "body_straddles_surface", doc: scene("Draw a well labelled figure of a block resting on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a stem saying fixed in position does not switch the check off", code: "body_straddles_surface", doc: scene("A block rests on a floor, fixed in position.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a role saying well or fixed in does not switch the check off", code: "body_straddles_surface", doc: scene("A block rests on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1), ...seg("mark", "potential well marker fixed in the ceiling", [0, 5], [1, 5])]) },
];

const keep: { name: string; doc: Doc }[] = [
  { name: "block on the slope's free side", doc: scene("Block on a rough incline.", [...wedge(), ...poly("body", "block", [...ON])]) },
  { name: "the same, wedge rising to the left", doc: scene("Block on a rough incline.", [...wedge(-1), ...poly("body", "block", x(-1, ON))]) },
  { name: "the same, slope drawn top to foot", doc: scene("Block on a rough incline.", [...seg("incline", "inclined plane", [4.6, 2.6], [0, 0]), ...seg("ground", "ground", [0, 0], [4.6, 0]), ...seg("rise", "side", [4.6, 0], [4.6, 2.6]), ...poly("body", "block", [...ON])]) },
  { name: "open slope with normal reaction, block on top", doc: scene("Block on a slope.", [...seg("slope", "slope", [0, 0], [4.6, 2.6]), ...poly("body", "block", [...ON]), ...arrow("N", "normal reaction on the block", [2.2, 1.6], [-0.4924, 0.8704], "N")]) },
  { name: "ball tangent to a slope from above", doc: scene("A sphere rolls down a slope.", [...seg("slope", "slope", [0, 0], [4, 3]), ...disc("ball", "rolling sphere", [1.7, 1.875], 0.5)]) },
  { name: "wheel tangent to a road from above", doc: scene("A wheel on a road.", [...seg("road", "road", [0, 0], [8, 0]), ...disc("wheel", "wheel", [3, 0.6], 0.6)]) },
  { name: "box on a floor", doc: scene("A box on a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0.5], 1, 1)]) },
  { name: "block below a table, clear of it", doc: scene("A hanging block.", [...seg("table", "table", [-4, 0], [0, 0]), ...rect("box", "block B", [0.6, -1.5], 0.6, 0.6, "B")]) },
  { name: "string off the table's edge", doc: scene("Block A on a table joined over a pulley to B.", [...seg("table", "table", [-4, 0], [0, 0]), ...seg("string", "vertical string", [0.4, 0.4], [0.4, -1.4]), ...rect("blockB", "block B", [0.4, -1.8], 0.8, 0.8, "B")]) },
  { name: "string through a stated hole in the table", doc: scene("A block on a table is tied by a string through a hole in the table to a hanging mass.", [...seg("table", "table", [-3, 0], [3, 0]), ...seg("string", "string", [0, 0.5], [0, -1.2]), ...rect("box", "hanging mass", [0, -1.5], 0.6, 0.6, "M")]) },
  { name: "floating block across the water surface", doc: scene("A block floats in water.", [...seg("water", "water surface", [0, 0], [6, 0]), ...rect("box", "floating block", [3, 0], 1, 1)]) },
  { name: "third law arrow: force on the surface points into it", doc: scene("The block presses on the floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.5], 1, 1), ...arrow("N", "normal force on the floor by the block", [3, 0], [0, -1], "N")]) },
  { name: "a box level with the floor but past its end", doc: scene("A box past the floor's edge.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [8, -0.5], 1, 1)]) },
  { name: "a line of motion along a ramp through two bodies is not a surface", doc: scene("Two bodies on a line.", [...seg("axis", "line of motion along the ramp", [0, 0], [6, 0]), ...disc("b1", "body 1", [1, 0], 0.5), ...disc("b2", "body 2", [4, 0], 0.5)]) },
  { name: "a ground state line through a ring is not a surface", doc: scene("A ring.", [...seg("g", "ground state line", [0, 0], [6, 0]), ...disc("o", "ring", [3, 0], 1)]) },
  { name: "a diameter in the plane of a disc runs through it", doc: scene("Perpendicular axes for a disc.", [...seg("xa", "diameter in disk plane", [-3, 0], [3, 0]), ...disc("d", "uniform thin disk", [0, 0], 1.5)]) },
  { name: "a block partly sunk in sand", doc: scene("A heavy block is partly sunk in sand.", [...seg("sand", "sand surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.1], 1, 1)]) },
  { name: "a stem that says partly sunk keeps a plain ground line", doc: scene("A block sinks into the ground and comes to rest partly buried.", [...seg("ground", "ground", [0, 0], [6, 0]), ...rect("box", "block", [3, 0.1], 1, 1)]) },
  { name: "a stone in a well, below the ground line", doc: scene("A stone is dropped into a well.", [...seg("ground", "ground", [-3, 0], [3, 0]), ...disc("stone", "stone", [0, -2], 0.3), ...seg("rope", "rope", [0, 1], [0, -1.7])]) },
  { name: "a ball in a tunnel through the ground", doc: scene("A ball is dropped into a tunnel through the earth.", [...seg("ground", "ground", [-3, 0], [3, 0]), ...disc("ball", "ball", [0, 0], 0.4)]) },
  { name: "a string over a pulley clamped at the table's edge", doc: scene("A block on a table is tied over a pulley at the table's edge to a hanging mass.", [...seg("table", "table", [-4, 0], [0, 0]), ...seg("string", "vertical string", [-0.15, 0.3], [-0.15, -1.2]), ...rect("m", "hanging block", [-0.15, -1.5], 0.6, 0.6, "M")]) },
  { name: "a block across a water surface, with no stem word for it", doc: scene("A block in water.", [...seg("water", "water surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a block across a sand surface, with no stem word for it", doc: scene("A block on sand.", [...seg("sand", "sand surface", [0, 0], [6, 0]), ...rect("box", "block", [3, 0], 1, 1)]) },
  { name: "a diameter across a plane disc", doc: scene("A disc.", [...seg("xa", "diameter across the plane disc", [-3, 0], [3, 0]), ...disc("d", "uniform thin disk", [0, 0], 1.5)]) },
  { name: "a ray whose role says surface contact crosses a block", doc: scene("A block and a ray.", [...seg("ray", "surface contact geometry", [-2, 0], [2, 0]), ...rect("box", "block", [0, 0], 1, 1)]) },
  { name: "a truck's floor runs inside the truck", doc: scene("A crate rests on the floor of a truck.", [...rect("truck", "truck", [0, 0.8], 6, 2.4), ...seg("floor", "truck floor", [-3, 0], [3, 0]), ...rect("crate", "crate", [0, 0.4], 0.8, 0.8)]) },
  { name: "a gas cylinder with a piston surface", doc: scene("A gas is held in a cylinder fitted with a piston.", [...rect("cyl", "gas cylinder", [0, 0], 2, 5), ...seg("p", "piston surface", [-1, 0.5], [1, 0.5])]) },
  { name: "stacked blocks: the normal on the lower block by the upper one", doc: scene("Two stacked blocks.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("b1", "lower block", [3, 0.5], 2, 1, "M"), ...arrow("N", "normal force on lower block by upper block", [3, 1], [0, -1], "N")]) },
  { name: "a block between a floor and a ceiling with one reaction drawn", doc: scene("A block is wedged between a floor and a ceiling.", [...seg("f", "floor", [0, 0], [6, 0]), ...seg("c", "ceiling", [0, 1], [6, 1]), ...rect("box", "block", [3, 0.5], 1, 1), ...arrow("N", "normal reaction on the block", [3, 0.5], [0, 1], "N")]) },
  { name: "a cylinder in a V groove closed by a rim: the triangle is air", doc: scene("A cylinder rests in a V groove.", [...seg("l", "left inclined surface", [-3, 3], [0, 0]), ...seg("r", "right inclined surface", [0, 0], [3, 3]), ...seg("rim", "rim line", [-3, 3], [3, 3]), ...disc("c", "cylinder", [0, 1.414], 1)]) },
  { name: "a block under a shelf", doc: scene("A block hangs close under a shelf.", [...seg("s", "shelf", [0, 2], [4, 2]), ...rect("box", "block", [2, 1.5], 1, 1)]) },
  { name: "a platform on two rollers", doc: scene("A platform moves on two rollers.", [...seg("p", "platform", [0, 1], [6, 1]), ...disc("r1", "cylinder", [1.5, 0.5], 0.5), ...disc("r2", "cylinder", [4.5, 0.5], 0.5)]) },
  { name: "a ramp propped on a block", doc: scene("A ramp is propped on a wooden block.", [...seg("ramp", "ramp", [0, 0], [4.6, 2.6]), ...poly("body", "wooden block", [...UNDER])]) },
  { name: "words: a cutting plane through a sphere", doc: scene("A sphere is cut by a plane.", [...seg("c", "cutting plane", [-3, 0], [3, 0]), ...disc("s", "sphere", [0, 0], 1.5)]) },
  { name: "words: a molecular plane through a benzene ring", doc: scene("Benzene.", [...seg("m", "molecular plane", [-3, 0], [3, 0]), ...disc("r", "benzene ring", [0, 0], 1.5)]) },
  { name: "words: a periodic table row beside a box", doc: scene("The periodic table.", [...seg("t", "periodic table row", [-3, 0], [3, 0]), ...rect("b", "box", [0, 0], 1, 1)]) },
  { name: "words: a hash table row through a box", doc: scene("A hash table.", [...seg("t", "hash table row", [-3, 0], [3, 0]), ...rect("b", "box", [0, 0], 1, 1)]) },
  { name: "words: a height above the ground to a ball's centre", doc: scene("A ball above the ground.", [...seg("g", "ground", [-3, 0], [3, 0]), ...disc("b", "ball", [0, 3], 0.4), ...seg("h", "height above the ground", [0, 0], [0, 3])]) },
  { name: "words: a direction along the incline through a block", doc: scene("A block on an incline.", [...seg("d", "direction along the incline", [-3, 0], [3, 0]), ...rect("b", "block", [0, 0], 1, 1)]) },
  { name: "words: a cell body on a ground rail in a circuit", doc: scene("A circuit.", [...seg("g", "ground rail", [0, 0], [6, 0]), ...rect("c", "cell body", [3, 0], 1, 0.5)]) },
  { name: "words: a rope into a borewell, a string in a tube, a Hindi hole", doc: scene("A stone tied to a rope is lowered into a deep borewell.", [...seg("g", "ground", [-3, 0], [3, 0]), ...seg("rope", "rope", [0, 1], [0, -2]), ...disc("stone", "stone", [0, -2.3], 0.3)]) },
  { name: "words: a Hindi stem naming a hole", doc: scene("मेज़ में एक छेद है और डोरी उसमें से गुजरती है।", [...seg("t", "table", [-3, 0], [3, 0]), ...seg("str", "string", [0, 1], [0, -2]), ...rect("m", "hanging mass", [0, -2.3], 0.6, 0.6, "M")]) },
  { name: "words: an electric cable and a spinal cord are not strings", doc: scene("A cable.", [...seg("w", "table", [0, -3], [0, 3]), ...seg("c", "spinal cord", [-2, 0], [2, 0]), ...seg("e", "electric cord", [-2, 1], [2, 1])]) },
  { name: "ice with a quarter of its volume above the surface", doc: scene("An ice cube in a tumbler has a quarter of its volume above the top surface.", [...seg("s", "surface", [-3, 0], [3, 0]), ...rect("c", "ice cube", [0, -0.25], 1, 1)]) },
  { name: "a ball centred on a table's edge, leaving it", doc: scene("A ball leaves a table's edge horizontally.", [...seg("t", "table", [-4, 2], [0, 2]), ...disc("ball", "ball", [0, 2], 0.2)]) },
  { name: "a small ball centred on a launch point", doc: scene("A ball is thrown from the ground at 30 degrees.", [...seg("g", "ground", [0, 0], [10, 0]), ...disc("ball", "ball", [5, 0], 0.2)]) },
  { name: "a string to a hook just above the ceiling", doc: scene("A pendulum hangs from a hook in the ceiling.", [...seg("ceiling", "ceiling", [-2, 3], [2, 3]), ...seg("str", "string", [0, 3.2], [0, 0.6]), ...disc("bob", "bob", [0, 0.3], 0.3)]) },
  { name: "words: a line of motion on the road through two bodies", doc: scene("Two bodies move on a road.", [...seg("axis", "line of motion on the road", [0, 0], [6, 0]), ...disc("b1", "body 1", [1, 0], 0.5), ...disc("b2", "body 2", [4, 0], 0.5)]) },
  { name: "words: a tilted plane of the orbit through a bob", doc: scene("A pendulum in a tilted orbit.", [...seg("p", "tilted plane of the orbit", [-3, 0], [3, 0]), ...disc("bob", "bob", [1.5, 0], 0.4)]) },
  { name: "words: a horizontal plane through a sphere names no support", doc: scene("A plane meets a sphere.", [...seg("p", "horizontal plane", [-3, 0], [3, 0]), ...disc("s", "sphere", [0, 0], 1.5)]) },
  { name: "words: a cutting tilted plane through a sphere", doc: scene("A plane meets a sphere.", [...seg("p", "cutting tilted plane", [-3, 0], [3, 0]), ...disc("s", "sphere", [0, 0], 1.5)]) },
  { name: "words: a ground rail through a load body", doc: scene("A circuit.", [...seg("g", "ground rail", [0, 0], [6, 0]), ...rect("c", "load body", [3, 0], 1, 0.5)]) },
  { name: "words: a cell body on a ground line", doc: scene("A circuit.", [...seg("g", "ground line", [0, 0], [6, 0]), ...rect("c", "cell body", [3, 0], 1, 0.5)]) },
  { name: "words: a diameter line on the road through a wheel", doc: scene("A wheel.", [...seg("d", "diameter line on the road", [-3, 0], [3, 0]), ...disc("w", "wheel", [0, 0], 1)]) },
  { name: "words: a piston surface running past a cylinder's sides", doc: scene("A piston in a cylinder.", [...rect("cyl", "cylinder", [0, 0], 2, 5), ...seg("p", "piston surface", [-1.5, 0.5], [1.5, 0.5])]) },
  { name: "a rotated block crosses the floor's line only past the floor's end", doc: scene("A block beyond the end of a floor.", [...seg("floor", "floor", [0, 0], [1, 0]), ...poly("body", "block", [[0.5, 2], [1, 2.2], [2.2, -0.8], [1.7, -1]])]) },
  { name: "a hanging block's corner near only the wedge's extended line", doc: scene("A block on an incline is joined over a pulley to a hanging block.", [...seg("incline", "inclined plane", [0, 0], [3, 3]), ...rect("m", "hanging block", [3.7, 2.8], 0.8, 0.8, "M")]) },
  { name: "a wide block on a short shelf from above", doc: scene("A block rests on a short shelf.", [...seg("s", "shelf", [2, 0], [3, 0]), ...rect("box", "block", [2.5, 0.5], 4, 1)]) },
  { name: "panels: a ball on its own ground, against the other panel's floor", doc: grouped("Two cases: a box rests on a floor, and a ball rests on the ground.", { first: [...seg("f", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0.5], 1, 1), link("l1", "f_a", "box_c")], second: [...seg("g", "ground", [0, -0.6], [6, -0.6]), ...disc("b", "ball", [3, 0], 0.6), link("l2", "g_a", "b_c")] }) },
  { name: "panels: a bob's string, against the other panel's floor", doc: grouped("Two cases: a box rests on a floor, and a bob hangs on a string from a ceiling.", { first: [...seg("f", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, 0.5], 1, 1), link("l1", "f_a", "box_c")], second: [...seg("c", "ceiling", [1, 2], [5, 2]), ...seg("str", "string", [3, 2], [3, -1.5]), ...disc("b", "bob", [3, -1.8], 0.3), link("l2", "c_a", "str_a"), link("l3", "str_b", "b_c")] }) },
  { name: "another subject: an amplifier block on a ground line", doc: scene("Draw the amplifier.", [...seg("g", "ground line", [0, 0], [6, 0]), ...rect("a", "amplifier block", [3, 0], 2, 1)]) },
  { name: "another subject: a data bus through a table row", doc: scene("Draw the memory layout.", [...seg("t", "table", [0, 0], [6, 0]), ...rect("b", "data bus", [3, 0], 2, 1)]) },
  { name: "another subject: an ore body across the ground", doc: scene("Draw the mine section.", [...seg("g", "ground", [0, 0], [6, 0]), ...rect("o", "ore body", [3, 0], 2, 1)]) },
  { name: "a ring on a rail is threaded on it", doc: scene("A ring slides on a smooth rail.", [...seg("r", "rail", [0, 0], [6, 0]), ...disc("ring", "ring", [3, 0], 0.4)]) },
  { name: "a road edge beside a car in a top view", doc: scene("A car turns at speed, top view.", [...seg("e", "road", [0, 0], [6, 0]), ...rect("c", "car", [3, 0], 1, 2)]) },
  { name: "a cube cut by an inclined plane", doc: scene("An inclined plane cuts a cube.", [...seg("p", "inclined plane", [0, 0], [4, 3]), ...rect("c", "cube", [2, 1.5], 2, 2)]) },
  { name: "a box between two floors", doc: scene("A box rests between two floors.", [...seg("f1", "floor", [0, 0], [6, 0]), ...seg("f2", "floor", [0, 1], [6, 1]), ...rect("b", "box", [3, 0.5], 1, 1)]) },
  { name: "a car under a ramp", doc: scene("A car moves at speed under a ramp.", [...seg("r", "ramp", [0, 2], [6, 3]), ...rect("c", "car", [3, 2], 1, 0.98)]) },
  { name: "Hindi and Hinglish stems naming a well or floating", doc: scene("कुएं में एक डोरी से बंधा पत्थर है, और ball floating hai", [...seg("g", "ground", [-4, 0], [4, 0]), ...seg("str", "string", [0, 1], [0, -2]), ...disc("s", "stone", [0, 0], 0.5)]) },
  { name: "a stem saying the string passes through the table", doc: scene("The string passes through the table to a hanging mass.", [...seg("t", "table", [-4, 0], [4, 0]), ...seg("str", "string", [0, 1], [0, -2]), ...rect("m", "hanging mass", [0, -2.3], 0.6, 0.6, "M")]) },
  { name: "a road edge through a car", doc: scene("A car moves at speed along a road.", [...seg("e", "road edge", [0, 0], [8, 0]), ...rect("car", "car", [4, 0], 2, 1)]) },
  { name: "a hanging block just past the wedge's top: its near corner is past the drawn line", doc: scene("A block on an incline is joined over a pulley at the top to a hanging block.", [...seg("incline", "inclined plane", [0, 0], [4.6, 2.6]), ...seg("ground", "ground", [0, 0], [4.6, 0]), ...seg("rise", "vertical side", [4.6, 0], [4.6, 2.6]), ...rect("h", "hanging block", [5.1, 2.2], 0.8, 0.8, "M")]) },
  { name: "a box well clear under a floor is not touching it", doc: scene("A box hangs far below a floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("box", "box", [3, -1.5], 1, 1)]) },
  { name: "a table has a free underside: a box flush under it", doc: scene("A force holds a box to a table.", [...seg("t", "table", [0, 0], [6, 0]), ...rect("box", "box", [3, -0.5], 1, 1)]) },
  { name: "a near vertical slope says nothing about which side is free", doc: scene("A force holds a block to a steep slope.", [...seg("s", "slope", [0, 0], [0.3, 4]), ...poly("body", "block", [[0.075, 1], [0.225, 3], [1.222, 2.925], [1.072, 0.925]])]) },
  { name: "a role naming the hole lets a string through the table", doc: scene("Block A on a table is tied by a string to a hanging mass.", [{ id: "hole", role: "hole in the table", kind: "point", at: [0, 0] }, ...seg("t", "table", [-4, 0], [4, 0]), ...seg("str", "string", [0, 1], [0, -2]), ...rect("m", "hanging mass", [0, -2.3], 0.6, 0.6, "M")]) },
  { name: "words: a mirror surface through an object", doc: scene("An object and a mirror.", [...seg("m", "mirror surface", [-3, 0], [3, 0]), ...rect("o", "object", [0, 0], 1, 1)]) },
  { name: "words: a rod on the table through a block", doc: scene("A rod and a block.", [...seg("r", "rod on the table", [-3, 0], [3, 0]), ...rect("b", "block", [0, 0], 1, 1)]) },
  { name: "words: an entry surface through a glass block", doc: scene("A ray enters a glass block.", [...seg("s", "entry surface", [-2, 0], [2, 0]), ...rect("g", "glass block", [0, 0], 1, 1)]) },
  { name: "a dot marking a particle on a long slope", doc: scene("A particle on an incline.", [...seg("slope", "slope", [0, 0], [40, 30]), ...disc("p", "particle", [20, 15], 0.3)]) },
  { name: "ball in flight above the ground", doc: scene("A projectile.", [...seg("ground", "ground", [0, 0], [10, 0]), ...disc("ball", "ball", [5, 3], 0.3)]) },
  { name: "the axis of motion through two bodies is not a surface", doc: scene("Two bodies collide.", [...seg("axis", "line of motion", [0, 0], [6, 0]), ...disc("b1", "body 1", [1, 0], 0.5), ...disc("b2", "body 2", [4, 0], 0.5)]) },
  { name: "a block on another block is not a surface", doc: scene("Two blocks.", [...seg("floor", "floor", [0, 0], [6, 0]), ...rect("b1", "lower block", [3, 0.5], 2, 1, "M"), ...rect("b2", "upper block", [3, 1.5], 1, 1, "m")]) },
  { name: "ground state level across an electron orbit is not a surface", doc: scene("An atom.", [...seg("g", "ground state energy level", [0, 0], [6, 0]), ...disc("o", "electron shell ring", [3, 0], 1)]) },
];

const CODES = new Set(["body_straddles_surface", "body_inside_surface", "string_through_surface"]);
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
// A figure with no mechanics in it stays silent before any word is read, so a keep row proves nothing unless it also holds
// with that evidence present. The other subject rows are about the silence itself.
const withEvidence = (doc: Doc): Doc => {
  const source = (doc as { source: { question: string } }).source;
  return { ...doc, source: { ...source, question: `${source.question} A force acts.` } };
};
for (const row of keep) {
  for (const doc of row.name.startsWith("another subject") ? [row.doc] : [row.doc, withEvidence(row.doc)]) {
    const hits = codesOf(doc).filter((code) => CODES.has(code));
    if (hits.length === 0) passed += 1;
    else failures.push(`KEEP ${row.name}${doc === row.doc ? "" : " (with evidence)"}: refused with ${hits.join(",")}`);
  }
}
// A saved board compiles without admission options, so an old figure still reopens. Every refuse row is one.
for (const row of refuse) {
  if (!codesOf(row.doc).includes(row.code)) continue;
  const reopened = compileSceneDocument(row.doc as never).report.issues.filter((issue) => CODES.has(issue.code));
  if (reopened.length) failures.push(`SAVED BOARD ${row.name}: a compile without admission options was refused with ${reopened.map((issue) => issue.code).join(",")}`);
  else passed += 1;
}
// A refusing check must not throw on a large outline.
try {
  const many = Array.from({ length: 500 }, (_, i): Xy => [3 + Math.cos((i * 2 * Math.PI) / 500), 1.2 + Math.sin((i * 2 * Math.PI) / 500)]);
  compileSceneDocument(scene("A block rests on the floor.", [...seg("floor", "floor", [0, 0], [6, 0]), ...poly("body", "block", many)]) as never, { figureConsistency: true });
  passed += 1;
} catch (error) {
  failures.push(`LARGE OUTLINE threw: ${String(error).slice(0, 100)}`);
}
for (const failure of failures) console.error(failure);
console.log(`verify-contact-truth: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
