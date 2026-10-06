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
if (!['source', 'esm', 'baseline'].includes(mode)) throw new Error('source, esm or baseline required');
const entry = new URL(process.argv[3] ?? './verify-w2-ucm-derived-text.ts', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'ucm-derived-text-'));
process.env.UCM_GATE_MODE = mode;
try {
 await esbuild.build({entryPoints:[fileURLToPath(entry)], outfile:join(dir,'gate.mjs'), bundle:true, platform:'node', format:'esm',
  tsconfig:join(root,'apps/tutor/tsconfig.json'), define:{'import.meta.url':JSON.stringify(entry.href)}, logLevel:'silent',
  plugins:[{name:'own-graph',setup(build){
   build.onResolve({filter:/^@heytutor\/scene-engine$|\.\.\/\.\.\/src\/index$/},()=>mode==='esm'
    ? {path:pathToFileURL(join(root,'packages/scene-engine/dist/index.js')).href,external:true} : {path:join(root,'packages/scene-engine/src/index.ts')});
   if(mode==='baseline') build.onLoad({filter:/uniformCircular(?:Authority|Source)\.ts$/},args=>({
    contents:execFileSync('git',['show',`f260ce68b3ebd96ce87d506e6a8031cef4029542:${args.path.slice(root.length)}`],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:dirname(args.path)}));
  }}]});
 await import(pathToFileURL(join(dir,'gate.mjs')).href);
} finally {rmSync(dir,{recursive:true,force:true});}
