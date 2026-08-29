/**
 * How the engine behaves on TYPED questions.
 *
 * Every other coverage number in this repo is measured on scanned exam text
 * with heavy OCR damage — lost exponents, symbolic coefficients, bilingual
 * transliteration. A student types a clean question, so those numbers do not
 * answer "does it handle whatever I put in". This corpus does.
 *
 * It is a measuring instrument first. Family and picture-class expectations are
 * reported as a work list rather than enforced, because a gate that fails on
 * the day it lands gets disabled. Exactly one thing is a hard error: a question
 * whose honest answer is text-only that nevertheless drew ink. That is the
 * engine inventing a picture, which is the one failure this project treats as
 * worse than drawing nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities.ts";
import {
  synthesizeFamilyScene,
  synthesizeLastResortScene,
} from "../../src/synthesize/familyScene.ts";
import type { SceneDocument } from "../../src/types.ts";

interface TypedEntry {
  id: string;
  unit: string;
  question: string;
  expectedFamily: string | null;
  expectedPictureClass: string | null;
  expectsDiagram: boolean;
  note?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = ["typed-maths-v1.json", "typed-physics-v1.json"];

const entries: TypedEntry[] = [];
for (const name of fixtures) {
  const path = resolve(here, "../../fixtures/evaluation", name);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { questions?: TypedEntry[] };
    entries.push(...(parsed.questions ?? []));
  } catch {
    console.log(`verify-typed-corpus: ${name} not present yet; skipping it`);
  }
}
if (entries.length === 0) {
  throw new Error("verify-typed-corpus: no typed fixtures loaded; the gate would pass vacuously");
}

/** Same reading the bank harness uses, kept deliberately coarse. */
function pictureClassOf(document: SceneDocument | null): string {
  if (!document) return "none";
  const operators = new Set(document.constructions.map((construction) => construction.operator));
  if (operators.has("space_frame")) return "space_3d";
  if (operators.has("constraint_region")) return "constraint_region";
  if (operators.has("function_region")) return "function_region";
  if (operators.has("implicit_curve")) return "implicit_conic";
  if (operators.has("circle")) return "circle_figure";
  if (operators.has("optical_train")) return "instrument_chain";
  if (operators.has("function_curve")) return "function_curves";
  if (operators.has("symbol")) return "circuit";
  if (operators.has("vector")) return "vector_diagram";
  return "other";
}

interface Row {
  entry: TypedEntry;
  drew: boolean;
  family: string;
  pictureClass: string;
  tier: string;
}

const rows: Row[] = entries.map((entry) => {
  const families = inferSceneCapabilities(entry.question).families;
  const exact = synthesizeFamilyScene({ question: entry.question, families });
  const scene = exact ?? synthesizeLastResortScene({ question: entry.question, families });
  const primitives = scene?.renderScene.primitives.length ?? 0;
  const drew = Boolean(scene) && scene!.document.visualDecision.mode === "scene" && primitives > 0;
  return {
    entry,
    drew,
    family: scene?.family ?? "none",
    pictureClass: pictureClassOf(drew ? scene!.document : null),
    tier: scene?.tier ?? "none",
  };
});

const wanted = rows.filter((row) => row.entry.expectsDiagram);
const textOnly = rows.filter((row) => !row.entry.expectsDiagram);
const drewWhenWanted = wanted.filter((row) => row.drew);
const invented = textOnly.filter((row) => row.drew);
const familyMatch = drewWhenWanted.filter((row) =>
  row.entry.expectedFamily === null || row.entry.expectedFamily === row.family);
const classMatch = drewWhenWanted.filter((row) =>
  row.entry.expectedPictureClass === null || row.entry.expectedPictureClass === row.pictureClass);

console.log("verify-typed-corpus: typed-input behaviour");
console.log(
  `  entries=${rows.length} diagram-expected=${wanted.length} drew=${drewWhenWanted.length}`
    + ` family-match=${familyMatch.length} class-match=${classMatch.length}`
    + ` text-only-expected=${textOnly.length} invented=${invented.length}`,
);

const byUnit = new Map<string, { total: number; wanted: number; drew: number; classMatch: number }>();
for (const row of rows) {
  const stats = byUnit.get(row.entry.unit) ?? { total: 0, wanted: 0, drew: 0, classMatch: 0 };
  stats.total += 1;
  if (row.entry.expectsDiagram) {
    stats.wanted += 1;
    if (row.drew) stats.drew += 1;
    if (row.drew && (row.entry.expectedPictureClass === null
      || row.entry.expectedPictureClass === row.pictureClass)) stats.classMatch += 1;
  }
  byUnit.set(row.entry.unit, stats);
}
for (const [unit, stats] of [...byUnit.entries()].sort()) {
  console.log(
    `  ${unit.padEnd(38)} entries=${String(stats.total).padStart(3)}`
      + ` wanted=${String(stats.wanted).padStart(3)} drew=${String(stats.drew).padStart(3)}`
      + ` right-picture=${String(stats.classMatch).padStart(3)}`,
  );
}

const blind = wanted.filter((row) => !row.drew);
if (blind.length > 0) {
  console.log(`  -- drew nothing though a figure is expected (${blind.length}) --`);
  for (const row of blind) console.log(`     ${row.entry.id}  ${row.entry.question.slice(0, 88)}`);
}
const wrongClass = drewWhenWanted.filter((row) =>
  row.entry.expectedPictureClass !== null && row.entry.expectedPictureClass !== row.pictureClass);
if (wrongClass.length > 0) {
  console.log(`  -- drew a different picture class than expected (${wrongClass.length}) --`);
  for (const row of wrongClass) {
    console.log(`     ${row.entry.id}  want=${row.entry.expectedPictureClass} got=${row.pictureClass} (${row.family})`);
  }
}

// The one hard invariant: never invent a figure for a question that has none.
if (invented.length > 0) {
  console.log("verify-typed-corpus: INVENTED-PICTURE GATE FAILED");
  for (const row of invented) {
    console.log(`  ${row.entry.id} drew ${row.pictureClass} via ${row.family} — ${row.entry.note ?? ""}`);
    console.log(`    ${row.entry.question.slice(0, 110)}`);
  }
  process.exitCode = 1;
} else {
  console.log("verify-typed-corpus: no picture was invented for a text-only question");
}
