import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsup'))('esbuild');
const mode = process.argv[2] ?? 'source';
if (!['source', 'esm', 'base-source'].includes(mode)) throw new Error('source, esm or base-source required');
const entry = new URL('./verify-w2-ucm-operand-entity.ts', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'ucm-operand-entity-'));
try {
  await esbuild.build({ entryPoints: [fileURLToPath(entry)], outfile: join(dir, 'gate.mjs'), bundle: true,
    platform: 'node', format: 'esm', tsconfig: join(root, 'apps/tutor/tsconfig.json'),
    define: { 'import.meta.url': JSON.stringify(entry.href), 'process.env.UCM_OPERAND_GATE_MODE': JSON.stringify(mode) }, logLevel: 'silent',
    plugins: [{ name: 'own-graph', setup(build) {
      build.onResolve({ filter: /^@heytutor\/(scene-engine|tutor-core|drawing)$|\.\.\/\.\.\/src\/index$/ }, args => {
        const pkg = args.path.includes('src/index') ? 'scene-engine' : args.path.split('/')[1];
        return mode === 'esm' ? { path: pathToFileURL(join(root, `packages/${pkg}/dist/index.js`)).href, external: true }
          : { path: join(root, `packages/${pkg}/src/index.ts`) };
      });
      if (mode === 'base-source') build.onLoad({ filter: /uniformCircularAuthority\.ts$/ }, args => ({
        contents: execFileSync('git', ['show', `062a050079d83d7e9ebea1e0e09deeaa41989347:${args.path.slice(root.length)}`], { cwd: root, encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(args.path),
      }));
    } }],
  });
  await import(pathToFileURL(join(dir, 'gate.mjs')).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
