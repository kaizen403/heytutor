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
const entry = new URL(process.argv[3] ?? './verify-w2-ucm-actual-caller.ts', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'ucm-actual-caller-'));
try {
  await esbuild.build({ entryPoints: [fileURLToPath(entry)], outfile: join(dir, 'gate.mjs'), bundle: true,
    platform: 'node', format: 'esm', tsconfig: join(root, 'apps/tutor/tsconfig.json'),
    define: { 'import.meta.url': JSON.stringify(entry.href) }, logLevel: 'silent',
    plugins: [{ name: 'own-graph', setup(build) {
      build.onResolve({ filter: /^@heytutor\/scene-engine$|\.\.\/\.\.\/src\/index$/ }, () => mode === 'esm'
        ? { path: pathToFileURL(join(root, 'packages/scene-engine/dist/index.js')).href, external: true }
        : { path: join(root, 'packages/scene-engine/src/index.ts') });
      if (mode === 'base-source') build.onLoad({ filter: /uniformCircular(?:Authority|Source)\.ts$/ }, args => ({
        contents: execFileSync('git', ['show', `dabbf91d0c3f3c82cff9785872b1e135004bba92:${args.path.slice(root.length)}`], { cwd: root, encoding: 'utf8' }),
        loader: 'ts', resolveDir: dirname(args.path),
      }));
    } }],
  });
  await import(pathToFileURL(join(dir, 'gate.mjs')).href);
} finally { rmSync(dir, { recursive: true, force: true }); }
