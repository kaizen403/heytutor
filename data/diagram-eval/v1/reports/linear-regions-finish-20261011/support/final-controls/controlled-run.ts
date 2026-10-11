/** Measurement-only wrapper. Fresh metrics guard every paid dispatch; no product edits. */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateDispatchLocation } from './dispatch-contract.mjs';

async function main() {
  const args = process.argv.slice(2);
  const flag = (key: string) => args[args.indexOf(`--${key}`) + 1];
  const required = { arm: 'planner_examples_strict', 'production-strict-subjects': 'maths', model: 'configured',
    'scene-planner-limit-ms': '60000', concurrency: '3', 'spend-mode': 'response_usage', 'scene-decline-policy': 'unchanged',
    narration: 'english', familiarity: 'normal', 'max-usd': '20' };
  for (const [key, value] of Object.entries(required)) {
    if (args.filter(a => a === `--${key}`).length !== 1 || flag(key) !== value) throw new Error(`Wrong frozen control: ${key}`);
  }
  const valuedFlags = new Set([...Object.keys(required), 'eval', 'origin', 'out', 'visual-need-replay', 'example-exclusions']);
  const booleanFlags = new Set(['figure-only', 'yes']);
  for (let index = 0; index < args.length; index++) {
    const name = args[index].replace(/^--/, '');
    if (!args[index].startsWith('--') || (!valuedFlags.has(name) && !booleanFlags.has(name))) throw new Error('Unregistered dispatch option');
    if (valuedFlags.has(name) && (!args[++index] || args[index].startsWith('--'))) throw new Error('Missing dispatch option value');
  }
  if ([...booleanFlags].some(name => args.filter(a => a === `--${name}`).length !== 1)) throw new Error('Wrong complete fixed-block controls');
  const registrationPath = process.env.H3R8_PREREGISTRATION;
  const label = process.env.H3R8_ROUND_LABEL;
  const arm = process.env.H3R8_ARM;
  const cohort = process.env.H3R8_COHORT;
  const block = process.env.H3R8_BLOCK;
  const launchNonce = process.env.H3R8_LAUNCH_NONCE;
  if (!registrationPath || !label || !launchNonce || !['main', 'candidate'].includes(arm ?? '') || !['development', 'heldout'].includes(cohort ?? '')) throw new Error('Missing frozen paid-cell preregistration/identity/launch nonce');
  const registration = JSON.parse(readFileSync(registrationPath, 'utf8'));
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const spec = registration.builds[arm!];
  validateDispatchLocation(args, { label, arm, cohort, block }, registration);
  const dispatch = registration.dispatchBlocks.find((b: { label: string }) => b.label === label);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (resolve(process.cwd(), '../..') !== spec.worktree || head !== spec.lock.head) throw new Error('Wrong isolated build');
  for (const [flagName, assetName] of [['eval', dispatch.evalAsset], ['visual-need-replay', 'jevParked'], ['example-exclusions', 'exclusions']]) {
    const asset = registration.assets[assetName];
    if (resolve(flag(flagName)) !== asset.path || hash(asset.path) !== asset.sha256) throw new Error(`Changed frozen asset: ${assetName}`);
  }
  process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  if (process.env.AI_GATEWAY_API_KEY?.trim() || process.env.LLM_PROVIDER !== 'azure' || process.env.AZURE_OPENAI_DEPLOYMENT !== 'st-gpt-6-sol-h3' || process.env.DIAGRAM_STRICT_SUBJECTS !== 'maths') throw new Error('Wrong isolated provider/subject/key state');
  const baselinePath = resolve(registration.context, 'metrics/baseline.json');
  const latestPath = resolve(registration.context, 'metrics/latest.json');
  if (!existsSync(baselinePath)) throw new Error('Fresh job baseline missing');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (baseline.job !== registration.job || baseline.preregistrationSha256 !== hash(registrationPath)) throw new Error('Foreign or stale baseline identity');
  const activeCheckpoint = resolve(flag('out'), 'spend-checkpoint.json');
  // The actual node PID differs from the parent tsx CLI PID. Bind exactly once,
  // then await the owning controller's activation before importing any lab code.
  const leasePath = resolve(registration.context, 'active-lease.json');
  const leaseEnd = Date.now() + 15000;
  while (!existsSync(leasePath) || !JSON.parse(readFileSync(leasePath, 'utf8')).launch) {
    if (Date.now() >= leaseEnd) throw new Error('Controller launch lease not published');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  execFileSync('python3', [resolve(registration.context, 'lease_guard.py'), '--preregistration', registrationPath,
    '--checkpoint', activeCheckpoint, '--wrapper-pid', String(process.pid), '--nonce', launchNonce, '--bind-wrapper'], { encoding: 'utf8', timeout: 10000 });
  while (JSON.parse(readFileSync(leasePath, 'utf8')).state !== 'active') {
    const lease = JSON.parse(readFileSync(leasePath, 'utf8'));
    if (['revoked', 'consumed'].includes(lease.state) || Date.now() >= leaseEnd) throw new Error('Controller lease never activated');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  let dispatchNumber = 0;
  const checkMetrics = (actualDispatch = false) => {
    let latest;
    try { latest = JSON.parse(readFileSync(latestPath, 'utf8')); } catch { process.exit(143); }
    const age = Date.now() - Date.parse(latest.observedAt);
    if (!latest.metricReadable || latest.job !== registration.job || latest.deployment !== 'st-gpt-6-sol-h3' ||
      latest.baselineSha256 !== hash(baselinePath) || !Number.isFinite(age) || age < -5000 || age > 150000 ||
      latest.windowStart !== baseline.windowStart || latest.filter !== baseline.filter || latest.realCapUsd !== 20 || latest.stopAtUsd !== 19.5) {
      console.error('PAID DISPATCH STOPPED: new-job metric identity/freshness unavailable'); process.exit(143);
    }
    let risk;
    try {
      risk = JSON.parse(execFileSync('python3', [resolve(registration.context, 'budget_guard.py'), '--preregistration', registrationPath,
        ...(actualDispatch ? ['--require-active', activeCheckpoint, '--wrapper-pid', String(process.pid), '--nonce', launchNonce] : [])], { encoding: 'utf8', timeout: 10000 }));
    } catch {
      console.error('PAID DISPATCH STOPPED: finite-budget ledger/anchor unavailable'); process.exit(143);
    }
    if (!risk.mayDispatch) {
      console.error('PAID DISPATCH STOPPED: conservative finite-budget exposure exhausted'); process.exit(143);
    }
    if (actualDispatch) {
      dispatchNumber++;
      appendFileSync(resolve(registration.context, 'runs', `${label}-dispatch-budget.jsonl`), JSON.stringify({
        at: new Date().toISOString(), actualRequestDispatchNumber: dispatchNumber, ...risk,
        accountingEntriesAreNotRequestCounts: true,
      }) + '\n');
    }
  };
  const native = globalThis.fetch;
  let lastTick = Date.now();
  const heartbeat = setInterval(() => {
    const now = Date.now();
    console.log(JSON.stringify({ infrastructure: 'client_event_loop', pid: process.pid, elapsedMs: now - lastTick, cpuMicros: process.cpuUsage(), at: new Date(now).toISOString() }));
    lastTick = now;
  }, 30000); heartbeat.unref();
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (/fireworks|ai-gateway|typesafe/i.test(url.href) || url.pathname === '/api/visual-need') { console.error('PAID DISPATCH STOPPED: prohibited provider/Jev'); process.exit(143); }
    if (url.pathname === '/api/chat' || url.pathname.includes('/chat/completions')) checkMetrics(true);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (local) headers.set('connection', 'close');
    const startedAt = Date.now();
    return native(input, local ? { ...init, headers } : init).catch((error: unknown) => {
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      if (local && url.pathname === '/api/chat' && ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(cause ?? '')) {
        console.error(JSON.stringify({ infrastructure: 'transport_abort', cause, elapsedMs: Date.now() - startedAt, pid: process.pid, cpuMicros: process.cpuUsage(), at: new Date().toISOString() })); process.exit(143);
      }
      throw error;
    });
  };
  checkMetrics();
  writeFileSync(resolve(registration.context, 'runs', `${label}-process.json`), JSON.stringify({ pid: process.pid, cwd: process.cwd(), head, arm, cohort, block: Number(block), label,
    startedAt: new Date().toISOString(), deployment: 'st-gpt-6-sol-h3', accountingAllowanceUsd: 20, realCapUsd: 20, stopAtUsd: 19.5,
    baselineSha256: hash(baselinePath), preregistrationSha256: hash(registrationPath), noJev: true, argv: args }) + '\n', { flag: 'wx' });
  process.argv[1] = resolve(process.cwd(), 'scripts/lecture-lab/run.ts');
  await import(pathToFileURL(process.argv[1]).href);
}
void main();
