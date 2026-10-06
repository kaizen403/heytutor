/** Run the real persistence/read graph against source or fresh public ESM exports. */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(
  new URL("../../../../packages/scene-engine/package.json", import.meta.url),
);
const esbuild = createRequire(require.resolve("tsup"))("esbuild");
const entry = new URL("./verify-w3-numeric-symbol-role.mts", import.meta.url);
const directory = mkdtempSync(join(tmpdir(), "w3-numeric-symbol-role-"));
const outfile = join(directory, "gate.mjs");
const mode = process.argv[2] ?? "source";
if (!["source", "esm"].includes(mode))
  throw new Error("Expected source or esm");
try {
  await esbuild.build({
    entryPoints: [fileURLToPath(entry)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
    define: { "import.meta.url": JSON.stringify(entry.href) },
    logLevel: "silent",
    plugins:
      mode === "esm"
        ? [
            {
              name: "own-public-esm",
              setup(build) {
                build.onResolve(
                  {
                    filter: /^@heytutor\/(?:scene-engine|drawing|tutor-core)$/,
                  },
                  (args) => ({
                    path: import.meta.resolve(args.path),
                    external: true,
                  }),
                );
              },
            },
          ]
        : [],
  });
  console.log(`Numeric Plan admission gate mode: ${mode}`);
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
