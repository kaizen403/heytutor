#!/usr/bin/env python3
"""Command-line entry point for the stdlib-only question-bank pipeline."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from question_bank.models import (
    ValidationError,
    deduplicate_questions,
    find_near_duplicate_questions,
    load_documents,
    load_questions,
    migrate_questions_v2_to_v3,
    validate_corpus,
    write_jsonl,
)
from question_bank.pipeline import (
    DEFAULT_QUESTION_PATTERN,
    PipelineError,
    acquire_documents,
    build_sqlite_database,
    classify_questions,
    extract_document,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
DEFAULT_QUESTIONS = DATA_ROOT / "questions.jsonl"
DEFAULT_RULES = DATA_ROOT / "classification-rules.json"
DEFAULT_RAW_DIR = DATA_ROOT / "raw"
DEFAULT_DATABASE = DATA_ROOT / "build" / "question-bank.sqlite"


def _add_record_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)


def _write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        **payload,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(report, output, ensure_ascii=False, indent=2, sort_keys=True)
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


def _validate(args: argparse.Namespace) -> dict[str, Any]:
    documents = load_documents(args.manifest)
    questions = load_questions(args.questions)
    validate_corpus(documents, questions)
    return {
        "operation": "validate",
        "manifest": str(args.manifest),
        "questions_file": str(args.questions),
        "documents": len(documents),
        "questions": len(questions),
        "source_references": sum(len(question["source_refs"]) for question in questions),
        "document_statuses": dict(sorted(Counter(document["status"] for document in documents).items())),
        "question_statuses": dict(sorted(Counter(question["status"] for question in questions).items())),
    }


def _dedupe(args: argparse.Namespace) -> dict[str, Any]:
    documents = load_documents(args.manifest)
    questions = load_questions(args.questions)
    deduplicated, duplicate_count = deduplicate_questions(questions)
    validate_corpus(documents, deduplicated)
    if not args.dry_run:
        write_jsonl(args.questions, deduplicated)
    return {
        "operation": "dedupe",
        "dry_run": args.dry_run,
        "input_questions": len(questions),
        "merged_duplicates": duplicate_count,
        "output_questions": len(deduplicated),
    }


def _near_duplicates(args: argparse.Namespace) -> dict[str, Any]:
    questions = load_questions(args.questions)
    pairs, truncated = find_near_duplicate_questions(
        questions,
        minimum_similarity=args.minimum_similarity,
        maximum_pairs=args.limit,
    )
    return {
        "operation": "near-duplicates",
        "questions_file": str(args.questions),
        "questions": len(questions),
        "minimum_similarity": args.minimum_similarity,
        "candidate_pairs": len(pairs),
        "limit": args.limit,
        "truncated": truncated,
        "pairs": pairs,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Acquire, extract, classify, validate, and index historical exam questions."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="validate manifest and question JSONL")
    _add_record_paths(validate_parser)
    validate_parser.set_defaults(handler=_validate)

    acquire_parser = subparsers.add_parser(
        "acquire", help="download or index explicitly named manifest PDFs"
    )
    acquire_parser.add_argument("document_ids", nargs="+", metavar="DOCUMENT_ID")
    acquire_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    acquire_parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    acquire_parser.add_argument("--overwrite", action="store_true")
    acquire_parser.add_argument("--dry-run", action="store_true")
    acquire_parser.add_argument("--max-bytes", type=int, default=200 * 1024 * 1024)
    acquire_parser.add_argument("--timeout", type=float, default=30.0)
    acquire_parser.set_defaults(
        handler=lambda args: acquire_documents(
            args.manifest,
            args.raw_dir,
            args.document_ids,
            overwrite=args.overwrite,
            dry_run=args.dry_run,
            max_bytes=args.max_bytes,
            timeout_seconds=args.timeout,
        )
    )

    extract_parser = subparsers.add_parser(
        "extract", help="split one verified PDF or OCR text into question records"
    )
    _add_record_paths(extract_parser)
    extract_parser.add_argument("--document-id", required=True)
    extract_parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    extract_parser.add_argument("--pdf", type=Path)
    extract_parser.add_argument("--text-file", type=Path)
    extract_parser.add_argument("--pdftotext", default="pdftotext")
    extract_parser.add_argument("--method")
    extract_parser.add_argument("--page-offset", type=int, default=0)
    extract_parser.add_argument("--question-pattern", default=DEFAULT_QUESTION_PATTERN)
    extract_parser.set_defaults(
        handler=lambda args: extract_document(
            args.manifest,
            args.questions,
            args.raw_dir,
            args.document_id,
            pdf_path=args.pdf,
            text_path=args.text_file,
            pdftotext_executable=args.pdftotext,
            extraction_method=args.method,
            page_offset=args.page_offset,
            question_pattern=args.question_pattern,
        )
    )

    classify_parser = subparsers.add_parser(
        "classify", help="apply deterministic, reviewable keyword taxonomy rules"
    )
    _add_record_paths(classify_parser)
    classify_parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    classify_parser.add_argument("--overwrite", action="store_true")
    classify_parser.set_defaults(
        handler=lambda args: classify_questions(
            args.manifest,
            args.questions,
            args.rules,
            overwrite=args.overwrite,
        )
    )

    dedupe_parser = subparsers.add_parser(
        "dedupe", help="merge exact normalized-text duplicates and source references"
    )
    _add_record_paths(dedupe_parser)
    dedupe_parser.add_argument("--dry-run", action="store_true")
    dedupe_parser.set_defaults(handler=_dedupe)

    near_duplicates_parser = subparsers.add_parser(
        "near-duplicates",
        help="report likely OCR or paper-set variants without merging them",
    )
    near_duplicates_parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    near_duplicates_parser.add_argument(
        "--minimum-similarity", type=float, default=0.9, metavar="0..1"
    )
    near_duplicates_parser.add_argument("--limit", type=int, default=1000)
    near_duplicates_parser.set_defaults(handler=_near_duplicates)

    migrate_parser = subparsers.add_parser(
        "migrate-v3",
        help="atomically add nullable subject context to v2 question JSONL",
    )
    migrate_parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    migrate_parser.add_argument("--dry-run", action="store_true")
    migrate_parser.set_defaults(
        handler=lambda args: migrate_questions_v2_to_v3(
            args.questions, dry_run=args.dry_run
        )
    )

    database_parser = subparsers.add_parser(
        "build-db", help="build a disposable SQLite query index from canonical JSONL"
    )
    _add_record_paths(database_parser)
    database_parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    database_parser.set_defaults(
        handler=lambda args: build_sqlite_database(
            args.manifest, args.questions, args.database
        )
    )

    for command_parser in (
        validate_parser,
        acquire_parser,
        extract_parser,
        classify_parser,
        dedupe_parser,
        near_duplicates_parser,
        migrate_parser,
        database_parser,
    ):
        command_parser.add_argument(
            "--report",
            type=Path,
            help="optionally write the JSON result (reports/ is intentionally trackable)",
        )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "max_bytes", 1) <= 0:
        parser.error("--max-bytes must be positive")
    if getattr(args, "timeout", 1.0) <= 0:
        parser.error("--timeout must be positive")
    if not 0.0 <= getattr(args, "minimum_similarity", 0.9) <= 1.0:
        parser.error("--minimum-similarity must be from 0 through 1")
    if getattr(args, "limit", 1) <= 0:
        parser.error("--limit must be positive")
    try:
        result = args.handler(args)
        if args.report is not None:
            _write_report(args.report, result)
            result = {**result, "report": str(args.report)}
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (ValidationError, PipelineError, OSError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
