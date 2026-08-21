# Plan: Question-Bank Data Quality (Hindi OCR + needs_review Classification)

Status: not started
Owner: delegate to a coding agent
Effort: data-engineering, incremental

## Objective

This task lifts the SIZE and QUALITY of the classified corpus — it does NOT
change diagram capability. Two data problems remain in the question bank:

1. **1,868 rows filtered as low quality**, mostly garbled Hindi OCR (mojibake).
   Among them are ~122 rows that LOOK diagram-worthy but are excluded from
   capability measurement because their text is unreliable.
2. **A large `needs_review` pool** in the sidecar that is not yet classified
   into a syllabus unit, so it contributes nothing to coverage measurement.

More classified, clean rows = a bigger, more trustworthy oracle for the
capability harness. Better Hindi handling recovers the ~122 diagram-cued rows.

## Current state (verified facts)

- Corpus (this machine): 16,720 questions total.
- Sidecar (`data/question-bank/build/question-syllabus.jsonl`):
  **5,367 classified / 9,121 needs_review / 2,232 out_of_scope.**
- Capability report totals
  (`data/question-bank/reports/coverage/syllabus-capability-coverage-2026-08-16.json`):
  `measured_diagram_worthy=1410`, `covered=1410`, `not_diagram_led=2089`,
  `filtered_low_quality=1868`, `coverage_pct=100`.
- Classifier: `tools/question-bank/question_bank/syllabus.py`
  (`ASSIGNMENT_STATUSES = ("classified","needs_review","out_of_scope")`,
  line ~44). Statuses are driven by `data/question-bank/syllabus-taxonomy.json`
  + `syllabus-rules-physics.json` / `syllabus-rules-mathematics.json` +
  `classification-rules.json`.
- Pipeline entry points (run from repo root):
  - `tools/question-bank/importers/build_corpus.py` → builds `questions.all.jsonl`,
    `questions.jsonl`, sqlite, and a build report.
  - `tools/question-bank/importers/build_syllabus_index.py` → builds the syllabus sidecar.
  - `tools/question-bank/importers/stage_pdf_text.py` — OCR gating for scanned PDFs.
  - `tools/question-bank/reverify_nta_quarantine.py` — re-check quarantined NTA rows.
- Tests live beside the tools: `test_syllabus_index.py`,
  `test_classification_rules.py`, `test_syllabus_physics_rules.py`,
  `test_physics_phrase_recoveries.py`, `test_stage_pdf_text.py`, etc.
- `data/question-bank/build/` is **gitignored** (local-only). Regenerate, don't commit it.

## Hard constraints (non-negotiable)

1. **Data quality only.** Do NOT touch the scene engine, planner, or any
   runtime teaching path. This task changes classification/OCR inputs, not
   diagram behavior.
2. **Phrase recoveries must not cause drift.** There is a history of phrase
   passes (1–4) with a "zero phrase-induced drift" bar: any new recovery rule
   must not reclassify already-correct rows. Add/extend
   `test_physics_phrase_recoveries.py` (and the maths equivalent) to prove it.
3. **Deterministic and offline.** Tesseract OCR and rule-based classification
   only; no network calls in the build.
4. **Keep reports reproducible.** Every build emits a dated report under
   `data/question-bank/reports/`; never overwrite a prior report in place.

## What to build

### Step 1 — Recover the garbled Hindi diagram-cued rows

- Localize the mojibake: identify which source PDFs / importers produce the
  garbled Hindi (likely the NTA OCR path in `stage_pdf_text.py` and the legacy
  CBSE importers). Quantify how many of the 1,868 filtered rows are Hindi-garble
  vs other low-quality causes; emit a small report.
- Fix the OCR/encoding path (correct Tesseract language packs / script
  detection, or fix the decode step) so the recovered text is clean.
- Re-run the phrase-recovery passes on the recovered text. Bar: zero drift on
  already-classified rows (prove with the recovery tests).
- Success metric: recover a meaningful fraction of the ~122 diagram-cued rows
  into the classified, diagram-worthy pool.

### Step 2 — Shrink the needs_review pool

- Sample `needs_review` rows per subject to find the dominant rejection reasons
  (e.g. `unsupported_subject`, missing unit signal, multi-topic conflict).
- For the top reasons, extend `syllabus-rules-*.json` / `classification-rules.json`
  with precise rules, backed by tests in `test_classification_rules.py` and
  `test_syllabus_physics_rules.py`.
- Re-run `build_syllabus_index.py` and record the new classified/needs_review
  split. Bar: strictly increase `classified` without increasing `out_of_scope`
  false-negatives or breaking existing tests.

### Step 3 — Re-measure capability coverage

- Regenerate the corpus + sidecar, then re-run the syllabus capability harness
  with `--report` to a NEW dated report. Confirm `filtered_low_quality` drops
  and `measured_diagram_worthy` rises; coverage must stay 100% (if a recovered
  row lands in a unit with no probe, that surfaces as a real gap — report it,
  do not patch around it).

## How to verify

```bash
# from repo root
python3 tools/question-bank/importers/build_corpus.py \
  --raw-dir data/question-bank/raw \
  --text-dir data/question-bank/text \
  --all-questions data/question-bank/build/questions.all.jsonl \
  --target-questions data/question-bank/questions.jsonl \
  --database data/question-bank/build/question-bank.sqlite \
  --report data/question-bank/reports/coverage/corpus-build-<date>.json \
  --allow-segmentation-review

python3 tools/question-bank/importers/build_syllabus_index.py \
  --report data/question-bank/reports/coverage/syllabus-index-<date>.json

# tool tests
python3 -m pytest tools/question-bank -q

# capability harness re-measurement
cd packages/scene-engine && pnpm exec tsx scripts/verify/verify-syllabus-corpus.ts \
  --report ../../data/question-bank/reports/coverage/syllabus-capability-coverage-<date>.json
```

## Done criteria

- [ ] Hindi-garble root cause identified and fixed; recovered-text report emitted.
- [ ] A measurable number of the ~122 diagram-cued rows recovered into the
      classified diagram-worthy pool.
- [ ] `needs_review` pool reduced with tested rules; zero drift on previously
      correct rows (recovery/classification tests green).
- [ ] New dated reports written (corpus build, syllabus index, capability
      coverage); old reports untouched.
- [ ] `python3 -m pytest tools/question-bank -q` green; capability harness exit 0.
- [ ] No changes to scene engine / planner / runtime teaching code.

## Reference files

- `tools/question-bank/importers/build_corpus.py`, `build_syllabus_index.py`,
  `stage_pdf_text.py`, `reverify_nta_quarantine.py` — pipeline entry points.
- `tools/question-bank/question_bank/syllabus.py` — classifier (statuses line ~44).
- `data/question-bank/syllabus-taxonomy.json`, `syllabus-rules-physics.json`,
  `syllabus-rules-mathematics.json`, `classification-rules.json` — rule inputs.
- `data/question-bank/reports/coverage/syllabus-capability-coverage-2026-08-16.json` — baseline totals.
- `AGENTS.md` rule 6 — the bank is an oracle; this task grows the oracle only.
