/**
 * Archetype picture gate.
 *
 * For every probe in `scripts/probes/archetypeProbes.ts`:
 *   - the detector must choose the expected archetype (or decline);
 *   - phrasing variants in one group must agree;
 *   - a generated document must pass its picture contract, validate, compile,
 *     survive sceneDemand, and reach at least the expected tier.
 *
 * Pass `--render <dir>` to also write one SVG per probe and contact sheets,
 * so a reviewer can look at every figure the gate accepted.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-archetype-pictures.ts
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-archetype-pictures.ts --render /tmp/archetypes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { attemptArchetypeScene } from "../../src/archetypes";
import { implementedArchetypes } from "../../src/archetypes/generators";
import { contactSheetSvg, renderSceneSvg } from "../lib/renderSceneSvg";
import { ARCHETYPE_PROBES, type TierFloor } from "../probes/archetypeProbes";

const TIER_RANK: Record<string, number> = { question_representation: 0, qualitative_verified: 1, exact_verified: 2 };

const renderFlag = process.argv.indexOf("--render");
const renderDir = renderFlag >= 0 ? resolve(process.argv[renderFlag + 1] ?? "archetype-pictures") : null;
if (renderDir) mkdirSync(renderDir, { recursive: true });

const failures: string[] = [];
const groups = new Map<string, Set<string>>();
const cells: Array<{ scene: Parameters<typeof renderSceneSvg>[0]; title: string; subtitle: string }> = [];
let scenes = 0;
let exact = 0;

for (const probe of ARCHETYPE_PROBES) {
  const attempt = attemptArchetypeScene({ question: probe.question });
  const detected = attempt.match?.id ?? null;
  if (probe.group) {
    const set = groups.get(probe.group) ?? new Set<string>();
    set.add(detected ?? "—");
    groups.set(probe.group, set);
  }
  if (detected !== probe.archetype) {
    failures.push(`${probe.id}: detected ${detected ?? "nothing"}, expected ${probe.archetype ?? "no archetype"}`);
    continue;
  }
  if (probe.archetype === null) continue;
  if (probe.detectOnly) continue;
  if (probe.declines) {
    if (attempt.scene) failures.push(`${probe.id}: ${probe.archetype} must decline this stem but produced a scene`);
    continue;
  }
  const scene = attempt.scene;
  if (!scene) {
    const issues = (attempt.issues ?? []).slice(0, 3).map((issue) => `${issue.code}: ${issue.message}`).join(" | ");
    failures.push(`${probe.id}: ${probe.archetype} produced no scene (${attempt.declined ?? "unknown"}) ${issues}`);
    continue;
  }
  scenes += 1;
  if (scene.tier === "exact_verified") exact += 1;
  const floor: TierFloor = probe.tier ?? "qualitative_verified";
  if (TIER_RANK[scene.tier]! < TIER_RANK[floor]!) {
    failures.push(`${probe.id}: tier ${scene.tier} is below the expected ${floor} (${scene.reason})`);
  }
  if (scene.renderScene.primitives.length < 3) {
    failures.push(`${probe.id}: only ${scene.renderScene.primitives.length} primitives; the figure is not drawn`);
  }
  for (const [symbol, expected] of Object.entries(probe.symbols ?? {})) {
    const actual = scene.document.constructions.filter((construction) => construction.operator === "symbol" && construction.inputs.symbol === symbol).length;
    if (actual !== expected) failures.push(`${probe.id}: expected ${expected} ${symbol} symbol(s), found ${actual}`);
  }
  for (const operator of probe.operators ?? []) {
    if (!scene.document.constructions.some((construction) => construction.operator === operator)) {
      failures.push(`${probe.id}: figure must use the ${operator} operator`);
    }
  }
  for (const id of probe.entities ?? []) {
    if (!scene.document.entities.some((entity) => entity.id === id)) failures.push(`${probe.id}: figure must declare entity "${id}"`);
  }
  for (const kind of probe.annotations ?? []) {
    const declared = scene.document.annotations.some((annotation) => annotation.kind === kind);
    const rendered = scene.renderScene.primitives.some((primitive) => primitive.provenance?.annotation === kind);
    if (!declared || !rendered) failures.push(`${probe.id}: figure must carry a rendered ${kind} annotation`);
  }
  if (probe.archetype === "incline_body" && scene.document.constructions.some((construction) => construction.operator === "circle") && !/\b(?:roll|cylinder|sphere|disc|disk|ring)/i.test(probe.question)) {
    failures.push(`${probe.id}: a resting block must not invent a rolling disk`);
  }
  // Circuit contract shared with the family gate: every network marks current direction on a branch.
  const isCircuit = scene.document.constructions.some((construction) => construction.operator === "symbol");
  if (isCircuit && !scene.document.annotations.some((annotation) => annotation.kind === "sense")) {
    failures.push(`${probe.id}: circuit figure has no current-sense annotation`);
  }
  // Provenance the persistence trust boundary reads.
  const source = scene.document.source as Record<string, unknown>;
  if (source.archetype !== scene.archetype || typeof source.slotSources !== "object" || !("exactGrounding" in source)) {
    failures.push(`${probe.id}: document.source lacks archetype provenance (archetype, slotSources, exactGrounding)`);
  }
  if (scene.tier === "exact_verified" && source.exactGrounding === null) {
    failures.push(`${probe.id}: exact tier without exact grounding recorded`);
  }
  if (renderDir) {
    const subtitle = `${scene.archetype} · ${scene.tier} · ${scene.document.assertions.map((assertion) => assertion.predicate).join("/")}`;
    writeFileSync(resolve(renderDir, `${probe.id}.svg`), renderSceneSvg(scene.renderScene, { title: probe.question.slice(0, 110), subtitle }));
    cells.push({ scene: scene.renderScene, title: `${probe.id} — ${probe.question.slice(0, 95)}`, subtitle });
  }
}

for (const [group, detected] of groups) {
  if (detected.size > 1) failures.push(`group ${group}: phrasing variants disagree (${[...detected].join(", ")})`);
}

const missingGenerators = ARCHETYPE_PROBES
  .filter((probe) => probe.archetype && !probe.detectOnly && !implementedArchetypes().includes(probe.archetype))
  .map((probe) => `${probe.id}: ${probe.archetype} has no generator`);
failures.push(...missingGenerators);

if (renderDir) {
  for (let index = 0; index * 6 < cells.length; index += 1) {
    writeFileSync(resolve(renderDir, `sheet-${index + 1}.svg`), contactSheetSvg(cells.slice(index * 6, index * 6 + 6), 2));
  }
  console.log(`verify-archetype-pictures: rendered ${cells.length} figures to ${renderDir}`);
}

console.log(`verify-archetype-pictures: probes=${ARCHETYPE_PROBES.length} scenes=${scenes} exact=${exact} generators=${implementedArchetypes().length}`);
if (failures.length > 0) {
  console.error(`verify-archetype-pictures: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-archetype-pictures: ok");
