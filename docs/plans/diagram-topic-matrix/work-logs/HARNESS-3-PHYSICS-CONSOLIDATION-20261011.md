# Harness 3 physics consolidation: negative result

The physics prompt experiment is parked. No isolated change passed the full
confirmation gate. PR #125 remains recoverable on its source branch; PRs #124,
#125, #128, #130, #131 and #133 are closed or being closed as this report is
published. No accepted topic count changes, PR merge or production change came
from this experiment.

## Frozen confirmation

The measured main was `0e0712edf1f14710760795cb526ee5c0fbbcd669`. The geometry-only
candidate was `ea40d70643c0936d88ac0f828f55df219782acc2`, with the identical tree
published at PR #125 head `cdd65af096ae1bc99f8ee07340668e363f54b881`. Both builds
used locked source, examples, environment and provider settings. There was no
source or example tuning after the fresh set was called.

Two new main-versus-candidate repetitions covered all frozen 76 physics rows and
all 50 independently authored held-out required physics rows: 504 outcomes.
Empty figures and classification misses remained in the denominator. Valid arms
had zero run errors. Two whole transport-aborted prefixes were archived ungraded
and included in spend; individual outcomes were not selectively retried.

| Set | Repeat | N per arm | Drawn main → candidate | Right | Partial | Wrong | Empty |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen physics | 1 | 76 | 66 → 65 | 7 → 10 | 46 → 39 | 13 → 16 | 10 → 11 |
| Frozen physics | 2 | 76 | 62 → 61 | 9 → 9 | 41 → 39 | 12 → 13 | 14 → 15 |
| Fresh physics | 1 | 50 | 35 → 31 | 2 → 2 | 25 → 18 | 8 → 11 | 15 → 19 |
| Fresh physics | 2 | 50 | 33 → 40 | 1 → 2 | 24 → 31 | 8 → 7 | 17 → 10 |

These are blind LLM consensus judgments, not human gold. First graders agreed on
316 of 389 unique rubric/PNG cards; an independently frozen third full pass
resolved 73 conflicts, with two three-way disagreements conservatively wrong.
All 12 first-grade files and image hashes were validated before unblinding.
Finished judgments were not revised. Both first graders also failed the complete
gate: strictly more right and no more wrong in every set and repetition. Failing
repetitions were not pooled away.

Geometry alone passed selection on the original 76 training rows: consensus
right 7 → 9 and wrong 13 → 10, with drawn 60 and empty 16 unchanged. That gain
did not survive confirmation. Directions raised wrong; isolated engine and
renderer increments did not produce a robust right gain under both first
graders and consensus. They were excluded. The original geometry and direction
classes are not claimed solved.

## Lessons learned

More complete requests reduced some geometry omissions but also exposed wrong
directions, topology, polarity and dimensional annotations. Narration-only facts
did not supply missing board ink. Planner sampling varied enough that the fresh
set moved from drawn 35 → 31 in one comparison to 33 → 40 in the next, exceeding
the apparent prompt effects. A selection gain from a prompt tweak therefore
needed repeated held-out confirmation, immutable blind judgments and every
empty or misclassified row in the denominator; this experiment supplied no
repeatable safe improvement. The next work targets deterministic constructions
and independently checkable proofs instead of further physics prompt tuning.

## Maths replay and parked #124

The recorded maths right count did fall from 19 to 13. Replaying all 156 captured
candidates and 58 committed figures under the exact pre/post-#119 builds found
identical admission, geometry, labels and complete rendered primitives. Eight
right-to-partial pairs involved six planner omissions and two facts supplied as
narration rather than ink. Sampling versus prompt-driven planner variation
remains unresolved; the replay did not justify a new rendering fix.

PR #124's separately recorded 22-row comparison was also negative: drawn stayed
13, right changed 6 → 3, wrong 0 → 1, and empty stayed 9. Its gates and source
branch remain recoverable, but it has no demonstrated safe held-out gain.

## Verification, spend and retained evidence

All five package builds, tutor-core typecheck, the 162-check geometry contract
and scoped lint passed. Passing source gates did not override the failed
rendered-figure safety gate. Another owner's main changes did not alter the
frozen measured builds.

Cumulative attributable Azure estimate was **$175.320548**, including the earlier
$57.648238 and all later paid calls and aborted prefixes. It represents
36,484,014 prompt and 10,235,252 output tokens at the agreed $2/$10 per million;
cached inputs were conservatively priced as uncached. Metrics settled across
eight stable observations. This is an estimate, not an invoice. Native agent/CLI
billing was unavailable.

The complete local report and immutable artifacts remain under
`.context/h3r5/consolidation/`: `REPORT.md`, `final-results.json`,
`final-judging/consensus/consensus-freeze.json`, the 12 packet first-grade freezes,
`FINAL-FAILURES.md`, `final-spend.json` and `root-final-verification.json`.
Consensus SHA-256:
`9e596078f37129cdfbd7afffb7fdecaceac41f1dfc058e2e96acad4b45e9c104`.
The maths replay remains under `.context/h3r4/maths/REPORT.md`.
