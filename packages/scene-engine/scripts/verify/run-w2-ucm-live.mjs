/** Bundle the offline app import graph with its actual aliases/JSON loaders. */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsup"))("esbuild");
const entry = new URL(process.argv[2] ?? "./verify-w2-ucm-live.ts", import.meta.url);
const directory = mkdtempSync(join(tmpdir(), "w2-ucm-offline-"));
const outfile = join(directory, "gate.mjs");
try {
  await esbuild.build({
    entryPoints: [fileURLToPath(entry)], outfile, bundle: true, platform: "node", format: "esm",
    tsconfig: fileURLToPath(new URL("../../../../apps/tutor/tsconfig.json", import.meta.url)),
    define: { "import.meta.url": JSON.stringify(entry.href) }, logLevel: "silent",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
