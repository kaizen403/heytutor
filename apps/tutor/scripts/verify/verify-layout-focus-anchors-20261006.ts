import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

// Unchanged independent source: the A segment crosses B, while a generated
// equal-length tick can give A a misleading cached extent. dsaExtent hides
// the original body and its focus anchor, but leaves its visible label.
const source = JSON.parse(readFileSync(resolve("scripts/verify/fixtures/verified-layout-focus-source-20261006.json"), "utf8"));
let checks = 0;
for (const metadata of [
  { summary: true, annotation: "arbitrary-unrecognised-value" },
  { summary: true, annotation: true },
  { summary: true, annotation: "sense" },
  { summary: true, dsaExtent: true },
  { dsaExtent: true },
  { summary: true, dsaExtent: true, annotation: true },
  {},
]) {
  const document = structuredClone(source);
  document.entities.find((entity: { id: string }) => entity.id === "A").provenance = metadata;
  const validated = validateSceneDocument(document);
  assert(validated.document);
  const compiled = compileSceneDocument(validated.document);
  assert(compiled.ok && compiled.renderScene);
  const before = JSON.stringify({ document, compiled });
  const presentation = buildVerifiedDiagramPresentation(validated.document, compiled.renderScene);
  const bodyDrawn = presentation.diagram.commands.some(command => command.type === "DRAW_LINE" && command.semanticRef?.primitiveId === "primitive_A");
  assert.equal(bodyDrawn, !("dsaExtent" in metadata && metadata.dsaExtent));
  const facts = presentation.diagram.promptAddon!.split("\n").find(line => line.startsWith("Verified screen layout facts"))!;
  assert(facts);
  for (const match of facts.matchAll(/\[FOCUS:([^\]]+)\]/g)) {
    assert(presentation.diagram.anchors.some(anchor => anchor.id === match[1]), `Unresolved layout focus ${match[1]}`);
  }
  if (bodyDrawn) assert.doesNotMatch(facts, /\[FOCUS:A\] is left of \[FOCUS:B\]/);
  else assert.doesNotMatch(facts, /\[FOCUS:A\]/);
  assert.equal(JSON.stringify({ document, compiled }), before);
  checks++;
}
console.log(`PASS ${checks} full presentation focus-anchor cases`);
