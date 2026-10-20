import assert from 'node:assert/strict';
import { planTurnV3, parseTurnPlanV3Content, type TurnPlanRequestOutcome } from '../../src/planners/turnPlannerV3';

// Synthetic inputs only. Drive the actual HTTP -> parse -> validation -> retry seam.
const question = 'Two resistors of 6 ohm and 4 ohm are in series. Find total resistance.';
const good = {
  schemaVersion: 'turn-plan/v3', question,
  givens: [
    { id: 'ra', symbol: 'R_a', value: 6, unit: 'ohm', provenance: 'given' },
    { id: 'rb', symbol: 'R_b', value: 4, unit: 'ohm', provenance: 'given' },
  ],
  unknowns: [{ id: 'total', symbol: 'R_total', unit: 'ohm' }],
  derived: [{ id: 'total_value', symbol: 'R_total', value: 10, unit: 'ohm', provenance: 'derived', sourceText: '6+4=10 ohm', dependsOn: ['ra', 'rb'] }],
  qualitativeClaims: [{ id: 'sum', claim: 'R_total = 10 ohm', expected: true, relatedQuantityIds: ['total_value'] }],
  lawIds: ['series_resistance'], assumptions: [], visualRequirement: 'required',
};
const bad = structuredClone(good);
bad.qualitativeClaims[0]!.claim = 'R_total = 20 ohm';
assert.ok(parseTurnPlanV3Content(JSON.stringify(good), question));
assert.equal(parseTurnPlanV3Content(JSON.stringify(bad), question), null);
const originalFetch = globalThis.fetch;
const outcomes: TurnPlanRequestOutcome[] = [];
try {
  let calls = 0;
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body); bodies.push(body); calls++;
    const repair = calls === 3 && body.includes('claim_quantity_mismatch') && body.includes('REJECTED DRAFT');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(repair ? good : bad) } }] }));
  };
  const result = await planTurnV3(question, { proxyUrl: 'http://planner.test', timeoutMs: 2000,
    onRequestOutcome: outcome => { outcomes.push(outcome); } });
  assert.ok(result, 'the existing final retry must receive its rejected draft and validation reason to repair it');
  assert.equal(result.turnPlan.derived[0]?.value, 10);
  assert.equal(calls, 3, 'feedback must not add calls');
  assert.ok(!bodies[0]!.includes('REJECTED DRAFT') && !bodies[1]!.includes('REJECTED DRAFT'), 'initial lanes stay unchanged');
  assert.ok(!JSON.stringify(outcomes).includes('R_total'), 'draft remains out of content-free telemetry');

  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] })); };
  assert.equal(await planTurnV3(question, { proxyUrl: 'http://planner.test', timeoutMs: 2000 }), null,
    'an uncorrected retry still fails closed');
  assert.equal(calls, 3);
  console.log('PASS: rejected-plan feedback repairs through the existing retry; invalid repairs remain rejected; telemetry stays clean');
} finally { globalThis.fetch = originalFetch; }
