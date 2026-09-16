/**
 * Shared bench for the chemistry families: validate, compile, and render one
 * document, then say exactly why a figure was refused.
 *
 *   import { renderDocument, rasterize } from "./lab";
 *   const result = renderDocument(doc, "/tmp/out/vsepr-sf4.svg", "SF4");
 *   await rasterize("/tmp/out");   // headless Firefox, .png beside each .svg
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { RenderScene, SceneDocument, SceneIssue } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

export interface LabResult {
  ok: boolean;
  primitives: number;
  labels: string[];
  issues: SceneIssue[];
  renderScene: RenderScene | null;
  document: SceneDocument | null;
}

export function compileForLab(document: SceneDocument | null): LabResult {
  if (!document) return { ok: false, primitives: 0, labels: [], issues: [{ code: "declined", message: "builder returned null", severity: "fatal" }], renderScene: null, document: null };
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) {
    return { ok: false, primitives: 0, labels: [], issues: validated.report.issues.filter((issue) => issue.severity === "fatal"), renderScene: null, document: null };
  }
  const compiled = compileSceneDocument(validated.document);
  const fatal = compiled.report.issues.filter((issue) => issue.severity === "fatal");
  const ok = compiled.ok && Boolean(compiled.renderScene) && (compiled.renderScene?.primitives.length ?? 0) > 0 && fatal.length === 0;
  const labels = (compiled.renderScene?.primitives ?? [])
    .filter((primitive) => (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text)
    .map((primitive) => primitive.text!);
  return { ok, primitives: compiled.renderScene?.primitives.length ?? 0, labels, issues: fatal, renderScene: compiled.renderScene, document: validated.document };
}

export function renderDocument(document: SceneDocument | null, outPath: string, title: string, subtitle?: string): LabResult {
  const result = compileForLab(document);
  const full = resolve(outPath);
  mkdirSync(dirname(full), { recursive: true });
  if (result.renderScene) {
    writeFileSync(full, renderSceneSvg(result.renderScene, { title, subtitle: subtitle ?? `primitives=${result.primitives} labels=${result.labels.join(" | ")}` }));
  }
  const status = result.ok ? "ok " : "REFUSED";
  console.log(`${status} ${title.slice(0, 80)} -> primitives=${result.primitives} labels=[${result.labels.join(", ")}]${result.ok ? "" : " issues=" + JSON.stringify(result.issues.map((issue) => `${issue.code}: ${issue.message}`))}`);
  return result;
}

/** Rasterize every .svg under `target` (file or directory) with headless Firefox. */
export function rasterize(target: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = resolve(here, "../../../../apps/tutor/scripts/lecture-lab/svg2png.mjs");
  try {
    execFileSync("node", [script, resolve(target)], { stdio: "inherit", timeout: 240_000 });
  } catch (error) {
    console.error("rasterize failed", error instanceof Error ? error.message : error);
  }
}
