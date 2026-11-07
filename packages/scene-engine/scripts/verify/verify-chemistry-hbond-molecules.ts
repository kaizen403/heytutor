/**
 * The hydrogen bond figure draws whole molecules, with the hydrogens the formula
 * gives, near linear at H. It used to draw one O-H under the label H2O. It draws on
 * exactly the stems it drew before: a false ask such as ammonia in water is a known
 * open item, and this gate pins that the fix did not move it either way.
 *
 *   tsx --tsconfig ../../apps/tutor/tsconfig.json scripts/verify/verify-chemistry-hbond-molecules.ts
 */
import assert from "node:assert/strict";
import "../../src/chemistry/families";
import { buildLewisScene } from "../../src/chemistry/lewis";
import { parseFormula } from "../../src/chemistry/formula";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixture from "./fixtures/chemistry-hbond-subset.json";

let failed = 0;
let passed = 0;
function check(id: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Point = { x: number; y: number };

function pointOf(document: SceneDocument, id: string): Point {
  const construction = document.constructions.find((value) => value.outputs.includes(id));
  assert.ok(construction, `no construction for ${id}`);
  if (construction.operator === "label") return pointOf(document, String(construction.inputs.target));
  assert.equal(construction.operator, "point", `${id} is not a point`);
  return { x: Number(construction.inputs.x), y: Number(construction.inputs.y) };
}

const labelOf = (document: SceneDocument, id: string) => document.entities.find((entity) => entity.id === id)?.label;
const atomsOf = (document: SceneDocument, symbol: string) => document.entities.filter((entity) => entity.label === symbol).map((entity) => entity.id);
const roleOf = (document: SceneDocument, id: string) => String(document.entities.find((entity) => entity.id === id)?.role ?? "");
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The angle at `vertex`, in degrees, as drawn on the page. */
function angleAt(vertex: Point, a: Point, b: Point): number {
  const raw = Math.abs(Math.atan2(a.y - vertex.y, a.x - vertex.x) - Math.atan2(b.y - vertex.y, b.x - vertex.x)) * 180 / Math.PI;
  return raw > 180 ? 360 - raw : raw;
}

/** The hydrogens on one heavy atom and their bonds, by the ids the figure gives them. */
function moleculeHydrogens(document: SceneDocument, prefix: "a" | "b"): Array<{ hydrogen: string; bond: string }> {
  const rows: Array<{ hydrogen: string; bond: string }> = [];
  for (const entity of document.entities) {
    const match = new RegExp(`^${prefix}_h(\\d*)$`).exec(entity.id);
    if (match && entity.label === "H") rows.push({ hydrogen: entity.id, bond: `${prefix}_b${match[1]}` });
  }
  return rows;
}

const WATER = { formula: "H2O", heavy: "O", label: "H_2O" };
const AMMONIA = { formula: "NH3", heavy: "N", label: "NH_3" };
const HF = { formula: "HF", heavy: "F", label: "HF" };
const DRAWS: ReadonlyArray<{ question: string; formula: string; heavy: string; label: string }> = [
  { question: "hydrogen bonding in water", ...WATER },
  { question: "Draw the hydrogen bond between two water molecules.", ...WATER },
  { question: "show hydrogen bonding in H2O", ...WATER },
  { question: "show hydrogen bonding in H₂O", ...WATER },
  { question: "hydrogen bonding in ammonia", ...AMMONIA },
  { question: "Draw hydrogen bonds between NH3 molecules.", ...AMMONIA },
  { question: "Show the intermolecular hydrogen bond in ammonia.", ...AMMONIA },
  { question: "hydrogen bonding in HF", ...HF },
  { question: "Show the intermolecular hydrogen bond in hydrogen fluoride.", ...HF },
];

for (const row of DRAWS) {
  const document = buildLewisScene(row.question, [], false);
  const expected = parseFormula(row.formula)?.atoms.find((atom) => atom.symbol === "H")?.count ?? 0;
  check(`draws: ${row.question}`, () => assert.ok(document, "declined"));
  if (!document) continue;
  check(`hydrogens from the formula: ${row.question}`, () => {
    assert.equal(atomsOf(document, "H").length, expected * 2, `${atomsOf(document, "H").length} H drawn for two ${row.formula}`);
    assert.equal(labelOf(document, "a_x"), row.heavy);
    assert.equal(labelOf(document, "b_x"), row.heavy);
    for (const [prefix, heavy] of [["a", "a_x"], ["b", "b_x"]] as const) {
      const hydrogens = moleculeHydrogens(document, prefix);
      assert.equal(hydrogens.length, expected, `${prefix} molecule has ${hydrogens.length} H`);
      for (const { hydrogen, bond } of hydrogens) {
        assert.ok(roleOf(document, bond).includes(`${row.heavy}-H bond`), `${bond} is not a covalent bond`);
        const foreshortened = roleOf(document, bond).includes("dash");
        const length = distance(pointOf(document, heavy), pointOf(document, hydrogen));
        assert.ok(length > (foreshortened ? 0.7 : 1) && length < 1.25, `${hydrogen} is ${length.toFixed(2)} from ${heavy}`);
      }
    }
  });
  check(`the hydrogen bond is dashed, not covalent, and near linear at H: ${row.question}`, () => {
    const link = document.entities.find((entity) => entity.id === "hb");
    assert.ok(link && link.provenance?.dashed === true, "dashed link");
    const [donor, hydrogen, acceptor] = ["a_x", "a_h", "b_x"].map((id) => pointOf(document, id));
    assert.ok(angleAt(hydrogen!, donor!, acceptor!) > 170, "bent at H");
    assert.ok(distance(hydrogen!, acceptor!) > distance(donor!, hydrogen!), "shorter than the covalent bond");
  });
  check(`no two atoms collide: ${row.question}`, () => {
    const atoms = [...atomsOf(document, "H"), "a_x", "b_x"].map((id) => pointOf(document, id));
    for (let i = 0; i < atoms.length; i += 1) for (let j = i + 1; j < atoms.length; j += 1) {
      assert.ok(distance(atoms[i]!, atoms[j]!) > 0.8, `atoms ${i} and ${j} are ${distance(atoms[i]!, atoms[j]!).toFixed(2)} apart`);
    }
  });
  check(`compiles and names the bond and the species: ${row.question}`, () => {
    const compiled = compileSceneDocument(document);
    const labels = compiled.renderScene.primitives.filter((p) => p.kind === "label" && p.text).map((p) => p.text);
    assert.ok(labels.includes(row.label), `no ${row.label} label`);
    assert.ok(labels.includes("hydrogen bond"), "no hydrogen bond label");
    assert.ok(!compiled.report.issues.some((issue) => issue.severity === "fatal"), "fatal compile issue");
  });
}

// Each species has the shape it really has. Read from the geometry and the bond marks.
const water = buildLewisScene("hydrogen bonding in water", [], false)!;
const ammonia = buildLewisScene("hydrogen bonding in ammonia", [], false)!;
const hf = buildLewisScene("hydrogen bonding in HF", [], false)!;
check("water is bent on both molecules", () => {
  for (const [centre, first, second] of [["a_x", "a_h", "a_h2"], ["b_x", "b_h", "b_h2"]] as const) {
    const inner = angleAt(pointOf(water, centre), pointOf(water, first), pointOf(water, second));
    assert.ok(inner > 95 && inner < 115, `${centre} H-O-H is ${inner.toFixed(1)} degrees`);
  }
});
check("water's acceptor takes the bond between its two hydrogens", () => {
  const o = pointOf(water, "b_x");
  const first = angleAt(o, pointOf(water, "a_h"), pointOf(water, "b_h"));
  const second = angleAt(o, pointOf(water, "a_h"), pointOf(water, "b_h2"));
  assert.ok(Math.abs(first - second) < 3, `${first.toFixed(1)} against ${second.toFixed(1)}`);
});
check("ammonia is marked as a pyramid on both molecules, never flat or T shaped", () => {
  for (const [prefix, centre] of [["a", "a_x"], ["b", "b_x"]] as const) {
    const hydrogens = moleculeHydrogens(ammonia, prefix);
    const roles = hydrogens.map(({ bond }) => roleOf(ammonia, bond));
    assert.equal(roles.filter((role) => role.includes("wedge")).length, 1, `${prefix} wedge`);
    assert.equal(roles.filter((role) => role.includes("dash")).length, 1, `${prefix} dash`);
    const points = hydrogens.map(({ hydrogen }) => pointOf(ammonia, hydrogen));
    for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
      assert.ok(angleAt(pointOf(ammonia, centre), points[i]!, points[j]!) < 170, `${prefix} has a straight H-N-H`);
    }
  }
});
check("ammonia's wedge and dash sit on the same side of its plain bond, as a tripod", () => {
  for (const [prefix, centre] of [["a", "a_x"], ["b", "b_x"]] as const) {
    const hydrogens = moleculeHydrogens(ammonia, prefix);
    const n = pointOf(ammonia, centre);
    const byMark = (mark: string) => hydrogens.find(({ bond }) => roleOf(ammonia, bond).includes(mark))!;
    const plain = hydrogens.find(({ bond }) => !/wedge|dash/.test(roleOf(ammonia, bond)))!;
    const toPlain = pointOf(ammonia, plain.hydrogen);
    const side = (hydrogen: string) => {
      const at = pointOf(ammonia, hydrogen);
      return Math.sign((toPlain.x - n.x) * (at.y - n.y) - (toPlain.y - n.y) * (at.x - n.x));
    };
    assert.equal(side(byMark("wedge").hydrogen), side(byMark("dash").hydrogen), `${prefix} straddles its plain bond`);
  }
});
check("ammonia's lone pair side faces the donor", () => {
  const n = pointOf(ammonia, "b_x");
  const donorSide = pointOf(ammonia, "a_h");
  for (const { hydrogen } of moleculeHydrogens(ammonia, "b")) {
    assert.ok(angleAt(n, donorSide, pointOf(ammonia, hydrogen)) > 100, `${hydrogen} crowds the hydrogen bond`);
  }
});
check("HF zigzags at the acceptor", () => {
  const inner = angleAt(pointOf(hf, "b_x"), pointOf(hf, "a_h"), pointOf(hf, "b_h"));
  assert.ok(inner > 100 && inner < 140, `H-F...H is ${inner.toFixed(1)} degrees`);
});

// The drawn hydrogen bond, measured on the compiled board in px: the dashes run between
// the two molecules and strike no letter, and the label beside them names them.
type Box = { x: number; y: number; width: number; height: number };
type Primitive = { kind: string; entityId?: string; text?: string; points?: Point[]; provenance?: { labelBounds?: Box } };

function pointToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Distance in px from a segment to a box, 0 when the segment enters it. */
function segmentToBox(a: Point, b: Point, box: Box): number {
  const inside = (p: Point) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
  const corners = [
    { x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height },
  ];
  for (let step = 0; step <= 200; step += 1) {
    if (inside({ x: a.x + (b.x - a.x) * step / 200, y: a.y + (b.y - a.y) * step / 200 })) return 0;
  }
  const toBox = (p: Point) => Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.width), Math.max(box.y - p.y, 0, p.y - box.y - box.height));
  return Math.min(toBox(a), toBox(b), ...corners.map((corner) => pointToSegment(corner, a, b)));
}

for (const [name, document] of [["water", water], ["ammonia", ammonia], ["HF", hf]] as const) {
  const primitives = (compileSceneDocument(document).renderScene?.primitives ?? []) as unknown as Primitive[];
  const link = primitives.find((p) => p.kind === "line" && p.entityId === "hb");
  const labels = primitives.filter((p) => p.kind === "label" && p.provenance?.labelBounds);
  const box = (entityId: string) => labels.find((p) => p.entityId === entityId)?.provenance?.labelBounds;
  const centre = (value: Box) => ({ x: value.x + value.width / 2, y: value.y + value.height / 2 });
  check(`${name}: the hydrogen bond's dashes strike no letter or label`, () => {
    assert.ok(link?.points?.length === 2, "no hydrogen bond line");
    const [a, b] = link.points;
    for (const label of labels) {
      const gap = segmentToBox(a!, b!, label.provenance!.labelBounds!);
      assert.ok(gap > 4, `${label.text} is ${gap.toFixed(1)} px from the dashes`);
    }
  });
  check(`${name}: the hydrogen bond spans the gap from H to the acceptor, not a stub`, () => {
    assert.ok(link?.points?.length === 2, "no hydrogen bond line");
    const [a, b] = link.points;
    const hydrogen = box("a_h");
    const acceptor = box("b_x");
    assert.ok(hydrogen && acceptor, "no donor H or acceptor label");
    const gap = distance(centre(hydrogen), centre(acceptor));
    assert.ok(distance(a!, b!) > 0.5 * gap, `dashes are ${distance(a!, b!).toFixed(1)} px of a ${gap.toFixed(1)} px gap`);
    for (const end of [a!, b!]) {
      assert.ok(pointToSegment(end, centre(hydrogen), centre(acceptor)) < 6, "dashes leave the line from H to the acceptor");
    }
  });
  check(`${name}: the hydrogen bond label sits beside its dashes`, () => {
    assert.ok(link?.points?.length === 2, "no hydrogen bond line");
    const [a, b] = link.points;
    const kind = box("kind");
    assert.ok(kind, "no hydrogen bond label");
    const at = centre(kind);
    assert.ok(at.x > Math.min(a!.x, b!.x) && at.x < Math.max(a!.x, b!.x), "label is not alongside the dashes");
    assert.ok(pointToSegment(at, a!, b!) < 140, `label is ${pointToSegment(at, a!, b!).toFixed(1)} px from the dashes`);
  });
  check(`${name}: every acceptor hydrogen points away from the donor`, () => {
    const acceptor = pointOf(document, "b_x");
    const donor = pointOf(document, "a_h");
    for (const { hydrogen } of moleculeHydrogens(document, "b")) {
      assert.ok(angleAt(acceptor, donor, pointOf(document, hydrogen)) > 100, `${hydrogen} points at the donor`);
    }
  });
}

// The fix moves no stem: on each fixture row head draws the family dev draws, including none.
for (const [question, devFamily] of fixture.rows as Array<[string, string | null]>) {
  const family = (synthesizeFamilyScene({ question }) ?? synthesizeLastResortScene({ question }))?.family ?? null;
  check(`same as dev: ${question}`, () => assert.equal(family, devFamily, `head draws ${family}, dev drew ${devFamily}`));
}

console.log(`verify-chemistry-hbond-molecules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
