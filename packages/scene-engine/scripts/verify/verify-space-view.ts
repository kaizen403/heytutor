/**
 * Space view gate (G1 to G16 of .context/h4/3d/DESIGN.md section 8).
 *
 * G15 guards byte identity: every frozen document without a space_frame
 * (golden and regression fixtures, the evaluation compile probes, the physics
 * evaluation probes, and synthesized polyhedral solids) must render exactly as
 * it did on the base commit. `--record-byte-identity` rewrites the fixture and
 * is only ever run on the base commit.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument, synthesizeFamilyScene, validateSceneDocument, type SceneDocument } from "../../src/index";
import { EVALUATION_COMPILE_PROBES } from "../probes/evaluationCompileProbes";
import { PHYSICS_EVALUATION_COMPILE_PROBES } from "../probes/evaluationPhysicsProbes";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "../..");
const identityFixture = join(here, "fixtures/space-view-byte-identity.json");

let failures = 0;
const results: string[] = [];
function gate(name: string, run: () => string | null): void {
  let failure: string | null;
  try { failure = run(); } catch (error) { failure = `threw ${error instanceof Error ? error.message : String(error)}`; }
  if (failure) { failures += 1; results.push(`FAIL ${name}: ${failure}`); } else results.push(`ok   ${name}`);
}

// ---------- G15: byte identity of every document without a space_frame ----------
interface IdentityFixture { schema: "space-view-byte-identity/v1"; baseCommit: string; documents: Record<string, unknown>; hashes: Record<string, string> }

function hasSpaceFrame(document: unknown): boolean {
  const constructions = (document as { constructions?: unknown }).constructions;
  return Array.isArray(constructions) && constructions.some((construction) => (construction as { operator?: unknown })?.operator === "space_frame");
}
function sceneDocumentsIn(value: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) { value.forEach((item, index) => sceneDocumentsIn(item, `${path}[${index}]`, out)); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === "scene-document/v2" && Array.isArray(record.constructions)) { out.set(path, record); return; }
  for (const [key, child] of Object.entries(record)) sceneDocumentsIn(child, `${path}.${key}`, out);
}
function jsonFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsonFiles(path) : path.endsWith(".json") ? [path] : [];
  });
}
/** Synthetic solids in the mensuration family's own phrasing; none is a held-out question. */
const POLYHEDRAL_STEMS = [
  "A cube has edge 7 cm. Find its total surface area.",
  "A cuboid has length 9 cm, width 4 cm and height 2 cm. Find its volume.",
  "A square pyramid has base side 8 cm and height 3 cm. Find its volume.",
  "A regular pentagonal prism has base side 3 cm and height 7 cm. Find its volume.",
  "A right triangular prism has base 5 cm, base height 12 cm and length 9 cm. Find its volume.",
  "A regular hexagonal pyramid has base side 2 cm and height 6 cm. Find its volume.",
];
function collectIdentityDocuments(): Map<string, unknown> {
  const documents = new Map<string, unknown>();
  for (const file of [...jsonFiles(join(packageRoot, "fixtures/golden")), ...jsonFiles(join(packageRoot, "fixtures/regression")), ...jsonFiles(join(packageRoot, "fixtures/evaluation"))]) {
    sceneDocumentsIn(JSON.parse(readFileSync(file, "utf8")), relative(packageRoot, file), documents);
  }
  for (const [id, document] of Object.entries(EVALUATION_COMPILE_PROBES)) documents.set(`probe:${id}`, document);
  for (const [id, document] of Object.entries(PHYSICS_EVALUATION_COMPILE_PROBES)) documents.set(`physics-probe:${id}`, document);
  for (const stem of POLYHEDRAL_STEMS) {
    const synthesized = synthesizeFamilyScene({ question: stem, problemIR: { entities: [{ id: "body", kind: "solid" }] } });
    if (!synthesized?.document.constructions.some((construction) => construction.operator === "solid_projection" && construction.inputs.kind === "polyhedron")) {
      throw new Error(`no polyhedral solid for "${stem}"`);
    }
    documents.set(`polyhedral:${stem}`, synthesized.document);
  }
  for (const id of [...documents.keys()]) if (hasSpaceFrame(documents.get(id))) documents.delete(id);
  return documents;
}
function renderHash(document: unknown): string {
  const validated = validateSceneDocument(structuredClone(document));
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  return createHash("sha256").update(JSON.stringify(compiled?.renderScene ?? null)).digest("hex");
}

if (process.argv.includes("--record-byte-identity")) {
  const documents = collectIdentityDocuments();
  const baseCommit = process.argv[process.argv.indexOf("--record-byte-identity") + 1] ?? "unknown";
  const fixture: IdentityFixture = { schema: "space-view-byte-identity/v1", baseCommit, documents: {}, hashes: {} };
  for (const [id, document] of documents) { fixture.documents[id] = document; fixture.hashes[id] = renderHash(document); }
  writeFileSync(identityFixture, `${JSON.stringify(fixture)}\n`);
  console.log(`recorded ${documents.size} byte identity hashes at ${baseCommit}`);
  process.exit(0);
}

gate("G15 byte identity of documents without a space_frame", () => {
  const fixture = JSON.parse(readFileSync(identityFixture, "utf8")) as IdentityFixture;
  const ids = Object.keys(fixture.hashes);
  if (ids.length < 30) return `only ${ids.length} frozen documents`;
  const polyhedral = ids.filter((id) => id.startsWith("polyhedral:"));
  if (polyhedral.length !== POLYHEDRAL_STEMS.length) return `expected ${POLYHEDRAL_STEMS.length} polyhedral solids, found ${polyhedral.length}`;
  const changed = ids.filter((id) => hasSpaceFrame(fixture.documents[id]) || renderHash(fixture.documents[id]) !== fixture.hashes[id]);
  return changed.length ? `${changed.length} of ${ids.length} renders changed: ${changed.slice(0, 6).join(", ")}` : null;
});

for (const line of results) console.log(line);
if (failures > 0) {
  console.error(`verify-space-view: ${failures} gate(s) failed`);
  process.exit(1);
}
console.log(`verify-space-view: ${results.length} gates passed`);
