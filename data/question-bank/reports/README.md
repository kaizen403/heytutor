# Question-bank reports

Reports are grouped without deleting history:

- `coverage/` — corpus, syllabus, acquisition, validation, and import baselines
- `ocr/` — NTA OCR one-off runs
- `reviews/` — cursor-assist / codex sidecar reviews

Validation and ingestion reports may be committed here when they document a
corpus change. The CLI writes a report only when passed an explicit `--report`
path, so routine local runs do not dirty the worktree.

The 2026-08-10 research snapshot is split by responsibility:

- `coverage/acquisition-2026-08-10.json` records the first-party modern batch.
- `coverage/legacy-cbse-coverage-2026-08-10.json`,
  `coverage/legacy-cbse-import-2026-08-10.json`, and
  `coverage/legacy-cbse-text-stage-2026-08-10.json` record official legacy discovery,
  archive-member import, and page-preserving OCR/native-text staging.
- `coverage/legacy-jee-coverage-2026-08-10.json` records the 2000-2006 corroboration
  boundary. Candidate-only institutional copies are not imported as verified
  papers.
- `coverage/nta-jee-main-coverage-2026-08-10.json` records what the official NTA pages
  actually expose and keeps missing years and sessions explicit.
- `coverage/corpus-build-2026-08-10.json` is the canonical aggregate build audit,
  including extraction diagnostics, subject-context evidence, classification
  totals, and SQLite counts.
- `coverage/classification-audit-2026-08-10.json` pins the rules and generated target
  corpus hashes and records precision regressions and safety boundaries.
- `coverage/near-duplicates-2026-08-10.json` is review input only; it never mutates the
  corpus.
- `coverage/validation-final-2026-08-10.json` validates the final generated target
  JSONL against the 474-document manifest.

All extracted questions in this snapshot are `candidate_only`. A report date is
not a claim that historical source coverage is complete.
