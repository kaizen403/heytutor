# Linear-region experiment evidence

These are post-unblinding copies from the frozen 11 October 2026 experiment. See [the complete report](../../../../../docs/plans/diagram-topic-matrix/work-logs/H3R6-SHADED-REGIONS-RESULTS-20261011.md).

`provenance.json` records original and copied SHA256 identities. First A/B/C grades, consensus and calibration consistency are byte-identical copies. Only path locators changed in `summary.json` and `outcomes.jsonl`; all original counts, verdicts, reasons, row IDs and run/image hashes are preserved. All 160 outcomes remain. Raw call records, preregistration, native images and immutable private builds remain in `.context/h3r6/shaded-regions/` and are not included in this portable bundle.

The eval was frozen before implementation and model calls. It is now an exposed evaluation artifact and must not be reused as fresh held-out evidence after tuning. No code or example change used its outcomes in this PR.

Run the independent portable recount without model calls or images:

```sh
python3 data/diagram-eval/v1/reports/linear-regions-20261011/recount.py
```

This validates copied-file digests, all-row denominators, strict maths execution, first/consensus counts and the repeat-by-repeat readiness rule. It also prints family and topic/exam breakdowns. It does not validate mathematical correctness of a grade or replace image judgment. Candidate required empties are 27/40 and 25/40; B retains one newly wrong figure in repeat 2. Passing right/wrong is not a complete coverage claim.

Spend is a fresh conservative Azure token estimate, not an invoice. `spend-summary.json` distinguishes known response usage, incomplete accounting entries, uncharged exposure and unmeasured native agent billing. These views must not be added.
