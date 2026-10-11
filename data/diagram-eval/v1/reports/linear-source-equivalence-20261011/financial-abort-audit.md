# Financial/control audit of the H3R7 repeat-2 abort

The repeat-2 stop was correct under the frozen conservative admission guard. The inspected records do not demonstrate a double-counting accounting defect. The completed Azure token estimate being lower than the admission bound is consistent with unresolved usage allowances and reserved exposure; it does not invalidate the stop. The second repeat remains incomplete at 37/40. No grade, readiness, retry or protocol-relaxation inference is made.

Reviewer: `/root/linear_safety_review`, 11 October 2026. This was a local read/hash audit, with only this report written. No controller, watcher, model/API request, service, network query, live process probe, source edit or protocol execution was started. No image was viewed, no grade or source/eval question was inspected, and no environment contents were read. Protected assets were verified by opaque byte hashes without parsing their content.

## Why admission stopped

The preregistration fixes $13.00 as the new-job cap, $12.50 as the admission stop threshold, $30.00 as the cumulative cap, and $16.960470 as prior-job Azure usage. `budget_guard.py` implements:

```text
exposure = max(current Azure estimate,
               settled earlier Azure + later known response usage + later unresolved allowances)
           + current checkpoint reservations
mayDispatch = exposure < 12.50 and 16.960470 + exposure < 30.00
```

The first-repeat quiescent anchor was captured after eight distinct observations with identical deployment token counters and zero checkpoint reservations. It binds first-repeat Azure usage of $4.232566, replacing that repeat's closed response-usage/allowance uncertainty for admission purposes. The first-repeat response totals are not added again after this anchor.

| Admission component | USD | Interpretation |
| --- | ---: | --- |
| Settled first-repeat Azure anchor | 4.232566 | Earlier exclusive-deployment token estimate, represented once |
| Unreconciled second-repeat known response usage | 3.677913 | Response-based estimate |
| Unreconciled second-repeat unresolved allowance | 3.483072 | Missing/incomplete usage uncertainty, not a charge |
| Second-repeat checkpoint reservations | 1.145732 | Recorded outstanding exposure at abrupt stop |
| Conservative admission exposure | **12.539283** | $0.039283 above the frozen $12.50 threshold |

Second-repeat closed usage plus allowance is exactly $7.160985. The closed subtotal plus earlier anchor is $11.393551; adding reservations produces $12.539283. The final Azure estimate, $8.391410, is below this subtotal, so the `max` branch selects the conservative response/anchor bound. Exposure plus prior-job usage is $29.499753; therefore the $12.50 new-job stop threshold was binding, rather than the $30 cumulative threshold.

`runs/h3r7-r2-candidate.log` explicitly records `PAID DISPATCH STOPPED: conservative finite-budget exposure exhausted`. The next attempted dispatch is refused before an allowed budget observation is appended. The 305 prior dispatch-budget observations all have `mayDispatch=true`; their highest recorded exposure is $12.479821. The last allowed observation at 03:38:20.366Z had exposure $12.258668 and metric observation age about 13.6 seconds, within the 150-second frozen freshness requirement. These accounting observations are not a count of paid/model calls.

The controller records whole-arm abort at 03:38:20.575716Z, `labExit=143`, 37 saved rows, incurred spend retained and the prefix ungraded. The separate abort artifact binds `rep=2`, `sourceTuning=false` and `selectiveRetry=false`. The checkpoint itself retains `stoppedForBudget=false`: the outer controlled wrapper exited before the inner lab ledger could rewrite that flag or close its reservations. That flag does not contradict the explicit wrapper stop reason.

## Final settled estimate and preserved uncertainty

Eight distinct stable observations from 03:40:12.812581Z through 03:42:04.053281Z have identical counters. The later confirmation at 03:43:31.774208Z reports the same $8.391410 estimate. Baseline, preregistration and settlement hashes match their references in `spend.json`.

```text
2,214,635 prompt tokens * $2 / 1,000,000
+ 396,214 generated tokens * $10 / 1,000,000
= $8.391410 new-job Azure token estimate
$16.960470 prior-job estimate + $8.391410 = $25.351880 cumulative estimate
```

Those estimates are within the stated $13 new-job and $30 cumulative caps. They are rate-based deployment-token estimates, with cached input conservatively priced as uncached, rather than invoices. They are reported separately from response accounting because both describe the same calls.

All response ledgers remain preserved: $7.470119 known response usage and $7.411516 unresolved allowance. The first-repeat ledger has 16 unresolved entries and the second has 14; their allowance sums match their respective checkpoint totals. Neither these allowances nor the $1.145732 reserved amount are additional settled charges. The raw whole-ledger sum cannot replace the anchored admission formula without counting the first repeat's already reconciled uncertainty again.

The second-repeat checkpoint retains **five stale reservations totaling $1.145732**. The ownership receipts show the owned APIs stopped and the watcher terminated after settlement. These five checkpoint entries are historical unclosed accounting state, not evidence of five live paid requests, five confirmed model requests or five charges. Some reservations may correspond to requests already sent, requests interrupted before completion, or the request refused by admission; the preserved checkpoint does not identify each outcome. This uncertainty is not erased, converted to zero usage, or attributed as a new charge.

`metrics/latest.json` still reports `stopRequired=true` and the historical reservation amount because admission accounting was not reconciled after the abrupt stop. Stable Azure settlement is an observed estimate, not permission to release stale reservations or resume the incomplete repeat. No ledger or guard was altered in this audit.

## Freeze and ownership checks

All **18 frozen helpers** and **44 frozen assets** match their preregistered SHA256 hashes. The hash-bound preregistration contains their exact paths and expected hashes. The evaluation, reuse, exclusions, replay, calibration and author assets were only hashed; their questions, images, grades and oracle content were not inspected.

All **1,615 non-environment main files** and **1,627 non-environment candidate files** in the frozen build manifests match. The three environment files in each manifest were deliberately excluded from reads. Both worktrees have empty tracked status and their current HEAD/tree identities equal the preregistration:

| Build | HEAD | Tree |
| --- | --- | --- |
| Main | `216450fcf7e5a88d41341a9e79871e1b9d198c72` | `076cc0db4344541fd25cff39233fc8f1930203f8` |
| Candidate | `054cdbad0ad0109e88947c4f886ce7d906f2ccb2` | `7c698c1c2da805595dc3f2b605fbaf83d1d31271` |

The four reviewed source hashes also equal the independent pre-measurement review freeze:

| Candidate source | SHA256 |
| --- | --- |
| `linearRegionSource.ts` | `a3f036d9e25dd873f613f3c12e4c65d463644c6dd062eeb746860fd51539ff2e` |
| `linearSourcePoints.ts` | `fddc3b69aee6e8d724a45220ee57e4a512f739b8946b866e8f205fe9f5a318d7` |
| `linearRegionGeometry.ts` | `320a12d63d8bce0553b8fc577ae17bf724b7d3436849b793c5b9489a7f56338e` |
| `compiler.ts` | `3f778f1614df0de5683c0bbdcbde38ab7433bdd961ed71666f5c28303bfb957b` |

`owned-watcher-stop.json` identifies only owned watcher PID 5213, signal SIGTERM, final settlement frozen and `foreignProcessesTouched=false`. `process-ownership-after.json` records ports 3530/3533 not listening, owned API processes stopped, reservations preserved, and H4 untouched. It retains H4's port 3600 listener with PID 24070. Paid-event server identities belong to the candidate's owned port 3533. These receipts are consistent with H4 being left alone; no H4 command, file edit or process probe was performed by this reviewer.

## Limitations

This audit verifies local preserved records and present file hashes. It does not independently query Azure, verify an invoice, expose native-agent/CLI billing, or identify per-request outcomes behind missing response usage and stale reservations. Exclusive deployment ownership is the recorded assumption supporting token attribution. The precise failed budget snapshot was not appended as an allowed dispatch; the threshold reconstruction uses the preserved anchor/checkpoint state, final admission fields and explicit wrapper stop message. Current hashes cannot rule out transient changes later reverted. Environment contents and the broader H4 filesystem/process history were intentionally not inspected; H4's untouched status rests on the scoped ownership receipts. The final confirmation's `stableCount=1` is a later one-shot confirmation, while the eight-observation settlement evidence is preserved separately.

## Exact audit input hashes

All paths below are relative to `.context/h3r7/source-equivalence`.

| Artifact | SHA256 |
| --- | --- |
| `preregistration.json` | `071a6c9d731768b28d2d536463a470b29ba4fc434779cb948471e0dbd408d266` |
| `budget_guard.py` | `5238beb526e36cf280612c30773fc41bccdf3d03c75f0761ecc942782f6fe619` |
| `controlled-run.ts` | `a5ef7e3c45761a2642230c59ca0075f78db7314273b2f8f208d3d3b8cba6b36b` |
| `measurement_core.py` | `1517b15c7c8e609aa4db6701cd2e4a07bb0dc5f350b4c16ea28e5a523cf75a0f` |
| `whole-arm-abort.json` | `562876e8b674302b564f9ea5e1242c59a85e5349a3c5d0f57bb7acfd4b7d5722` |
| `paid-events.jsonl` | `4a1027549a911aff9a0c54c56c147760bcf870f8437e370c6fe6fe9b3d520bb6` |
| `spend.json` | `fbe495ca4bfb078abccc35e6efc9207273e67362b8db7338e0aca1245fd02b7f` |
| `metrics/final-settlement.json` | `cdc1ec359601ae9cc2a832be95d1836e31055467ce9cc3b002df28485aa92fb4` |
| `metrics/latest.json` | `2f36eed51eb45719d0d8c9312b3bb95b02a5767f7ed599ff524e929a5bd85094` |
| `live-outputs/r1-candidate/spend-checkpoint.json` | `9ac0f121c4e885563d52ab9db0795786a0a5be98b6fca579d4523cec3451b174` |
| `live-outputs/r2-candidate/spend-checkpoint.json` | `ec114666013542c117e470431430792b2a40f3f396900c2cb91c7b0fd6d779f9` |
| `nonpaid/owned-watcher-stop.json` | `fe1b143d70f89b0efaf1aadd9399bf123f7e797cc2eb697ee8d7632920e4efb5` |
| `nonpaid/process-ownership-after.json` | `6373c5cc316f9ff3c1a98b27d632a0544d73725f4a81cac25da0fe284616d7e7` |
| `nonpaid/final-confirmation.log` | `3af263513d470994cf85d821fa4d31fdcbce1db15e49ab493f22e9fa9b5e7b11` |
| `metrics/baseline.json` | `80aeb526d7aa0ebfb02faed39765b1d9107348e6951c9c06e0b2ba485b38bd2f` |
| `metrics/budget-anchor.json` | `03a3acaeb8c724e8755b214d46569b1e71117775b592af4af95b1cb1731e032c` |
| `metrics/budget-anchor-01.json` | `ff4f6461e103eee3a304ea5490b3c904fbf8492966bf63bd281c0fa84b22a7a2` |
| `runs/h3r7-r2-candidate-dispatch-budget.jsonl` | `62348fe8879675395de0af118e2e25d28bc248f07fee5f47f63ac6b49fbe7c2a` |
| `runs/h3r7-r2-candidate.log` | `8c07c73c7d5c7c4cef1ae6ad39342cd3b17c95729a879cbc8b41308dbff03af0` |
