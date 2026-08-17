#!/usr/bin/env python3
"""Offline breakdown of classified diagram-led rows the capability harness filters.

The syllabus harness labels classified + diagram-led rows as filtered_low_quality
when the stem fails isEnglishEnough OR lacks a DIAGRAM_CUE. This script splits
that bucket so Hindi/mojibake recovery is not confused with English stems that
simply have no lexical diagram cue.

DIAGRAM_CUE / isEnglishEnough / diagram-led unit ids are copied from
packages/scene-engine/scripts/verify-syllabus-corpus.ts as a diagnostic-only
classifier. They must not become runtime diagram routing (AGENTS.md rule 6).

Usage (from repo root):
  python3 tools/question-bank/measure_corpus_quality.py
  python3 tools/question-bank/measure_corpus_quality.py --report data/question-bank/reports/corpus-quality-breakdown-<date>.json

Skips with exit 0 when the local corpus jsonl is absent.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from question_bank.models import load_documents, load_jsonl
from question_bank.syllabus import _is_clean_ascii_prompt_line


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_QUESTIONS = DATA_ROOT / "build" / "questions.all.jsonl"
DEFAULT_SYLLABUS = DATA_ROOT / "build" / "question-syllabus.jsonl"
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
REPORT_SCHEMA = "corpus-quality-breakdown/v1"

DIAGRAM_LED_UNITS = frozenset(
    {
        "maths|7",
        "maths|8",
        "maths|9",
        "maths|10",
        "maths|11",
        "maths|12",
        "maths|14",
        "physics|2",
        "physics|3",
        "physics|4",
        "physics|5",
        "physics|10",
        "physics|11",
        "physics|12",
        "physics|13",
        "physics|14",
        "physics|16",
    }
)

DIAGRAM_CUE = re.compile(
    r"\b(figure|diagram|graph|curve|plot|shown|shown in|circuit|ray|lens|"
    r"mirror|prism|incline|slope|tangent|normal to|parabola|ellipse|"
    r"hyperbola|circle|triangle|vector|field|trajectory|projectile|"
    r"pendulum|wave|interference|diffraction)\b",
    re.IGNORECASE,
)


def is_english_enough(text: str) -> bool:
    if len(text) < 30:
        return False
    non_ascii = sum(ord(character) > 127 for character in text)
    return non_ascii / len(text) < 0.25


def has_diagram_cue(text: str) -> bool:
    return DIAGRAM_CUE.search(text) is not None


def has_clean_ascii_prompt(text: str) -> bool:
    return any(_is_clean_ascii_prompt_line(line) for line in text.splitlines())


def exam_family(document_id: str, exam: str | None) -> str:
    if exam:
        if exam == "JEE Main":
            return "jee_main"
        if exam == "CBSE Class XII Board Examination":
            return "cbse"
        if exam == "JEE Advanced":
            return "jee_advanced"
        return "other"
    if document_id.startswith("jee-main-"):
        return "jee_main"
    if document_id.startswith("cbse-"):
        return "cbse"
    if document_id.startswith("jee-advanced-"):
        return "jee_advanced"
    return "other"


def classify_filtered_row(text: str) -> str:
    """Return the diagnostic bucket for a classified diagram-led stem."""

    english = is_english_enough(text)
    cued = has_diagram_cue(text)
    if not english and cued:
        return "not_english_diagram_cued"
    if not english:
        return "not_english_no_diagram_cue"
    if not cued:
        return "english_no_diagram_cue"
    return "measured_diagram_worthy"


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _source_meta(
    question: dict[str, Any], documents_by_id: dict[str, dict[str, Any]]
) -> tuple[str, str]:
    refs = question.get("source_refs") or []
    if not refs:
        return "unknown", "unknown"
    ref = refs[0]
    document_id = str(ref.get("document_id") or "")
    method = str(ref.get("extraction_method") or "unknown")
    document = documents_by_id.get(document_id)
    exam = document["exam"] if document else None
    return exam_family(document_id, exam), method


def measure_corpus_quality(
    questions: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    documents: list[dict[str, Any]] | None = None,
    *,
    sample_limit: int = 20,
) -> dict[str, Any]:
    assignment_by_id = {item["question_id"]: item for item in assignments}
    documents_by_id = {item["document_id"]: item for item in documents or []}

    status_counts = Counter(item["status"] for item in assignments)
    review_reason_counts = Counter(
        reason for item in assignments for reason in item.get("review_reasons") or []
    )
    review_reason_by_subject: dict[str, Counter[str]] = {}
    for item in assignments:
        if item["status"] != "needs_review":
            continue
        subject = item.get("subject") or "null"
        bucket = review_reason_by_subject.setdefault(subject, Counter())
        for reason in item.get("review_reasons") or []:
            bucket[reason] += 1

    filtered_bucket_counts: Counter[str] = Counter()
    not_english_by_exam: Counter[str] = Counter()
    not_english_by_method: Counter[str] = Counter()
    not_english_clean_prompt = 0
    diagram_cued_lost_ids: list[str] = []
    samples: dict[str, list[str]] = {
        "not_english_diagram_cued": [],
        "not_english_no_diagram_cue": [],
        "english_no_diagram_cue": [],
    }

    classified_rows = 0
    diagram_led_classified = 0
    measured_diagram_worthy = 0
    not_diagram_led = 0
    filtered_low_quality = 0

    for question in questions:
        assignment = assignment_by_id.get(question["question_id"])
        if assignment is None or assignment["status"] != "classified":
            continue
        classified_rows += 1
        unit = assignment.get("primary_unit_id") or ""
        text = question.get("text") or ""
        if unit not in DIAGRAM_LED_UNITS:
            not_diagram_led += 1
            continue
        diagram_led_classified += 1
        bucket = classify_filtered_row(text)
        if bucket == "measured_diagram_worthy":
            measured_diagram_worthy += 1
            continue
        filtered_low_quality += 1
        filtered_bucket_counts[bucket] += 1
        sample = samples[bucket]
        if len(sample) < sample_limit:
            sample.append(question["question_id"])
        if bucket.startswith("not_english"):
            exam, method = _source_meta(question, documents_by_id)
            not_english_by_exam[exam] += 1
            not_english_by_method[method] += 1
            if has_clean_ascii_prompt(text):
                not_english_clean_prompt += 1
            if bucket == "not_english_diagram_cued":
                diagram_cued_lost_ids.append(question["question_id"])

    return {
        "schema": REPORT_SCHEMA,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "totals": {
            "questions": len(questions),
            "assignments": len(assignments),
            "classified": status_counts.get("classified", 0),
            "needs_review": status_counts.get("needs_review", 0),
            "out_of_scope": status_counts.get("out_of_scope", 0),
            "classified_rows_seen": classified_rows,
            "diagram_led_classified": diagram_led_classified,
            "measured_diagram_worthy": measured_diagram_worthy,
            "not_diagram_led": not_diagram_led,
            "filtered_low_quality": filtered_low_quality,
        },
        "filtered_low_quality_split": {
            "not_english_diagram_cued": filtered_bucket_counts["not_english_diagram_cued"],
            "not_english_no_diagram_cue": filtered_bucket_counts["not_english_no_diagram_cue"],
            "english_no_diagram_cue": filtered_bucket_counts["english_no_diagram_cue"],
            "not_english_with_clean_ascii_prompt": not_english_clean_prompt,
        },
        "not_english_by_exam": dict(sorted(not_english_by_exam.items())),
        "not_english_by_extraction_method": dict(sorted(not_english_by_method.items())),
        "review_reason_counts": dict(sorted(review_reason_counts.items())),
        "needs_review_reason_by_subject": {
            subject: dict(sorted(counts.items()))
            for subject, counts in sorted(review_reason_by_subject.items())
        },
        "samples": {
            **samples,
            "not_english_diagram_cued_all_ids": diagram_cued_lost_ids[:200],
            "not_english_diagram_cued_total": len(diagram_cued_lost_ids),
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--syllabus", type=Path, default=DEFAULT_SYLLABUS)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--report",
        type=Path,
        help="write a text-free aggregate JSON audit report",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.questions.is_file() or not args.syllabus.is_file():
        print(
            "measure_corpus_quality: corpus not built locally; skipping "
            "(run build_corpus.py + build_syllabus_index.py to enable).",
            file=sys.stdout,
        )
        return 0

    questions = load_jsonl(args.questions)
    assignments = load_jsonl(args.syllabus)
    documents = load_documents(args.manifest) if args.manifest.is_file() else []
    report = measure_corpus_quality(questions, assignments, documents)
    report["inputs"] = {
        "questions": str(args.questions),
        "syllabus": str(args.syllabus),
        "manifest": str(args.manifest) if args.manifest.is_file() else None,
    }

    print("measure_corpus_quality: classified diagram-led filter split")
    print(f"  classified={report['totals']['classified']}")
    print(f"  measured_diagram_worthy={report['totals']['measured_diagram_worthy']}")
    print(f"  filtered_low_quality={report['totals']['filtered_low_quality']}")
    split = report["filtered_low_quality_split"]
    print(f"  not_english_diagram_cued={split['not_english_diagram_cued']}")
    print(f"  not_english_no_diagram_cue={split['not_english_no_diagram_cue']}")
    print(f"  english_no_diagram_cue={split['english_no_diagram_cue']}")
    print(
        "  not_english_with_clean_ascii_prompt="
        f"{split['not_english_with_clean_ascii_prompt']}"
    )

    report_path = args.report
    if report_path is None:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        report_path = DATA_ROOT / "reports" / f"corpus-quality-breakdown-{stamp}.json"
    _atomic_json(report_path, report)
    print(f"  report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
