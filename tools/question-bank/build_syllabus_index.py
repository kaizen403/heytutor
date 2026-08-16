#!/usr/bin/env python3
"""Build the deterministic full-syllabus sidecar and query database."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from question_bank.models import ValidationError
from question_bank.pipeline import PipelineError
from question_bank.syllabus import build_syllabus_index


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
DEFAULT_QUESTIONS = DATA_ROOT / "build" / "questions.all.jsonl"
DEFAULT_TAXONOMY = DATA_ROOT / "syllabus-taxonomy.json"
DEFAULT_MATHEMATICS_RULES = DATA_ROOT / "syllabus-rules-mathematics.json"
DEFAULT_PHYSICS_RULES = DATA_ROOT / "syllabus-rules-physics.json"
DEFAULT_ASSIGNMENTS = DATA_ROOT / "build" / "question-syllabus.jsonl"
DEFAULT_DATABASE = DATA_ROOT / "build" / "question-bank-full.sqlite"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY)
    parser.add_argument(
        "--mathematics-rules",
        "--math-rules",
        "--rules-mathematics",
        dest="mathematics_rules",
        type=Path,
        default=DEFAULT_MATHEMATICS_RULES,
    )
    parser.add_argument(
        "--physics-rules",
        "--rules-physics",
        dest="physics_rules",
        type=Path,
        default=DEFAULT_PHYSICS_RULES,
    )
    parser.add_argument("--assignments", type=Path, default=DEFAULT_ASSIGNMENTS)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument(
        "--report",
        type=Path,
        help="optionally write a text-free aggregate JSON audit report",
    )
    parser.add_argument(
        "--no-database",
        action="store_true",
        help="write and validate assignments without building SQLite",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = build_syllabus_index(
            args.manifest,
            args.questions,
            args.taxonomy,
            [args.mathematics_rules, args.physics_rules],
            args.assignments,
            args.database,
            report_path=args.report,
            build_database=not args.no_database,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (ValidationError, PipelineError, OSError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
