// Offline-only eight logical cells, six paid full arms and two reused MAIN arms. No root image inspection.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = key => argv[argv.indexOf(`--${key}`) + 1];
if (argv.includes('--help')) { console.log('make-opaque-packets.mjs --preregistration FILE --out NEW_NEUTRAL_DIRECTORY [--execute-render]'); process.exit(0); }
for (const key of ['preregistration', 'out']) if (!argv.includes(`--${key}`)) throw Error(`Missing --${key}`);
const registrationPath = path.resolve(flag('preregistration'));
const registration = JSON.parse(fs.readFileSync(registrationPath, 'utf8'));
const context = registration.context;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = filename => hash(fs.readFileSync(filename));
const readLines = filename => fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).map(JSON.parse);
const secondary = argv.includes('--secondary-report-only');
const expectedOutcomes = secondary ? 200 : 240;
const completedPath = path.join(context, 'completed-arms.json');
const completionPath = path.join(context, 'all-arms-complete.json');
let completed;
if (secondary) {
  if (fs.existsSync(completionPath) || !fs.existsSync(path.join(context, 'whole-arm-abort.json'))) throw Error('Secondary report requires an aborted incomplete prospective replacement');
  const imports = JSON.parse(fs.readFileSync(registration.assets.imports.path, 'utf8'));
  if (fileHash(registration.assets.imports.path) !== registration.secondaryPlan.importsSha256 || registration.secondaryPlan.outcomes !== 200 || registration.secondaryPlan.logicalCells !== 7 || registration.secondaryPlan.ready !== false || registration.secondaryPlan.prEligible !== false) throw Error('Changed preregistered secondary scope');
  completed = { preregistrationSha256: fileHash(registrationPath), arms: imports.arms };
} else {
  if (!fs.existsSync(completionPath)) throw Error('All forty replacement rows and seven imported cells required before primary packet');
  const completion = JSON.parse(fs.readFileSync(completionPath, 'utf8'));
  completed = JSON.parse(fs.readFileSync(completedPath, 'utf8'));
  if (completion.preregistrationSha256 !== fileHash(registrationPath) || completed.preregistrationSha256 !== fileHash(registrationPath) || completion.completedSha256 !== fileHash(completedPath) || completion.outcomes !== 240 || registration.totalOutcomes !== 240 || completion.newModelOutcomes !== 160 || completion.reusedMainOutcomes !== 80) throw Error('Changed primary completion identity');
}
const expectedCells = ['development', 'heldout'].flatMap(cohort => [1, 2].flatMap(rep => ['main', 'candidate'].map(arm => `${cohort}|${rep}|${arm}`))).filter(key => !secondary || key !== 'development|2|candidate');
if (completed.arms.length !== expectedCells.length || new Set(completed.arms.map(a => `${a.cohort}|${a.rep}|${a.arm}`)).size !== expectedCells.length || !expectedCells.every(key => completed.arms.some(a => `${a.cohort}|${a.rep}|${a.arm}` === key)) || completed.arms.some(a => a.n !== registration.cohorts[a.cohort].n)) throw Error('Incomplete or selective preregistered cell matrix');
for (const asset of Object.values(registration.assets)) if (fileHash(asset.path) !== asset.sha256) throw Error('Frozen asset changed');
for (const helper of Object.values(registration.helpers)) if (fileHash(helper.path) !== helper.sha256) throw Error('Frozen measurement helper changed');
execFileSync('python3', [path.join(context, secondary ? 'verify-secondary-evidence.py' : 'verify-completed-evidence.py'), '--preregistration', registrationPath], { stdio: 'pipe' });
const output = path.resolve(flag('out'));
if (fs.existsSync(output)) throw Error('Refuse to replace a frozen packet');
if (!argv.includes('--execute-render')) { console.log(JSON.stringify({ ready: true, arms: expectedCells.length, outcomes: expectedOutcomes, render: false, secondaryReportOnly: secondary })); process.exit(0); }

const baselineRoot = registration.builds.main.worktree;
const req = createRequire(path.join(baselineRoot, 'apps/tutor/package.json'));
const sharp = req(req.resolve('sharp', { paths: [req.resolve('next/package.json')] }));
const assets = registration.assets;
const evalRows = Object.entries(registration.cohorts).flatMap(([cohort, spec]) => {
  const rows = readLines(assets[spec.evalAsset].path);
  if (rows.length !== spec.n || new Set(rows.map(r => r.id)).size !== spec.n || rows.some(r => !spec.rowIds.includes(r.id))) throw Error('Wrong frozen cohort evaluation denominator');
  return rows;
});
if (evalRows.length !== 60 || new Set(evalRows.map(r => r.id)).size !== 60) throw Error('Cross-cohort row collision');
const rubrics = new Map(evalRows.map(row => [row.id, Object.fromEntries(Object.entries(row).filter(([k]) => !['id', 'topic_id', 'source'].includes(k)))]));
const images = new Map(), outcomes = [], diagnostics = [], salt = crypto.randomBytes(32);
fs.mkdirSync(path.join(output, 'images'), { recursive: true });
const parentDirectory = path.join(output, 'parent'); fs.mkdirSync(parentDirectory);
const cleanDirectory = path.join(parentDirectory, 'clean-boards'); fs.mkdirSync(cleanDirectory);
const cleanPngByRun = new Map(), cleanSvgs = [];
const records = [];
for (const arm of completed.arms) {
  const root = path.resolve(arm.round);
  const files = fs.readdirSync(path.join(root, 'runs')).filter(s => s.endsWith('.json'));
  const parsed = files.map(name => { const file = path.join(root, 'runs', name); return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) }; });
  if (parsed.length !== arm.n || new Set(parsed.map(p => p.record.probeId)).size !== arm.n || parsed.some(p => !registration.cohorts[arm.cohort].rowIds.includes(p.record.probeId))) throw Error('Incomplete or foreign arm');
  for (const item of parsed) {
    records.push({ ...item, arm, root });
    if (item.record.diagram.committed !== true) continue;
    const svg = fs.readFileSync(path.resolve(root, item.record.diagram.svg), 'utf8');
    let removed = 0;
    const clean = svg.split('\n').filter(line => { if (/^<text x="20" y="(?:28|48)" /.test(line)) { removed++; return false; } return true; }).join('\n');
    if (removed !== 2) throw Error('Known lab header format changed; preserve every engine mark');
    const target = path.join(cleanDirectory, hash(item.file) + '.svg');
    fs.writeFileSync(target, clean, { flag: 'wx' }); cleanSvgs.push(target); cleanPngByRun.set(item.file, target.replace(/\.svg$/, '.png'));
  }
}
if (cleanSvgs.length) execFileSync(registration.node.path, [path.join(baselineRoot, 'apps/tutor/scripts/lecture-lab/svg2png.mjs'), ...cleanSvgs], { stdio: 'pipe' });
for (const { file, record, arm, root } of records) {
  const rubric = rubrics.get(record.probeId), drawn = record.diagram.committed === true;
  let cardId = null, cropSha256 = null;
  if (drawn) {
    const png = cleanPngByRun.get(file); if (!png || !fs.existsSync(png)) throw Error('Missing clean original-body raster');
    const crop = await sharp(png).extract({ left: 400, top: 0, width: 760, height: 700 }).png().toBuffer();
    cropSha256 = hash(crop);
    const rubricSha256 = hash(canonical(rubric)), key = `${rubricSha256}|${cropSha256}`;
    if (!images.has(key)) {
      const id = 'figure-' + crypto.createHmac('sha256', salt).update(key).digest('hex').slice(0, 24);
      const imagePath = path.join(output, 'images', id + '.png'); fs.writeFileSync(imagePath, crop, { flag: 'wx' });
      images.set(key, { card: { id, ...rubric, cropped_png: imagePath, figureSha256: cropSha256 }, rubricSha256, cropSha256, references: [] });
    }
    const image = images.get(key); cardId = image.card.id;
    image.references.push({ cohort: arm.cohort, arm: arm.arm, rep: arm.rep, rowId: record.probeId, runPath: file,
      cleanBodySvgSha256: fileHash(png.replace(/\.png$/, '.svg')), cleanBodyPngSha256: fileHash(png) });
  }
  outcomes.push({ cohort: arm.cohort, arm: arm.arm, rep: arm.rep, rowId: record.probeId, drawn, cardId, cropSha256,
    figureNeed: rubric.figure_need, strategy: record.productionStrategy ?? null, error: record.error ?? null,
    tier: record.diagram.tier, source: record.diagram.figureSource, emptyCause: record.diagram.emptyCause,
    runPath: file, runSha256: fileHash(file) });
  // Full detailed diagram diagnostics stay parent-only. Never enter neutral cards,
  // grader directories, filenames, or any judge-visible failure/status hint.
  diagnostics.push({ cohort: arm.cohort, arm: arm.arm, rep: arm.rep, rowId: record.probeId, runPath: file,
    runSha256: fileHash(file), diagram: record.diagram, solver: record.solver ?? null,
    otherDetailedDiagnostics: Object.fromEntries(Object.entries(record).filter(([key]) => /reject|diagnostic|failure/i.test(key))) });
}
if (outcomes.length !== expectedOutcomes || new Set(outcomes.map(r => `${r.cohort}|${r.rep}|${r.arm}|${r.rowId}`)).size !== outcomes.length) throw Error('Lost all-row denominator');
const cards = [...images.values()].map(i => i.card).sort((a, b) => hash(salt.toString('hex') + a.id).localeCompare(hash(salt.toString('hex') + b.id)));
const lines = (filename, rows) => fs.writeFileSync(filename, rows.map(JSON.stringify).join('\n') + (rows.length ? '\n' : ''), { flag: 'wx' });
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
lines(path.join(output, 'queue.jsonl'), cards);
lines(path.join(parentDirectory, 'outcomes.jsonl'), outcomes);
lines(path.join(parentDirectory, 'rejection-diagnostics.jsonl'), diagnostics);
lines(path.join(parentDirectory, 'image-map.jsonl'), [...images.values()].map(({ card, ...rest }) => ({ id: card.id, ...rest })));
write(path.join(parentDirectory, 'salt.json'), { salt: salt.toString('hex') });
write(path.join(output, 'freeze.json'), { schema: 'shaded-regions-opaque-packet/v1', gradeSchema: registration.gradeSchema, manifestMode: secondary ? 'secondary200' : 'primary240',
  createdAt: new Date().toISOString(), preregistrationSha256: fileHash(registrationPath), cohorts: Object.fromEntries(Object.entries(registration.cohorts).map(([name, spec]) => [name, spec.n])), outcomes: outcomes.length,
  cards: cards.length, queueSha256: fileHash(path.join(output, 'queue.jsonl')), outcomesSha256: fileHash(path.join(parentDirectory, 'outcomes.jsonl')),
  imageMapSha256: fileHash(path.join(parentDirectory, 'image-map.jsonl')), crop: { left: 400, top: 0, width: 760, height: 700 },
  rejectionDiagnosticsSha256: fileHash(path.join(parentDirectory, 'rejection-diagnostics.jsonl')),
  newModelOutcomes: secondary ? 120 : 160, reusedMainOutcomes: 80, prospectiveReplacement: true, thisFollowupPaidOutcomes: secondary ? 0 : 40, importedOutcomes: 200, abortedPrefixExcluded: true, secondaryReportOnly: secondary, originalProtocolStatus: 'incomplete_not_ready', readinessEligible: !secondary, missingCell: secondary ? registration.secondaryPlan.missingCell : null,
  identityReuse: 'complete semantic rubric plus exact native PNG', rootImageViews: 0, qualityUnblinded: false });
console.log(JSON.stringify({ packet: output, outcomes: outcomes.length, cards: cards.length, rootImageViews: 0, qualityUnblinded: false }));
