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
const entry = new URL(process.argv[3] ?? './verify-w2-ucm-whole-guards.ts', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'ucm-whole-guards-'));
const index = join(root, 'packages/scene-engine/src/index.ts');
const helper = join(root, 'packages/scene-engine/src/physics/uniformCircularAuthority.ts');
try {
 await esbuild.build({entryPoints:[fileURLToPath(entry)], outfile:join(dir,'gate.mjs'), bundle:true, platform:'node', format:'esm',
  tsconfig:join(root,'apps/tutor/tsconfig.json'), define:{'import.meta.url':JSON.stringify(entry.href)}, logLevel:'silent',
  plugins:[{name:'own-graph',setup(build){
   build.onResolve({filter:/^@heytutor\/scene-engine$|scene-engine\/src\/index$|\.\.\/\.\.\/src\/index$/},()=>mode==='esm'
    ? {path:pathToFileURL(join(root,'packages/scene-engine/dist/index.js')).href,external:true} : {path:index});
   if(mode==='baseline') build.onLoad({filter:/uniformCircularAuthority\.ts$/},args=>args.path===helper
    ? {contents:execFileSync('git',['show','2314ec33b6fb421028bca597f819bca17cc2b168:packages/scene-engine/src/physics/uniformCircularAuthority.ts'],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:dirname(helper)} : undefined);
  }}]});
 await import(pathToFileURL(join(dir,'gate.mjs')).href);
} finally {rmSync(dir,{recursive:true,force:true});}
