# Topic readiness (policy of 4 October 2026)

The owner revised the execution policy on 4 October 2026 for the nine topic
queue in the [wind-down log](work-logs/wind-down-HEY83-20261003.md). Two
milestones are now tracked separately. Neither erases the other, and neither is
written into the old ledger as something it is not.

## TOPIC-READY for a declared scope

This is the primary working milestone. A topic is READY for a declared scope
when all five hold:

1. **Integrated.** The implementation runs in the normal application path on the
   consolidated handoff branch. A kernel, a private patch or a specially cued
   fixture does not count.
2. **Representative cases.** Three to five realistic cases chosen from the
   source contract exercise the supported core behaviour, with independently
   derived expected numbers and geometry, plus the relevant rejection or
   degeneracy controls. Cases are not limited to ones already known to pass.
3. **Student render.** At least one student facing example is actually rendered
   and visually inspected, including the narration, work area writing and
   reveal interaction that apply to it.
4. **Checks green.** The relevant existing tests, typechecks and lint pass, and
   no known incorrect certification remains inside the claimed scope.
5. **Scope recorded.** Supported scope, remaining variants, unsupported inputs
   and known gaps are written down. Unsupported cases decline honestly instead
   of rendering a misleading figure.

Shared authenticated save, reopen and whole replay is verified once per
coherent integration batch. Topic specific payload and persistence checks are
added, and the affected lifecycle checks rerun, whenever serialization,
restoration, scene data or replay behaviour changes. The full infrastructure
qualification is not repeated for every variant.

## FULLY-CERTIFIED

This is the original exhaustive row contract in [progress.md](progress.md): every
required variant, the holdout and negative sets, explicit native obligations
(for example the Matrices indexed 2023 q5 full stem and options sentinel, and
the symbolic native UCM source), and the full student lifecycle, independently
accepted. Only this milestone may set `state=accepted` in
[topic-progress.csv](topic-progress.csv).

FULLY-CERTIFIED requirements do not block READY work, unless they expose a
correctness defect inside the claimed READY scope. Known native gaps stay
visible in the READY record; an authored profile is never presented as exam
bank coverage.

## Ledger rules

- `topic-progress.csv` keeps its existing states. A READY topic is never written
  as `accepted`. Its row may move to `verification_pending` with the READY
  record as `evidence_ref` and the remaining certification obligations in
  `remaining_variants`.
- Old evidence, the zero accepted counters and the historical baselines in
  [progress.md](progress.md) stay intact.
- READY and FULLY-CERTIFIED are reported as two separate counts.

## Current counts

READY: 2. FULLY-CERTIFIED: 0.

6 October continuation: one new scoped READY, `maths|5|binomial-theorem`, after fresh authored coefficient240 live review and actual saved whole-replay pixel review on7e92167c. The two previously omitted table rows now restore. Details and exclusions: [Wave3 finite-binomial READY evidence](work-logs/w3-finite-binomial-ready-20261006.md). No full chapter, native-bank, FULLY-CERTIFIED or accepted-ledger count changed.

Wave one, 6 October 2026: reviewed implementation is integrated through
`c6b41c4bf20cb581f673f2a8763827cde58db727`. No new topic met all five criteria.
Real student runs exposed failures inside the proposed scopes despite passing
bounded offline gates. The accepted ledger remains untouched. See the
[wave-one report](work-logs/w1-wave-one-20261006.md) and
[runtime evidence](work-logs/w1-runtime-audit.md); generic harness `ok: true`
does not establish figure, teaching or lifecycle correctness.

| Topic | READY scope | Integrated at | Evidence | Remaining for FULLY-CERTIFIED |
| --- | --- | --- | --- | --- |
| `maths\|3\|matrices-and-types` | **not ready:** normal order/entry case is text only; AB/BA renders correct products and names | c6b41c4b | source, parser, focus and writing fixes reviewed; final normal case1 and AB/BA student captures in wave-one runtime log | case1 full-IR admission/fallback; affected lifecycle; 17 variants, native q5 full stem/options and holdouts |
| `maths\|10\|point-to-line-distance` | not ready: source line lineage open | 1d81d1f8, 29706b10 (layers only) | | lineage, all tier admission, student lifecycle
| `maths\|10\|section-formula` | **not ready:** current SF3 renders A/B and omits required P=(7,8) | c6b41c4b | full-IR and source-name/label-channel corrections reviewed; current SF3 live/save/reopen/replay capture | actual graph includes an extra line entity and source family declines; prevent incomplete planner figure; realistic variants and native/holdout checks |
| `maths\|10\|circle-standard-form` | **READY** (4 Oct 2026): one circle per stem, read from `(x-h)^2+(y-k)^2=r^2` or centre and radius, integer, decimal or simple fraction values, optional named point on, inside or outside; tier `qualitative_verified`; a forged trace under the source label is rejected; r^2 <= 0, an xy term, unequal square coefficients and unreadable equations decline | c876c08b (904cbf74, 37606d3f, a1202b92) | reviewer PASS with an independent oracle; `verify-circle-standard-ready.ts` (184 checks); student run S3 rendered and inspected on batches 4 and 5/6a (plain math, FOCUS resolved; runtime/circle.md); save, Postgres restart, reopen and whole replay exact on batch 4 | two circles in one stem unbound; centre and radius not drawn when the equation label fits; restore/replay race correction now landed (24160e4e); remaining affected final-batch lifecycle limits are recorded in the wave-one report; native and holdout items not run |
| `maths\|10\|circle-general-form-radius-and-centre` | **not ready:** proposed live fix c8814e67 failed independent review and was excluded | 904cbf74 (existing engine layer) | wave-one live review: blanket obligation bypass and Q renamed P | safe live admission and normal student render; symbolic coefficients, holdouts, native stems |
| `physics\|2\|suvat-equations` | not ready: archetype reader blocked | 1033163e, f0b98b9f (guard only) | | 2 preserved compiler gaps, archetype fraction defect
| `physics\|2\|relative-velocity` | **not ready:** normal train question produces no figure | 9031aac1 | reviewed reader/role/source-trust fixes; actual 72/54 km/h student turn | support actual "catch B and distance travelled" request and report source program to visual selection; native/holdout coverage |
| `physics\|2\|uniform-circular-motion` | **not ready:** stone restoration rejects tiny recomputation drift and teaching has false arithmetic; car planner times out | c6b41c4b | reviewed identity/precision/JSONB fixes; current stone/car real student captures | deterministic source regeneration across persistence, truthful intermediate arithmetic/tangent narration, planner fallback; fractions, stated position and symbolic native source |
| `physics\|12\|ohms-law-and-resistance` | **not ready:** both normal numeric meters/tree questions have no circuit | 9031aac1 | reviewed bounded numeric source program; actual full-IR student captures | generic full-IR body/dimension obligations and intermediate dependency authority; affected student lifecycle; native/holdouts, excluded internal-R and concept gaps |

| `maths\|5\|binomial-theorem` | **READY** (6 Oct2026), declared authored finite rational single-variable expansion/coefficient profile, bounded nonnegative integral exponents and exact nonmetric coefficient table | 7e92167c | independent source/public ESM cases/negatives,182+455 normal boundaries, fresh student240 and ownPGrestart/freshAuth whole replay; [evidence](work-logs/w3-finite-binomial-ready-20261006.md) | native1113 whole-student timeout; symbolic independent a,b, general/middle/greatest-term and other chapter rows not qualified; holdouts/full frozen contract/provider replay voice qualification pending |

Execution log: [claude-execution-20261004.md](work-logs/claude-execution-20261004.md).
