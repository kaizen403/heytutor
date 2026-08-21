#!/usr/bin/env python3
"""Read-only re-verification for already-downloaded NTA JEE Main quarantine PDFs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import nta_jee_main_acquisition as acquisition
from question_bank.models import sha256_file

RECORD_SCHEMA_VERSION = "nta-jee-main-quarantine-reverify-record/v1"
REPORT_SCHEMA_VERSION = "nta-jee-main-quarantine-reverify-report/v1"


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(text, encoding="utf-8", newline="\n")
    temporary.replace(path)


def _load_candidates(
    inventory_report: Path,
    schedule_path: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    inventory = acquisition._validate_inventory_report(acquisition._load_json(inventory_report))
    schedule = acquisition._validate_schedule(acquisition._load_json(schedule_path))
    schedule_info = acquisition._schedule_index(schedule)
    plan = acquisition._build_download_plan(inventory, schedule)
    return inventory, schedule, schedule_info, plan["planned_candidates"]


def _candidate_indexes(
    planned_candidates: list[dict[str, Any]],
    staging_dir: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_paper_file: dict[str, dict[str, Any]] = {}
    by_official_key: dict[str, dict[str, Any]] = {}
    by_quarantine_name: dict[str, dict[str, Any]] = {}
    for candidate in planned_candidates:
        by_paper_file[str(candidate["paper_file"])] = candidate
        for official_key in candidate.get("reported_schedule_keys", []):
            by_official_key[str(official_key)] = candidate
        staged_path = acquisition._staged_pdf_path(staging_dir, str(candidate["paper_url"]))
        for quarantine_path in _quarantine_matches(staged_path):
            by_quarantine_name[quarantine_path.name] = candidate
    return by_paper_file, by_official_key, by_quarantine_name


def _quarantine_matches(staged_path: Path) -> list[Path]:
    suffix = f"{staged_path.suffix}.*.quarantine"
    return sorted(staged_path.parent.glob(f"{staged_path.stem}{suffix}"))


def _retrieved_at(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def _resolve_candidates(
    *,
    planned_candidates: list[dict[str, Any]],
    staging_dir: Path,
    paper_files: list[str],
    official_keys: list[str],
    quarantine_paths: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_paper_file, by_official_key, by_quarantine_name = _candidate_indexes(
        planned_candidates, staging_dir
    )
    selected: dict[str, dict[str, Any]] = {}
    unresolved: list[dict[str, Any]] = []

    for paper_file in paper_files:
        candidate = by_paper_file.get(paper_file)
        if candidate is None:
            unresolved.append({"selector_type": "paper_file", "selector_value": paper_file})
            continue
        selected[str(candidate["paper_url"])] = candidate

    for official_key in official_keys:
        candidate = by_official_key.get(official_key)
        if candidate is None:
            unresolved.append({"selector_type": "official_key", "selector_value": official_key})
            continue
        selected[str(candidate["paper_url"])] = candidate

    for raw_path in quarantine_paths:
        path = Path(raw_path)
        candidate = by_quarantine_name.get(path.name)
        if candidate is None:
            unresolved.append({"selector_type": "quarantine_path", "selector_value": raw_path})
            continue
        staged_path = acquisition._staged_pdf_path(staging_dir, str(candidate["paper_url"]))
        if path.name not in {item.name for item in _quarantine_matches(staged_path)}:
            unresolved.append({"selector_type": "quarantine_path", "selector_value": raw_path})
            continue
        selected[str(candidate["paper_url"])] = candidate

    return sorted(selected.values(), key=lambda item: str(item["paper_url"])), unresolved


def _evaluation_path(
    *,
    candidate: dict[str, Any],
    schedule_info: dict[str, Any],
    preview_text: str,
) -> str:
    parsed = acquisition._parse_pdf_text_metadata(preview_text)
    question_paper_name = acquisition._clean_text(parsed.get("question_paper_name"))
    subject_name = acquisition._clean_text(parsed.get("subject_name"))
    exam_date, shift = acquisition._header_exam_date_and_shift(question_paper_name)
    if exam_date is not None and shift is not None:
        return "direct_internal_header"
    fallback_schedule_entry = acquisition._official_historical_schedule_entry(candidate, schedule_info)
    if (
        fallback_schedule_entry is not None
        and candidate.get("language_variant") == "english_hindi"
        and re.fullmatch(r"\d+", question_paper_name)
        and acquisition._looks_like_btech(subject_name)
    ):
        return "english_hindi_numeric_fallback"
    if fallback_schedule_entry is not None and candidate.get("language_variant") == "english":
        legacy_header = acquisition._legacy_official_english_header_metadata(preview_text)
        if legacy_header is not None:
            legacy_exam_date, legacy_shift, _legacy_language = legacy_header
            if (
                acquisition._official_key(legacy_exam_date, legacy_shift)
                == fallback_schedule_entry["official_key"]
            ):
                return "legacy_english_header_fallback"
    return "unresolved_metadata"


def _reverify_candidate(
    *,
    candidate: dict[str, Any],
    schedule_info: dict[str, Any],
    staging_dir: Path,
) -> dict[str, Any]:
    staged_path = acquisition._staged_pdf_path(staging_dir, str(candidate["paper_url"]))
    quarantines = _quarantine_matches(staged_path)
    base = {
        "schema_version": RECORD_SCHEMA_VERSION,
        "paper_file": candidate["paper_file"],
        "paper_url": candidate["paper_url"],
        "reported_schedule_keys": candidate.get("reported_schedule_keys", []),
        "candidate_status": candidate.get("candidate_status"),
        "plan_reason": candidate.get("plan_reason"),
        "candidate_language_variant": candidate.get("language_variant"),
        "staged_basename": staged_path.name,
    }
    if not quarantines:
        return {**base, "status": "missing_local_quarantine"}
    if len(quarantines) != 1:
        return {
            **base,
            "status": "ambiguous_local_quarantine",
            "quarantine_candidates": [str(path) for path in quarantines],
        }

    quarantine_path = quarantines[0]
    pdf_magic = quarantine_path.read_bytes()[:5] == b"%PDF-"
    page_count = acquisition._pdf_page_count(quarantine_path)
    preview_text = acquisition._pdftotext_preview(quarantine_path)
    sha256 = sha256_file(quarantine_path)
    size_bytes = quarantine_path.stat().st_size
    evaluation_path = _evaluation_path(
        candidate=candidate,
        schedule_info=schedule_info,
        preview_text=preview_text,
    )
    evaluated = acquisition._evaluate_pdf_metadata(
        candidate=candidate,
        schedule_index=schedule_info,
        staged_path=quarantine_path,
        sha256=sha256,
        size_bytes=size_bytes,
        page_count=page_count,
        pdf_magic=pdf_magic,
        preview_text=preview_text,
    )
    if evaluated.get("status") == "verified":
        schedule_entry = schedule_info["by_key"][str(evaluated["official_key"])]
        evaluated.update(
            {
                "year": schedule_entry["year"],
                "session_id": schedule_entry["session_id"],
                "session_label": schedule_entry["session_label"],
                "source_url": schedule_entry["source_url"],
                "alternate_source_urls": schedule_entry["alternate_source_urls"],
                "evidence_type": schedule_entry["evidence_type"],
                "expected_gap": schedule_entry["expected_gap"],
                "retrieved_at": _retrieved_at(quarantine_path),
            }
        )
    return {
        **base,
        **evaluated,
        "quarantine_path": str(quarantine_path),
        "evaluation_path": evaluation_path,
    }


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    payload = "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
    _atomic_write_text(path, payload)


def _build_report(
    *,
    inventory_report: Path,
    schedule_path: Path,
    selectors: dict[str, list[str]],
    unresolved_selectors: list[dict[str, Any]],
    records: list[dict[str, Any]],
    verified_jsonl: Path,
    all_jsonl: Path,
) -> dict[str, Any]:
    counts = Counter(str(record.get("status")) for record in records)
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "inventory_report": str(inventory_report),
        "schedule_path": str(schedule_path),
        "selectors": selectors,
        "unresolved_selectors": unresolved_selectors,
        "all_records_jsonl": str(all_jsonl),
        "verified_records_jsonl": str(verified_jsonl),
        "summary": {
            "selected_candidates": len(records),
            "verified": counts.get("verified", 0),
            "quarantined": counts.get("quarantined", 0),
            "missing_local_quarantine": counts.get("missing_local_quarantine", 0),
            "ambiguous_local_quarantine": counts.get("ambiguous_local_quarantine", 0),
        },
        "records": records,
    }


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--inventory-report",
        type=Path,
        default=acquisition.DEFAULT_INVENTORY_REPORT,
    )
    parser.add_argument(
        "--schedule",
        type=Path,
        default=acquisition.DEFAULT_SCHEDULE,
    )
    parser.add_argument(
        "--staging-dir",
        type=Path,
        default=acquisition.DEFAULT_STAGING_DIR,
    )
    parser.add_argument("--paper-file", action="append", default=[])
    parser.add_argument("--official-key", action="append", default=[])
    parser.add_argument("--quarantine-path", action="append", default=[])
    parser.add_argument("--all-jsonl", type=Path, required=True)
    parser.add_argument("--verified-jsonl", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    selectors = {
        "paper_files": [str(value) for value in args.paper_file],
        "official_keys": [str(value) for value in args.official_key],
        "quarantine_paths": [str(value) for value in args.quarantine_path],
    }
    if not any(selectors.values()):
        raise acquisition.AcquisitionError(
            "select at least one input via --paper-file, --official-key, or --quarantine-path"
        )
    (
        _inventory,
        _schedule,
        schedule_info,
        planned_candidates,
    ) = _load_candidates(args.inventory_report, args.schedule)
    candidates, unresolved_selectors = _resolve_candidates(
        planned_candidates=planned_candidates,
        staging_dir=args.staging_dir,
        paper_files=selectors["paper_files"],
        official_keys=selectors["official_keys"],
        quarantine_paths=selectors["quarantine_paths"],
    )
    records = [
        _reverify_candidate(
            candidate=candidate,
            schedule_info=schedule_info,
            staging_dir=args.staging_dir,
        )
        for candidate in candidates
    ]
    verified_records = [record for record in records if record.get("status") == "verified"]
    _write_jsonl(args.all_jsonl, records)
    _write_jsonl(args.verified_jsonl, verified_records)
    report = _build_report(
        inventory_report=args.inventory_report,
        schedule_path=args.schedule,
        selectors=selectors,
        unresolved_selectors=unresolved_selectors,
        records=records,
        verified_jsonl=args.verified_jsonl,
        all_jsonl=args.all_jsonl,
    )
    acquisition._atomic_json(args.report, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
