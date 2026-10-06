/** Build app source into a disposable ESM harness; workspace package imports
 * stay external and resolve their freshly built public exports. No server,
 * provider or database is contacted by the gate's injected fetch transport.
 */
import { createRequire } from "node:module";
import { readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const gate = process.argv[2] ? resolve(root, process.argv[2]) : resolve(here, "verify-w2-matrix-actual-caller-fix-20261006.ts");
if (!gate.startsWith(`${root}/`)) throw new Error("Gate must belong to this isolated worktree");
const output = resolve(here, `.matrix-actual-caller-${process.pid}.mjs`);
try {
  await esbuild.build({ entryPoints: [gate], outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    tsconfig: resolve(here, "tsconfig.w2-matrix-actual-caller-fix-20261006.json"),
    plugins: [{ name: "retain-source-file-urls", setup(build) {
      build.onLoad({ filter: /\.[cm]?[tj]sx?$/ }, args => ({
        contents: readFileSync(args.path, "utf8").replaceAll("import.meta.url", JSON.stringify(pathToFileURL(args.path).href)),
        loader: extname(args.path) === ".tsx" ? "tsx" : /\.[cm]?ts$/.test(args.path) ? "ts" : "js",
      }));
    } }],
  });
  console.log(`Public exports: ${import.meta.resolve("@heytutor/scene-engine")} | ${import.meta.resolve("@heytutor/tutor-core")}`);
  const run = spawnSync(process.execPath, [output], { stdio: "inherit" });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally { try { unlinkSync(output); } catch {} }
