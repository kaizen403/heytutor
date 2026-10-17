/**
 * The tutor's tsconfig maps every workspace package to its `src`, so Next compiles that source with its own
 * SWC parser, not with tsc or esbuild. SWC rejects some forms both of those accept (an `in` test inside a
 * parameter default broke every route that reached the optics resolver, while typecheck and every tsx gate
 * passed). Parse each file Next compiles with the SWC binding Next ships.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type NextSwc = {
  loadBindings(): Promise<unknown>;
  parse(source: string, options: { syntax: "typescript"; tsx: boolean; isModule: boolean; filename: string }): Promise<unknown>;
};

const app = path.resolve(import.meta.dirname, "../..");
const swc = createRequire(path.join(app, "package.json"))("next/dist/build/swc/index.js") as NextSwc;

async function parseError(source: string, filename: string): Promise<string | null> {
  try {
    await swc.parse(source, { syntax: "typescript", tsx: filename.endsWith(".tsx"), isModule: true, filename });
    return null;
  } catch (error) {
    return String(error instanceof Error ? error.message : error).replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 2).join(" ");
  }
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  await swc.loadBindings();
  // G0: the parser reports errors at all, so a clean sweep is not vacuous.
  assert.ok(await parseError("export const broken = ;", "probe.ts"), "G0: SWC accepted a syntax error, so the sweep proves nothing");

  // Each aliased package's src directory, read from the tsconfig so a new alias is covered without editing this gate.
  const tsconfig = JSON.parse(readFileSync(path.join(app, "tsconfig.json"), "utf8")) as { compilerOptions: { paths: Record<string, string[]> } };
  const packageRoots = new Set<string>();
  for (const [alias, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
    if (!alias.startsWith("@heytutor/")) continue;
    for (const target of targets) {
      const resolved = path.resolve(app, target);
      const srcIndex = resolved.split(path.sep).lastIndexOf("src");
      assert.ok(srcIndex > 0, `G1: alias ${alias} does not point into a src directory (${target})`);
      packageRoots.add(resolved.split(path.sep).slice(0, srcIndex + 1).join(path.sep));
    }
  }
  assert.ok([...packageRoots].some((root) => root.endsWith(path.join("scene-engine", "src"))), "G1: scene-engine src is no longer aliased; revisit this gate");

  // The app's own source that Next compiles (scripts run under tsx, never through Next).
  const appRoots = readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !["node_modules", "scripts", "public", "prisma"].includes(entry.name))
    .map((entry) => path.join(app, entry.name));
  // Next's entry points and configs at the app root (middleware.ts, instrumentation.ts, next.config.ts, ...).
  const appFiles = readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
    .map((entry) => path.join(app, entry.name));

  const files = [...[...packageRoots, ...appRoots].flatMap((root) => walk(root, [])), ...appFiles];
  assert.ok(files.length > 300, `G1: only ${files.length} files found; the roots are wrong`);
  for (const entry of ["middleware.ts", "instrumentation.ts", "instrumentation-client.ts"]) {
    if (existsSync(path.join(app, entry))) assert.ok(files.includes(path.join(app, entry)), `G1: the entry point ${entry} is not in the sweep`);
  }
  const failures: string[] = [];
  for (const file of files) {
    const error = await parseError(readFileSync(file, "utf8"), file);
    if (error) failures.push(`${path.relative(app, file)}: ${error}`);
  }
  assert.deepEqual(failures, [], `G2: Next's SWC parser rejects ${failures.length} file(s):\n${failures.join("\n")}`);
  console.log(`next-parses-package-source: ok (${files.length} files from ${packageRoots.size} packages, ${appRoots.length} app folders and ${appFiles.length} root files)`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
