import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyArtifacts(root) {
  const next = resolve(root, 'apps/tutor/.next');
  const build = (await readFile(resolve(next, 'BUILD_ID'), 'utf8')).trim();
  if (!build) throw new Error('Missing build identity');
  for (const path of ['required-server-files.json', 'server/app-paths-manifest.json', 'build-manifest.json']) {
    JSON.parse(await readFile(resolve(next, path), 'utf8'));
  }
  if (!(await stat(resolve(next, 'static'))).isDirectory()) throw new Error('Missing static artifacts');
}

export async function verifyReadiness(origin, commit, { attempts = 24, delayMs = 5000 } = {}) {
  async function get(path) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(5000), redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected readiness redirect');
    if (!response.ok) throw new Error('Release readiness HTTP check failed');
    return response;
  }
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const health = await (await get('/api/health')).json();
      if (!health.ok || health.release !== commit) throw new Error('Running release does not match requested commit');
      // The protected root redirects anonymous clients to login. The existing
      // read-only embed route renders the actual tutor shell without credentials.
      const html = await (await get('/?embed=1')).text();
      if (!/\bdata-tutor-session=["']embed["']/.test(html)) throw new Error('Tutor embed shell is missing');
      const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)].map(match => match[1]))];
      if (!assets.length) throw new Error('Tutor embed page has no build assets');
      for (const asset of assets) {
        const url = new URL(asset, origin);
        if (url.origin !== origin) throw new Error('Unexpected asset origin');
        await get(url.pathname + url.search);
      }
      console.log('Requested release, tutor embed shell and static assets are ready.');
      return;
    } catch (error) { lastError = error; }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, origin] = process.argv.slice(2);
  await verifyArtifacts(root);
  if (origin) await verifyReadiness(origin, commit);
}
