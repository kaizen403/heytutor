import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadDiagramExemplarLibrary } from "../lecture-lab/diagramExamples";

const staticRoot = resolve(process.cwd(), ".next/static");
if (!existsSync(staticRoot)) {
  throw new Error(".next/static is missing; run pnpm build before the diagram client-bundle gate");
}

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

const libraryPath = resolve(process.cwd(), "../../data/diagram-eval/v1/exemplars/_library.jsonl");
const exemplars = loadDiagramExemplarLibrary(libraryPath, []);
const chunks = filesUnder(staticRoot)
  .filter((file) => /\.(?:js|css|json|map)$/.test(file))
  .map((file) => ({ file, text: readFileSync(file, "utf8") }));

for (const exemplar of exemplars) {
  for (const chunk of chunks) {
    if (chunk.text.includes(exemplar.id)) {
      throw new Error(`diagram exemplar id ${exemplar.id} leaked into ${chunk.file}`);
    }
    const documentText = JSON.stringify(exemplar.document);
    if (documentText.length >= 80 && chunk.text.includes(documentText)) {
      throw new Error(`diagram exemplar document ${exemplar.id} leaked into ${chunk.file}`);
    }
  }
}

console.log(`diagram client-bundle verification passed (${exemplars.length} server-only examples)`);
