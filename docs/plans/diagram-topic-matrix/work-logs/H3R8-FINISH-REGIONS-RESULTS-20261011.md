# H3R8 regions: incomplete 200-outcome report

**NOT READY. Required coverage regressed.** No PR, merge or production change. This protocol is stopped; no further run will use it.

Consensus counts below are right / partial / wrong / required empty. All required rows remain in each denominator.

| Set / repeat | MAIN | Branch | Gate |
| --- | --- | --- | --- |
| development 1 (40 rows) | 0/16/23/1 | 16/10/0/14 | FAIL |
| development 2 (40 rows) | 0/16/23/1 | missing | missing |
| heldout 1 (20 rows) | 0/7/9/4 | 0/5/1/14 | FAIL |
| heldout 2 (20 rows) | 0/10/8/2 | 0/4/1/15 | FAIL |

Candidate development repeat 2 aborted operationally: the original attempt saved 15 rows, and the amended replacement saved one before an unreadable/stale metric failure. Both prefixes are ungraded. Two preceding startup attempts made zero calls. The fixed secondary scope has 120 new complete outcomes and 80 reused historical MAIN outcomes. Source `689338462ae3` versus MAIN `216450fc`; original 212-example library on both. Configured concurrency 3; failed replacement effective concurrency 1. Earlier startup restrictions were explicitly amended before paid output/grade inspection; failed protocols remain failed.

A/B/consensus all fail coverage. Development1 branch right is16 and wrong0 for all; MAIN wrong is16/22/23. Fresh branch right stays0 in both repeats, wrong1–2, required empties14/15. A/B agreed124 of146 deduplicated cards; C resolved22 disputes, with one conservative three-way wrong. The same three judges scored24/24 synthetic references each: consistency, not human accuracy. All first streams froze before feedback; root viewed0 images.

The 43 candidate empties comprise40 `representation carries no readable label` and3 `solver_contradiction` failures. These live seams need repair before the new stock-runner job; source-only gates did not expose them.

API Azure token estimate: **$15.520774 of the prior $20 cap**, including discarded and interrupted attempts. Response and Azure estimates overlap and are not summed; native agent billing is unavailable. All owned evaluation processes are stopped. The new simple job has a separate $15 response-usage cap.

Lessons: reducing wrong by refusing required visuals is not enough. Gate the actual live label/authority admission path, then judge complete held-out runs. A missing repeat cannot pass; measurement machinery failures and all spent attempts stay visible.

Evidence: [results](../../../../data/diagram-eval/v1/reports/linear-regions-finish-20261011/results.json), [portable recount](../../../../data/diagram-eval/v1/reports/linear-regions-finish-20261011/recount.py). Manifest SHA256 `c9ebe9d36e99e07ea588d70815a433cd0650c2ce5b711f05e57dcf515eac3abb`. The standalone recount passed with all200 outcomes and missing repeat explicitly null.
