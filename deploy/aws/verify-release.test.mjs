import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyArtifacts, verifyReadiness } from './verify-release.mjs';

const root = await mkdtemp(join(tmpdir(), 'heytutor-release-'));
const next = join(root, 'apps/tutor/.next');
const commit = 'a'.repeat(40);
let release = commit;
let assetStatus = 200;
const tutorHtml = body => `<main data-tutor-session="embed">${body}</main>`;
let rootHtml = tutorHtml('<script src="/_next/static/fixture.js"></script>');
let pageRedirect = false;
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/api/health') res.end(JSON.stringify({ ok: true, release }));
  else if (req.url === '/' || req.url === '/?embed=1') {
    if (pageRedirect) { res.statusCode = 307; res.setHeader('Location', '/login'); res.end(); }
    else res.end(rootHtml);
  }
  else if (req.url === '/login') res.end('<form>Login</form><script src="/_next/static/login.js"></script>');
  else { res.statusCode = assetStatus; res.end('fixture'); }
});
try {
  await assert.rejects(verifyArtifacts(root), 'partially deleted build is rejected');
  await mkdir(join(next, 'server'), { recursive: true });
  await mkdir(join(next, 'static'));
  await writeFile(join(next, 'BUILD_ID'), 'fixture');
  for (const file of ['required-server-files.json', 'server/app-paths-manifest.json', 'build-manifest.json']) {
    await writeFile(join(next, file), '{}');
  }
  await verifyArtifacts(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = { attempts: 2, delayMs: 1 };
  await verifyReadiness(origin, commit, options);
  release = 'b'.repeat(40);
  await assert.rejects(verifyReadiness(origin, commit, options), /release does not match/, 'old process cannot satisfy readiness');
  release = commit; assetStatus = 404;
  await assert.rejects(verifyReadiness(origin, commit, options), /HTTP check failed/, 'health alone cannot hide missing assets');
  assetStatus = 200; rootHtml = tutorHtml('<p>broken build</p>');
  await assert.rejects(verifyReadiness(origin, commit, options), /no build assets/);
  rootHtml = tutorHtml('<script src="https://untrusted.invalid/_next/static/fixture.js"></script>');
  await assert.rejects(verifyReadiness(origin, commit, options), /Unexpected asset origin/);
  pageRedirect = true;
  await assert.rejects(verifyReadiness(origin, commit, options), /Unexpected readiness redirect/, 'a healthy login page cannot satisfy tutor readiness');
  pageRedirect = false;
  rootHtml = '<form>Login</form><script src="/_next/static/login.js"></script>';
  await assert.rejects(verifyReadiness(origin, commit, options), /Tutor embed shell is missing/, 'HTTP 200 with unrelated page assets is insufficient');
  assert(requests.includes('/?embed=1'), 'readiness must use the supported anonymous tutor shell route');
  assert(!requests.includes('/'), 'the protected root is never used as an anonymous tutor probe');
  assert(!requests.includes('/login'), 'redirects must not be followed');
  console.log('Release artifact and HTTP readiness regressions passed (9).');
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
