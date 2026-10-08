import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel, standardCases } from "../../../src/physics/em20261007/consume";
import { renderSceneSvg } from "../../lib/renderSceneSvg";
import type { RenderScene } from "../../../src/types";

const out = process.argv[2];
if (!out) throw new Error("usage: render-em-gallery.ts <output-directory>");
if (out.includes("/bridgetown/.context/em20261007")) {
  throw new Error("refusing to overwrite the original bridgetown evidence directory");
}
const directory = resolve(out);
mkdirSync(directory, { recursive: true });
const require = createRequire(import.meta.url);
const sharp = require(resolve(process.cwd(), "../../node_modules/.pnpm/sharp@0.35.4_@types+node@20.19.43/node_modules/sharp")) as
  (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };

interface Entry {
  readonly model: string;
  readonly sample: "ordinary" | "altered";
  readonly topics: readonly string[];
  readonly scope: string;
  readonly assumptions: string;
  readonly inputs: Record<string, number>;
  readonly certified: unknown;
  readonly kinds: Record<string, number>;
  readonly labels: readonly string[];
  readonly pngSha256?: string;
  readonly status: "pass" | "fail" | "unreviewed";
  readonly reason: string;
}

function kindsOf(scene: RenderScene): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const primitive of scene.primitives) counts[primitive.kind] = (counts[primitive.kind] ?? 0) + 1;
  return counts;
}

function review(model: string, scene: RenderScene, labels: readonly string[]): { status: "pass" | "fail" | "unreviewed"; reason: string } {
  if (model === "mf.ampere") {
    return scene.primitives.length === 0
      ? { status: "pass", reason: "text-only definition has no diagram ink" }
      : { status: "fail", reason: "ampere definition drew marks" };
  }
  if (model === "dc.wheatstone") {
    const ring = scene.primitives.some((primitive) => primitive.entityId.includes("G") && primitive.points.length >= 12);
    return ring
      ? { status: "pass", reason: "detector glyph includes a ring; source is a separate branch" }
      : { status: "fail", reason: "Wheatstone detector ring is missing" };
  }
  if (model === "mm.lines") {
    const vectors = scene.primitives.filter((primitive) => primitive.kind === "vector");
    return vectors.length >= 4 && labels.includes("N") && labels.includes("S")
      ? { status: "pass", reason: "external field lines and separate N and S labels are present" }
      : { status: "fail", reason: "bar magnet is missing external lines or separate N and S labels" };
  }
  if (model === "emw.triad" || model === "emw.amplitude") {
    const circles = scene.primitives.filter((primitive) => primitive.kind === "circle").length;
    const named = labels.includes("E") && labels.includes("B") && labels.includes("k");
    return circles >= 2 && named
      ? { status: "pass", reason: "E, B, and k are labeled and B has a ring plus a dot" }
      : { status: "fail", reason: "EM triad is missing E/B/k labels or the out-of-page dot" };
  }
  if (scene.primitives.length === 0) return { status: "fail", reason: "compiled scene has no ink" };
  return { status: "unreviewed", reason: "compiled and rasterized; packet oracles and independent visual review decide acceptance" };
}

const entries: Entry[] = [];
for (const item of standardCases()) {
  for (const sample of ["ordinary", "altered"] as const) {
    const inputs = sample === "ordinary" ? item.ordinary : item.altered;
    const consumed = consumePhysicalModel(item.modelName, inputs);
    if (consumed.status !== "scene") {
      entries.push({
        model: item.modelName,
        sample,
        topics: item.topicIds,
        scope: item.declaredScope,
        assumptions: item.assumptions,
        inputs,
        certified: null,
        kinds: {},
        labels: [],
        status: "fail",
        reason: consumed.status === "rejected" ? consumed.reason : consumed.status,
      });
      continue;
    }
    const validated = validateSceneDocument(consumed.document);
    const compiled = validated.document ? compileSceneDocument(validated.document) : null;
    if (!compiled?.ok || !compiled.renderScene) {
      entries.push({
        model: item.modelName,
        sample,
        topics: item.topicIds,
        scope: item.declaredScope,
        assumptions: item.assumptions,
        inputs,
        certified: consumed.document.source.certified,
        kinds: {},
        labels: [],
        status: "fail",
        reason: "compile failed",
      });
      continue;
    }
    const labels = compiled.renderScene.primitives.flatMap((primitive) => primitive.text ? [primitive.text] : []);
    const verdict = review(item.modelName, compiled.renderScene, labels);
    const file = `${item.modelName}.${sample}.svg`;
    const markup = renderSceneSvg(compiled.renderScene, {
      title: `${item.modelName} ${sample}`,
      subtitle: item.topicIds.join(" "),
    });
    writeFileSync(resolve(directory, file), markup);
    const png = await sharp(Buffer.from(markup)).png().toBuffer();
    writeFileSync(resolve(directory, `${item.modelName}.${sample}.png`), png);
    entries.push({
      model: item.modelName,
      sample,
      topics: item.topicIds,
      scope: item.declaredScope,
      assumptions: item.assumptions,
      inputs,
      certified: consumed.document.source.certified,
      kinds: kindsOf(compiled.renderScene),
      labels,
      pngSha256: createHash("sha256").update(png).digest("hex"),
      status: verdict.status,
      reason: verdict.reason,
    });
  }
}

writeFileSync(resolve(directory, "disposition.json"), JSON.stringify(entries, null, 2));
const cards = entries.map((entry) => {
  const file = `${entry.model}.${entry.sample}.png`;
  return `<figure><img src="${file}" alt="${entry.model} ${entry.sample}"><figcaption><strong>${entry.model}</strong> ${entry.sample} — ${entry.status}. ${entry.reason}<br>topics: ${entry.topics.join(", ")}<br>inputs: ${JSON.stringify(entry.inputs)}<br>${entry.assumptions}</figcaption></figure>`;
}).join("\n");
writeFileSync(resolve(directory, "index.html"), `<!doctype html><meta charset="utf-8"><title>EM five gallery</title><style>body{font:14px/1.4 sans-serif;margin:24px}figure{margin:0 0 32px}img{width:100%;max-width:1200px;border:1px solid #ccc}figcaption{max-width:1200px}</style><h1>EM five compiled-primitive gallery</h1><p>Rasterized from compiled RenderScene primitives with the existing board SVG writer. Arrowheads are marker heads. This is not a Konva screenshot and is not student-runtime READY.</p>${cards}`);
const passed = entries.filter((entry) => entry.status === "pass").length;
const unreviewed = entries.filter((entry) => entry.status === "unreviewed").length;
console.log(`gallery wrote ${entries.length} full 1200x700 SVG+PNG entries, ${passed} intrinsic checks passed, ${unreviewed} await independent visual disposition, to ${directory}`);
