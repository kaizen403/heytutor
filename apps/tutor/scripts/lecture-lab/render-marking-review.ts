/**
 * Render the final board using the same command paths and handwritten glyphs
 * as the whiteboard. This measures presentation, rather than the smaller
 * typeset labels in the engine's generic SVG overview.
 *
 * pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/render-marking-review.ts /tmp/heytutor-marking-review <before-ref>
 * node apps/tutor/scripts/lecture-lab/svg2png.mjs /tmp/heytutor-marking-review
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  arcPath, arrowPath, circlePath, dimensionPath, linePath, pointMarkPath,
  polylinePath, rectPath, snapToBoardTypeScale, textToStrokePaths,
  type VerifiedDiagramCommand,
} from "@heytutor/drawing";
import { compileSceneDocument, type CompileResult, type SceneDocument } from "@heytutor/scene-engine";
import { solidAnchorScene } from "../../../../packages/scene-engine/scripts/verify/verify-solid-anchors";
import { solidAnchorPoint, type SolidProjection } from "../../../../packages/scene-engine/src/compile/solidAnchors";
import { instrumentInkStyle } from "../../../../packages/whiteboard/src/instruments";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const repo = resolve(process.cwd(), "../..");

/** The baseline uses the checked-in compiler and label solver, unchanged. */
async function beforeCompiler(baseline: string): Promise<typeof compileSceneDocument> {
  const snapshot = mkdtempSync(join(tmpdir(), "heytutor-marking-before-"));
  const files = ["packages/scene-engine/src/labels/labelEngine.ts", "packages/scene-engine/src/compile/compiler.ts"];
  const targets = new Map(files.map((file) => [resolve(repo, file), join(snapshot, `${file.includes("compiler") ? "compiler" : "labelEngine"}.mts`)]));
  for (const file of files) {
    const source = execFileSync("git", ["show", `${baseline}:${file}`], { cwd: repo, encoding: "utf8" });
    const relocated = source.replace(/from\s+(["'])([^"']+)\1/g, (match, quote: string, specifier: string) => {
      const dependency = specifier.startsWith(".") ? resolve(repo, dirname(file), specifier) : null;
      const target = dependency ? targets.get(`${dependency}.ts`) ?? `${dependency}.ts`
        : specifier === "@heytutor/drawing" ? join(repo, "packages/drawing/src/index.ts") : specifier;
      return `from ${quote}${target}${quote}`;
    });
    writeFileSync(targets.get(resolve(repo, file))!, relocated);
  }
  const imported = await import(pathToFileURL(targets.get(resolve(repo, files[1]!))!).href);
  rmSync(snapshot, { recursive: true, force: true });
  return imported.compileSceneDocument;
}

/**
 * HEAD predates solid_anchor. Equivalent world points let both compilers
 * render the same measured geometry while comparing their marking behavior.
 */
function explicitAnchors(document: SceneDocument): SceneDocument {
  const projections = new Map<string, SolidProjection>();
  for (const construction of document.constructions) {
    if (construction.operator !== "solid_projection") continue;
    const input = construction.inputs;
    projections.set(construction.outputs[0]!, {
      kind: input.kind as SolidProjection["kind"], center: { x: 0, y: 0 },
      radius: Number(input.radius), height: Number(input.height), topRadius: Number(input.radius),
      axis: input.axis as "vertical" | "horizontal",
    });
  }
  return {
    ...document,
    constructions: document.constructions.map((construction) => {
      if (construction.operator !== "solid_anchor") return construction;
      const input = construction.inputs;
      const point = solidAnchorPoint(projections.get(String(input.solid))!, Number(input.at), Number(input.radialFraction), Number(input.angleDeg));
      return { ...construction, operator: "point", inputs: { ...point, coordinateSpace: "world" } };
    }),
  };
}

function measuredSpans(): SceneDocument {
  const spans = [
    [{ x: 0, y: 0 }, { x: 5, y: 0 }],
    [{ x: 1, y: 0 }, { x: 3, y: 0 }],
    [{ x: 0, y: 2 }, { x: 4, y: 4 }],
    [{ x: 5, y: 1 }, { x: 5, y: 4 }],
  ];
  const ids = spans.flatMap((_, index) => [`a${index}`, `b${index}`, `span${index}`, `distance${index}`]);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "point-to-point distance review" },
    source: { question: "Mark the nested, diagonal and vertical distances between verified endpoints." },
    quantities: [], relations: [], assertions: [], annotations: [],
    entities: spans.flatMap((_, index) => [
      { id: `a${index}`, kind: "point", role: "measurement endpoint" },
      { id: `b${index}`, kind: "point", role: "measurement endpoint" },
      { id: `span${index}`, kind: "segment", role: "measured span" },
      { id: `distance${index}`, kind: "dimension", role: "distance", label: ["5 cm", "2 cm", "s", "h"][index]! },
    ]),
    constructions: spans.flatMap(([start, end], index) => [
      { id: `make_a${index}`, operator: "point", inputs: { ...start!, coordinateSpace: "world" }, outputs: [`a${index}`] },
      { id: `make_b${index}`, operator: "point", inputs: { ...end!, coordinateSpace: "world" }, outputs: [`b${index}`] },
      { id: `make_span${index}`, operator: "segment", inputs: { start: `a${index}`, end: `b${index}` }, outputs: [`span${index}`] },
      { id: `make_distance${index}`, operator: "dimension", inputs: { start: `a${index}`, end: `b${index}` }, outputs: [`distance${index}`] },
    ]),
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Show the measured spans." }],
    teachingTimeline: [],
  };
}

async function commandSvg(command: VerifiedDiagramCommand): Promise<string> {
  const [x = 0, y = 0, a = 0, b = 0, c = 0] = command.params;
  const ink = instrumentInkStyle("pencil", "#1B2A4A");
  const path = (data: string, width = command.visualStyle?.strokeWidth ?? 1.15, dashed = command.visualStyle?.dashed === true) =>
    `<path d="${data}" fill="none" stroke="${ink.color}" stroke-opacity="${ink.opacity}" stroke-width="${width * ink.widthScale}" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="6 5"' : ""}/>`;
  switch (command.type) {
    case "DRAW_LINE": return path(command.params.length > 4 ? polylinePath(command.params) : linePath(x, y, a, b));
    case "DRAW_POINT": return path(pointMarkPath(x, y, a));
    case "DRAW_RECT": return path(rectPath(x, y, a, b));
    case "DRAW_CIRCLE": return path(circlePath(x, y, a));
    case "DRAW_ARC": return path(arcPath(x, y, a, b, c));
    case "ARROW": return path(arrowPath(x, y, a, b));
    case "DIMENSION": return path(dimensionPath(x, y, a, b, c).path, 1.4, true);
    case "LABEL": {
      const font = snapToBoardTypeScale(a || 24);
      const characters = await textToStrokePaths(command.text ?? "", x, y, font);
      return characters.map((character) => character.strokes.length
        ? character.strokes.map((stroke) => path(stroke.pathData, stroke.width, false)).join("")
        : `<text x="${character.x}" y="${character.y + font}" font-size="${font}" fill="${ink.color}">${escape(character.char)}</text>`).join("");
    }
    default: throw new Error(`Review renderer needs the real path for ${command.type}`);
  }
}

export async function board(document: SceneDocument, result: CompileResult, title: string): Promise<string> {
  if (!result.ok || !result.renderScene) throw new Error(`${title}: ${JSON.stringify(result.report.issues)}`);
  const commands = buildVerifiedDiagramPresentation(document, result.renderScene).diagram.commands;
  const ink = await Promise.all(commands.map(commandSvg));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#F6E4C4"/><text x="32" y="45" font-family="system-ui" font-size="22" fill="#1B2A4A">${escape(title)}</text>${ink.join("\n")}</svg>`;
}

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? "/tmp/heytutor-marking-review");
  const baseline = process.argv[3] ?? "HEAD";
  mkdirSync(out, { recursive: true });
  const before = await beforeCompiler(baseline);
  const cases = [
    { name: "cylinder-vertical", document: solidAnchorScene("vertical") },
    { name: "cylinder-horizontal", document: solidAnchorScene("horizontal") },
    { name: "measured-spans", document: measuredSpans() },
  ];
  for (const item of cases) {
    for (const [phase, compiler] of [["before", before], ["after", compileSceneDocument]] as const) {
      const document = phase === "before" ? explicitAnchors(item.document) : item.document;
      const result = compiler(document);
      const svg = await board(document, result, `${item.name} — ${phase === "before" ? "checked-in marking" : "precise endpoint marking"}`);
      writeFileSync(join(out, `${item.name}-${phase}.svg`), svg);
      writeFileSync(join(out, `${item.name}-${phase}.json`), JSON.stringify(result.renderScene, null, 2));
    }
  }
  writeFileSync(join(out, "index.html"), `<!doctype html><html><meta charset="utf-8"><title>Marking review</title><style>body{margin:20px;background:#eee;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;border:1px solid #aaa}</style><main>${cases.flatMap((item) => ["before", "after"].map((phase) => `<img alt="${item.name} ${phase}" src="${item.name}-${phase}.svg">`)).join("")}</main></html>`);
  writeFileSync(join(out, "metadata.json"), JSON.stringify({
    baseline: execFileSync("git", ["rev-parse", baseline], { cwd: repo, encoding: "utf8" }).trim(),
    renderer: "Whiteboard command geometry and handwriting glyph paths, final frame",
    baselineCompatibility: "solid_anchor replaced with equivalent derived world points for the older compiler",
  }, null, 2));
  console.log(`Marking review: ${out}/index.html (6 boards with actual command paths and handwritten labels)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
