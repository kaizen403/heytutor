# Portable result audit

The original eight-block protocol is **incomplete and NOT READY**: development candidate repeat 2 aborted with 15 saved rows. The separately registered full 40-row replacement dispatches one row at a time, with effective concurrency 1 and configured concurrency 3. Its operational difference from the captured original concurrency 3 must remain visible in every report. A complete replacement permits a 240-outcome primary recount; it does not turn the aborted original protocol into a passed matched protocol.

`recount.py` is a standalone Python 3.9+ standard-library verifier. `assemble-evidence.py` uses that verifier and copies only explicitly pinned files into a new archive. Neither program calls a model, accesses the network, opens or decodes images, launches the tutor, or resolves original machine paths. Image bytes are hashed. Source paths remain provenance strings; all verification reads archive-local files through manifest mappings.

## Frozen scopes

- `primary240`: development 40 and source-naive heldout 20, two repeats and two arms: 240 outcomes, 160 newly graded model outcomes plus 80 reused main outcomes. The original discarded 15 rows make 175 recorded new model rows. Interrupted attempts belong in the same cumulative $20 job accounting.
- `secondary200`: only after an operationally incomplete replacement, before any quality selection, the seven prospectively fixed imported complete cells: development main repeats 1/2 and candidate repeat 1; heldout main/candidate repeats 1/2. This is 200 outcomes, 120 newly graded outcomes plus 80 reused main outcomes. Development candidate repeat 2 is explicitly `null`; its pair deltas and `pass` are `null`, and `ready` is always `false`. Original and new aborted prefixes are ungraded. Recorded replacement rows must be 0–39, making recorded new model rows `135 + replacementRecordedRows` and discarded rows `15 + replacementRecordedRows`.

Every outcome remains in its fixed denominator, including source classifications outside maths, non-strict strategies, empty figures, and recorded errors. All visual requirements must be `required`. A null/absent/blank-string error counts as no error; a nonblank error remains counted. Source/tier null and blank strings use the `none` bucket. These normalizations can expose a difference from an older truthiness-based count; the saved report must match the independently recounted values.

For **each** primary cohort/repeat, **each** first judge A, first judge B and consensus must satisfy:

```text
candidate.right > main.right
candidate.wrong <= main.wrong AND candidate.wrong <= 1
candidate.required_empty <= main.required_empty + 2
```

A failed cell cannot be rescued by another repeat or cohort. C is a complete independent first stream, even though it resolves only A/B disagreements. A/B agreement stands; C supplies the majority on a disagreement; three different verdicts become `wrong`. The chosen source reason, omission arrays, vote sequence and conservative-wrong flag are verified as well as the verdict. Drawn outcome references may share a deduplicated card. Unique queue IDs, exact complete first streams, exact image-map references, and all cohort row identities are verified independently.

## Assembly inputs

The JSON schema is [evidence-manifest.schema.json](evidence-manifest.schema.json). [assembly-plan.template.json](assembly-plan.template.json) provides metadata and required role slots with placeholders, never real private paths or scores. Populate its file entries from frozen metadata. Add every queue crop as an `image` entry, plus all requested protocol, spend, settlement, runtime/source-freeze, baseline-reuse and calibration metadata. Add the raw **new** calibration streams as `calibrationGrade` entries, reference/queue as `calibrationReference`/`calibrationQueue`, and any calibration consistency artifact as `calibrationConsistency`; retain distinct original paths. Calibration support is hashed opaque evidence, so this tool does not independently calculate calibration scores.

Each planned file has exactly:

```json
{
  "path": "grades-a.jsonl",
  "role": "grade-a",
  "sourcePath": "/ABSOLUTE/original/frozen/grades-a.jsonl",
  "sha256": "<externally pinned 64 lowercase hex characters>"
}
```

The manifest adds `bytes` and `sourceSha256`; exact copied bytes keep the original source SHA. Never rewrite first freezes, queues, grades, consensus, outcome maps or result files to make their machine paths portable. Instead, record the original paths in entries and let the verifier map them locally. A source path has one manifest entry. Keep complete frozen packet, outcomes, image map, rejection diagnostics, all A/B/C first freezes/identities, raw grades, consensus freeze, raw consensus and saved results. Support files are SHA-verified; raw private run/evaluation bodies, dotenv files and API credentials are excluded. The manifest exposes original run/body hashes as provenance; it does not reconstruct omitted source run bytes or independently recompute spend from deployment metrics.

The supported first-stream metadata fields are `gradeSchema`, `queueSha256`, `gradePath`, `gradeSha256`, `identityPath`, `identitySha256`, `agentIdentity`, and optional `count`. The saved primary result schema is `shaded-regions-results/v1`. The saved secondary result schema is `secondary-report-only/v1`, with `missingDevelopmentCandidateRepeat2: null`, `secondaryScope` fixed to the template scope, and `prEligible: false` in the source secondary adapter.

For secondary mode, change the template `mode` to `secondary200`, `totalOutcomes` to `200`, add the template schema's `secondaryScope` value, change `protocolAccounting.newGradedModelOutcomes` to `120`, and add the measured `replacementRecordedRows` with the two corresponding recorded/discarded totals above. The prospective registration retains totalOutcomes 240 and separately fixes `secondaryPlan` to the exact seven-cell 200-outcome scope. Its packet freezes 200 outcomes, `secondaryReportOnly: true`, `readinessEligible: false`, and the missing cell. The authorized source adapters are `followup/verify-secondary-evidence.py` and `followup/aggregate-secondary-results.py`; aggregation requires the explicit all-first-streams flag below.

## Commands after root releases all three complete first freezes

```sh
python3 .context/h3r8/finish-regions/report-tools/assemble-evidence.py \
  --plan /ABSOLUTE/prepared/assembly-plan.json \
  --out /ABSOLUTE/new/portable-report \
  --all-first-streams-frozen
```

Assembly refuses an existing archive destination, validates pinned source bytes, establishes all three first-freeze bindings, copies files, writes the manifest and SHA sidecar, and fully verifies the temporary archive before its final rename. It prints only metadata and the manifest SHA. Record that SHA externally in the preparation/review receipt. The local sidecar is a convenience, not an independent trust anchor: a party able to change both manifest and sidecar can replace both.

```sh
python3 /ABSOLUTE/portable-report/recount.py \
  --archive /ABSOLUTE/portable-report \
  --manifest-sha256 '<SHA recorded outside the archive>'

python3 /ABSOLUTE/portable-report/recount.py \
  --archive /ABSOLUTE/portable-report \
  --manifest-sha256 '<SHA recorded outside the archive>' \
  --metadata-only
```

Include `recount.py` in the archive as role `helper` if it should run there; otherwise invoke this helper with `--archive`. The first command exposes all independent per-cohort/repeat counts and gates. The second omits quality counts, consensus statistics and readiness from stdout. Both perform the same full verification. Unmanifested files, path escapes, symlinks, duplicate JSON object keys, missing/duplicate rows, forged consensus, mismatched source references and changed fixed gates are rejected. Metadata verification means the audit is internally consistent; it does not authorize a PR, merge or production change.

```sh
python3 .context/h3r8/finish-regions/followup/aggregate-secondary-results.py \
  --preregistration /ABSOLUTE/followup/preregistration.json \
  --packet /ABSOLUTE/followup/secondary-packet \
  --out /ABSOLUTE/new/secondary-results.json \
  --all-first-streams-frozen
```

## Synthetic-only preparation check

```sh
cd .context/h3r8/finish-regions/report-tools
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -q test_offline.py
```

The suite builds temporary artificial archives under this directory and removes them. It exercises primary and secondary scopes, strict gate boundaries and pool-rescue rejection, partial first streams, consensus selection, forged reasons/maps, changed SHA pins, privacy/path controls and successful relocation after removing original synthetic machine files. It uses synthetic byte strings instead of images. No actual quality files, calibration scores, question bodies, model calls or paid work are involved.
