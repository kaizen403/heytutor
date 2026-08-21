# Question-bank tools

`qbank.py` is a dependency-free Python 3 CLI for building a provenance-first
historical exam question corpus. It keeps canonical records in JSONL and treats
SQLite as a disposable query index. Combined JEE papers retain the nearest
explicit Physics, Chemistry, or Mathematics heading on each source occurrence,
so topic rules do not borrow a subject from another section of the paper.

Run commands from the repository root:

```bash
python3 tools/question-bank/qbank.py validate

# Download only explicitly named manifest rows. Existing raw PDFs are reused,
# checked as PDFs, hashed, and indexed without a network request.
python3 tools/question-bank/qbank.py acquire \
  jee-advanced-2025-paper-1-physics \
  cbse-2025-physics-set-1

# Native-text PDFs use the system pdftotext executable. Scanned papers should
# be OCRed separately into UTF-8 text with form feeds between pages.
python3 tools/question-bank/qbank.py extract \
  --document-id jee-advanced-2025-paper-1-physics
python3 tools/question-bank/qbank.py extract \
  --document-id cbse-2025-physics-set-1 \
  --text-file data/question-bank/text/cbse-2025-physics-set-1.txt \
  --method external-ocr-v1

python3 tools/question-bank/qbank.py classify
python3 tools/question-bank/qbank.py dedupe --dry-run
python3 tools/question-bank/qbank.py dedupe
python3 tools/question-bank/qbank.py near-duplicates \
  --minimum-similarity 0.94 \
  --report data/question-bank/reports/near-duplicates.json
python3 tools/question-bank/qbank.py build-db

# One-time atomic migration for existing question-bank-question/v2 JSONL.
python3 tools/question-bank/qbank.py migrate-v3

# Reports are opt-in and remain trackable.
python3 tools/question-bank/qbank.py validate \
  --report data/question-bank/reports/validation.json
```

Every command accepts explicit paths, so a batch can be staged and checked in a
temporary directory before replacing canonical JSONL. `acquire` requires one or
more document IDs and caps each download at 200 MiB by default. It never crawls
or guesses URLs.

The reproducible first-party batch uses two additional entry points:

```bash
# Rebuild the explicit issuer-verified artifact inventory.
python3 tools/question-bank/importers/corpus_sources.py write-catalog

# Import already downloaded JEE PDFs and expanded CBSE archive members.
python3 tools/question-bank/importers/corpus_sources.py import-staged --help

# Preserve exact page boundaries, falling back to local Tesseract for scans.
python3 tools/question-bank/importers/stage_pdf_text.py --help

# Audit and stage official legacy CBSE sources, then import only verified
# artifacts and archive members with their container provenance intact.
python3 tools/question-bank/importers/legacy_cbse_sources.py --help
python3 tools/question-bank/importers/import_legacy_cbse.py --help

# Produce honest gap reports for official NTA Main and corroborated pre-2007
# IIT-JEE sources. These commands do not promote candidate-only mirrors.
python3 tools/question-bank/importers/nta_jee_main_sources.py --help
python3 tools/question-bank/importers/nta_jee_main_acquisition.py --help
python3 tools/question-bank/importers/import_nta_jee_main.py --help
python3 tools/question-bank/importers/legacy_jee_sources.py --help

# Verify every PDF/text page mapping, extract, classify, and build SQLite.
# Splitter warnings block by default; the flag produces a candidate-only build.
python3 tools/question-bank/importers/build_corpus.py --help

# Build a deterministic full-syllabus sidecar and SQLite query index from the
# candidate-only all-question corpus. Add --report only for an aggregate audit.
python3 tools/question-bank/importers/build_syllabus_index.py
python3 tools/question-bank/importers/build_syllabus_index.py \
  --report data/question-bank/reports/coverage/syllabus-index.json
```

`source-catalog.json` is an allowlist, not a crawler result. An absent year or
shift stays in `known_gaps` until an official source or a separately corroborated
legacy source is found.

## Full-syllabus sidecar

`build_syllabus_index.py` reads the validated manifest, the generated
`build/questions.all.jsonl`, the versioned taxonomy, and both subject rule
files. Its defaults write `build/question-syllabus.jsonl` and
`build/question-bank-full.sqlite`; pass `--no-database` for an assignments-only
audit. Every input and output path can be overridden.

Subject provenance is authoritative: a non-null source occurrence context is
used first, and a null context may fall back only to a singular manifest
subject. The classifier never infers a subject from question text in a combined
paper. Unit scores retain independent matching signals (+20 existing unit-name
projection, +8 strong phrase, +3 supporting phrase, +5 pattern, and -8
exclusion); overlapping phrase and regex hits on the same text span count only
once. Ties and low margins abstain rather than guess. A projection without
independent text corroboration and any second unit scoring at least 8 are kept
as auditable labels but routed to review. Supplemental units are isolated by
subject and use only full high-precision topic labels or aliases.

Assignments are sorted by question ID and are byte-stable across unchanged
runs. Reports contain aggregates and bounded question-ID samples only, never
question text. The SQLite build preserves the source corpus's `candidate_only`
release metadata unless every canonical question is reviewed.

## Extraction boundary

The extractor is intentionally mechanical: it verifies the PDF hash, obtains
page-delimited text, and splits headings such as `Q. 1)` or `2.`. A different
paper layout can provide `--question-pattern`; the regex must capture the
question number as group 1 and may capture the first line as group 2. Named
groups `number` and `body` are also supported. This is not a semantic parser.
Review page boundaries, diagrams, options, answers, and multi-part questions
before setting a record to `reviewed`.

Batch builds stop when splitter diagnostics require review. Passing
`--allow-segmentation-review` is an explicit research-mode override: the report
and SQLite metadata remain candidate-only, and no question is promoted to
`reviewed`.

Rerunning extraction is additive and idempotent for unchanged text. It does not
delete old reviewed records when an OCR/parser configuration changes. Review the
diff and remove superseded source appearances explicitly.

## Classification and deduplication

Classification rules are deterministic and reviewable. Rules may fill topic,
subtopic, and optional difficulty, but never answers and never `reviewed`
status. Equal-ranked rules with different outcomes are reported as ambiguous
and leave the question unchanged.

Deduplication merges only exact normalized text: Unicode compatibility, leading
question numbering, case, and whitespace are ignored, while mathematical and
semantic punctuation remain significant. All source references are retained.
Conflicting non-null answers or classifications stop the run instead of silently
choosing one. `near-duplicates` reports likely OCR and paper-set variants using
rare token shingles plus sequence similarity. It never mutates or merges records;
near-duplicate decisions remain a human review step.

## Verification

```bash
python3 -m unittest discover -s tools/question-bank/tests -t tools/question-bank -p 'test_*.py' -v
python3 -m py_compile \
  tools/question-bank/qbank.py \
  tools/question-bank/importers/build_syllabus_index.py \
  tools/question-bank/question_bank/*.py
```
