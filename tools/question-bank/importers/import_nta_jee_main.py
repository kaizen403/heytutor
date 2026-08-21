#!/usr/bin/env python3
"""Import verified official NTA JEE Main Paper 1 PDFs into the local manifest."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import nta_jee_main_acquisition as acquisition
import reverify_nta_quarantine as reverify_quarantine
from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    load_documents,
    sha256_file,
    validate_corpus,
    validate_document,
    write_jsonl,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_REPORT = DATA_ROOT / "reports" / "coverage" / "nta-jee-main-import-2026-08-10.json"
DEFAULT_ACQUISITION_REPORT = (
    DATA_ROOT / "reports" / "coverage" / "nta-jee-main-acquisition-2026-08-10.json"
)
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
DEFAULT_RAW_DIR = DATA_ROOT / "raw"
DEFAULT_STAGING_DIR = DATA_ROOT / "staging" / "nta-jee-main"

IMPORT_SCHEMA_VERSION = "nta-jee-main-import-report/v1"


class ImportError(RuntimeError):
    """Raised when staged NTA artifacts cannot be imported safely."""


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


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


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ImportError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ImportError(f"invalid JSON in {path}") from exc


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ImportError(message)


def _require_string(value: Any, path: str) -> str:
    _require(isinstance(value, str) and bool(value.strip()), f"{path}: expected non-empty string")
    return value.strip()


def _require_int(value: Any, path: str) -> int:
    _require(isinstance(value, int) and not isinstance(value, bool), f"{path}: expected integer")
    return value


def _month_session(exam_date: str) -> str:
    return datetime.strptime(exam_date, "%Y-%m-%d").strftime("%B")


def _language_label(explicit_language: str | None, language_variant: str | None) -> str:
    if explicit_language:
        compact = explicit_language.strip()
        lowered = compact.casefold()
        if lowered == "english":
            return "English"
        if lowered in {"englishhindi", "hindienglish"}:
            return "English/Hindi"
        return compact
    if language_variant == "english":
        return "English"
    if language_variant == "english_hindi":
        return "English/Hindi"
    if language_variant == "regional":
        return "Regional"
    return "Unknown"


def _document_id(exam_date: str, shift: int) -> str:
    return f"jee-main-{exam_date}-shift-{shift}"


def _stable_missing_key_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "official_key": item["official_key"],
        "exam_date": item["exam_date"],
        "shift": item["shift"],
        "evidence_type": item["evidence_type"],
        "expected_gap": item["expected_gap"],
        "session_id": item["session_id"],
        "session_label": item["session_label"],
        "source_url": item["source_url"],
        "alternate_source_urls": item["alternate_source_urls"],
        "year": item["year"],
    }


def _validate_acquisition_report(report: Any) -> dict[str, Any]:
    _require(isinstance(report, dict), "acquisition report: expected object")
    _require(
        report.get("schema_version") == acquisition.REPORT_SCHEMA_VERSION,
        "acquisition report: unsupported schema_version",
    )
    _require(report.get("dry_run") is False, "acquisition report: dry_run reports cannot be imported")
    canonical_candidates = report.get("canonical_candidates")
    _require(isinstance(canonical_candidates, list), "acquisition report: missing canonical_candidates")
    missing_schedule_keys = report.get("missing_schedule_keys")
    _require(isinstance(missing_schedule_keys, list), "acquisition report: missing missing_schedule_keys")
    return report


def _validate_reverify_report(report: Any) -> dict[str, Any]:
    _require(isinstance(report, dict), "reverify report: expected object")
    _require(
        report.get("schema_version") == reverify_quarantine.REPORT_SCHEMA_VERSION,
        "reverify report: unsupported schema_version",
    )
    records = report.get("records")
    _require(isinstance(records, list), "reverify report: missing records")
    return report


def _validate_staged_path(staged_path: str, staging_dir: Path, label: str) -> Path:
    resolved_staging = staging_dir.resolve()
    candidate = Path(staged_path).resolve()
    try:
        candidate.relative_to(resolved_staging)
    except ValueError as exc:
        raise ImportError(f"{label}: staged path escapes --staging-dir: {candidate}") from exc
    _require(candidate.is_file(), f"{label}: missing staged PDF: {candidate}")
    return candidate


def _load_sidecar(staged_path: Path, label: str) -> dict[str, Any]:
    sidecar_path = acquisition._sidecar_path(staged_path)
    sidecar = _load_json(sidecar_path)
    _require(
        isinstance(sidecar, dict)
        and sidecar.get("schema_version") == acquisition.SIDECAR_SCHEMA_VERSION,
        f"{label}: invalid sidecar schema: {sidecar_path}",
    )
    return sidecar


def _verified_candidate_payload(
    entry: dict[str, Any],
    *,
    staging_dir: Path,
    allow_regional_fallback: bool,
) -> dict[str, Any]:
    _require(isinstance(entry, dict), "canonical candidate entry: expected object")
    official_key = _require_string(entry.get("official_key"), "canonical_candidates[].official_key")
    exam_date = _require_string(entry.get("exam_date"), f"{official_key}.exam_date")
    shift = _require_int(entry.get("shift"), f"{official_key}.shift")
    _require(official_key == acquisition._official_key(exam_date, shift), f"{official_key}: inconsistent official key fields")
    if entry.get("regional_fallback") and not allow_regional_fallback:
        raise ImportError(
            f"{official_key}: regional fallback canonical candidate requires --allow-regional-fallback"
        )

    canonical = entry.get("canonical")
    _require(isinstance(canonical, dict), f"{official_key}: missing canonical payload")
    staged_path = _validate_staged_path(
        _require_string(canonical.get("staged_path"), f"{official_key}.canonical.staged_path"),
        staging_dir,
        official_key,
    )
    sidecar = _load_sidecar(staged_path, official_key)
    actual_sha256 = sha256_file(staged_path)
    actual_size = staged_path.stat().st_size
    actual_page_count = acquisition._pdf_page_count(staged_path)
    _require(staged_path.read_bytes()[:5] == b"%PDF-", f"{official_key}: staged file is not a PDF")
    _require(
        actual_sha256 == _require_string(canonical.get("sha256"), f"{official_key}.canonical.sha256"),
        f"{official_key}: canonical sha256 does not match staged file",
    )
    _require(
        actual_sha256 == _require_string(sidecar.get("sha256"), f"{official_key}.sidecar.sha256"),
        f"{official_key}: sidecar sha256 does not match staged file",
    )
    _require(
        actual_size == _require_int(canonical.get("size_bytes"), f"{official_key}.canonical.size_bytes"),
        f"{official_key}: canonical size_bytes does not match staged file",
    )
    _require(
        actual_size == _require_int(sidecar.get("size_bytes"), f"{official_key}.sidecar.size_bytes"),
        f"{official_key}: sidecar size_bytes does not match staged file",
    )
    _require(
        actual_page_count == _require_int(canonical.get("page_count"), f"{official_key}.canonical.page_count"),
        f"{official_key}: canonical page_count does not match staged file",
    )
    _require(
        actual_page_count == _require_int(sidecar.get("page_count"), f"{official_key}.sidecar.page_count"),
        f"{official_key}: sidecar page_count does not match staged file",
    )
    paper_url = _require_string(canonical.get("paper_url"), f"{official_key}.canonical.paper_url")
    _require(paper_url == _require_string(sidecar.get("paper_url"), f"{official_key}.sidecar.paper_url"), f"{official_key}: sidecar paper_url mismatch")
    _require(official_key == _require_string(sidecar.get("official_key"), f"{official_key}.sidecar.official_key"), f"{official_key}: sidecar official_key mismatch")

    retrieved_at = _require_string(canonical.get("retrieved_at"), f"{official_key}.canonical.retrieved_at")
    _require(
        retrieved_at == _require_string(sidecar.get("retrieved_at"), f"{official_key}.sidecar.retrieved_at"),
        f"{official_key}: sidecar retrieved_at mismatch",
    )

    preview = acquisition._pdftotext_preview(staged_path)
    parsed = acquisition._parse_pdf_text_metadata(preview)
    question_paper_name = (parsed.get("question_paper_name") or "").strip()
    subject_name = (parsed.get("subject_name") or "").strip()
    subject_evidence = " ".join(part for part in (question_paper_name, subject_name) if part)
    _require(acquisition._looks_like_paper1(subject_evidence), f"{official_key}: preview no longer looks like Paper 1")
    header_exam_date, header_shift = acquisition._header_exam_date_and_shift(question_paper_name)
    _require(
        header_exam_date == exam_date and header_shift == shift,
        f"{official_key}: preview header resolved to {header_exam_date!r} shift {header_shift!r}",
    )
    _require(
        question_paper_name == (sidecar.get("question_paper_name") or "").strip(),
        f"{official_key}: sidecar question_paper_name mismatch",
    )
    _require(
        subject_name == (sidecar.get("subject_name") or "").strip(),
        f"{official_key}: sidecar subject_name mismatch",
    )
    _require(
        (parsed.get("creation_date") or "").strip() == (sidecar.get("creation_date") or "").strip(),
        f"{official_key}: sidecar creation_date mismatch",
    )
    _require(
        (parsed.get("language") or None) == sidecar.get("language"),
        f"{official_key}: sidecar language mismatch",
    )
    _require(
        question_paper_name == (canonical.get("question_paper_name") or "").strip(),
        f"{official_key}: canonical question_paper_name mismatch",
    )
    _require(
        subject_name == (canonical.get("subject_name") or "").strip(),
        f"{official_key}: canonical subject_name mismatch",
    )
    _require(
        (parsed.get("creation_date") or None) == canonical.get("creation_date"),
        f"{official_key}: canonical creation_date mismatch",
    )
    _require(
        (parsed.get("language") or None) == canonical.get("language"),
        f"{official_key}: canonical language mismatch",
    )

    document_id = _document_id(exam_date, shift)
    raw_path = DATA_ROOT / "raw" / f"{document_id}.pdf"
    return {
        "document_id": document_id,
        "official_key": official_key,
        "exam_date": exam_date,
        "shift": shift,
        "year": _require_int(entry.get("year"), f"{official_key}.year"),
        "session_label": _require_string(entry.get("session_label"), f"{official_key}.session_label"),
        "session_id": _require_string(entry.get("session_id"), f"{official_key}.session_id"),
        "schedule_source_url": _require_string(entry.get("source_url"), f"{official_key}.source_url"),
        "alternate_source_urls": list(entry.get("alternate_source_urls") or []),
        "evidence_type": _require_string(entry.get("evidence_type"), f"{official_key}.evidence_type"),
        "expected_gap": bool(entry.get("expected_gap")),
        "paper_url": paper_url,
        "sha256": actual_sha256,
        "size_bytes": actual_size,
        "page_count": actual_page_count,
        "retrieved_at": retrieved_at,
        "language": _language_label(sidecar.get("language"), canonical.get("language_variant")),
        "language_variant": canonical.get("language_variant"),
        "question_paper_name": question_paper_name,
        "subject_name": subject_name,
        "creation_date": parsed.get("creation_date") or None,
        "staged_path": staged_path,
        "raw_path": raw_path,
        "regional_fallback": bool(entry.get("regional_fallback")),
    }


def _verified_reverify_payload(
    entry: dict[str, Any],
    *,
    staging_dir: Path,
    allow_regional_fallback: bool,
) -> dict[str, Any]:
    _require(isinstance(entry, dict), "reverify record: expected object")
    _require(entry.get("status") == "verified", "reverify record: status must be verified")
    official_key = _require_string(entry.get("official_key"), "reverify.records[].official_key")
    exam_date = _require_string(entry.get("internal_exam_date"), f"{official_key}.internal_exam_date")
    shift = _require_int(entry.get("internal_shift"), f"{official_key}.internal_shift")
    _require(
        official_key == acquisition._official_key(exam_date, shift),
        f"{official_key}: inconsistent official key fields",
    )
    if entry.get("candidate_language_variant") == "regional" and not allow_regional_fallback:
        raise ImportError(
            f"{official_key}: regional fallback canonical candidate requires --allow-regional-fallback"
        )
    staged_path = _validate_staged_path(
        _require_string(entry.get("quarantine_path"), f"{official_key}.quarantine_path"),
        staging_dir,
        official_key,
    )
    actual_sha256 = sha256_file(staged_path)
    actual_size = staged_path.stat().st_size
    actual_page_count = acquisition._pdf_page_count(staged_path)
    _require(staged_path.read_bytes()[:5] == b"%PDF-", f"{official_key}: staged file is not a PDF")
    _require(
        actual_sha256 == _require_string(entry.get("sha256"), f"{official_key}.sha256"),
        f"{official_key}: recorded sha256 does not match staged file",
    )
    _require(
        actual_size == _require_int(entry.get("size_bytes"), f"{official_key}.size_bytes"),
        f"{official_key}: recorded size_bytes does not match staged file",
    )
    _require(
        actual_page_count == _require_int(entry.get("page_count"), f"{official_key}.page_count"),
        f"{official_key}: recorded page_count does not match staged file",
    )
    paper_url = _require_string(entry.get("paper_url"), f"{official_key}.paper_url")
    candidate_stub = {
        "paper_file": _require_string(entry.get("paper_file"), f"{official_key}.paper_file"),
        "paper_url": paper_url,
        "reported_schedule_keys": list(entry.get("reported_schedule_keys") or []),
        "plan_reason": entry.get("plan_reason"),
        "language_variant": entry.get("candidate_language_variant"),
    }
    schedule_entry = {
        "official_key": official_key,
        "exam_date": exam_date,
        "shift": shift,
        "evidence_type": _require_string(entry.get("evidence_type"), f"{official_key}.evidence_type"),
        "expected_gap": bool(entry.get("expected_gap")),
        "session_id": _require_string(entry.get("session_id"), f"{official_key}.session_id"),
        "session_label": _require_string(entry.get("session_label"), f"{official_key}.session_label"),
        "source_url": _require_string(entry.get("source_url"), f"{official_key}.source_url"),
        "alternate_source_urls": list(entry.get("alternate_source_urls") or []),
        "year": _require_int(entry.get("year"), f"{official_key}.year"),
    }
    evaluated = acquisition._evaluate_pdf_metadata(
        candidate=candidate_stub,
        schedule_index={"by_key": {official_key: schedule_entry}},
        staged_path=staged_path,
        sha256=actual_sha256,
        size_bytes=actual_size,
        page_count=actual_page_count,
        pdf_magic=True,
        preview_text=acquisition._pdftotext_preview(staged_path),
    )
    _require(evaluated.get("status") == "verified", f"{official_key}: local re-verification no longer passes")
    _require(
        evaluated.get("official_key") == official_key,
        f"{official_key}: local re-verification resolved to {evaluated.get('official_key')!r}",
    )
    _require(
        (evaluated.get("question_paper_name") or "").strip()
        == (entry.get("question_paper_name") or "").strip(),
        f"{official_key}: recorded question_paper_name mismatch",
    )
    _require(
        (evaluated.get("subject_name") or "").strip()
        == (entry.get("subject_name") or "").strip(),
        f"{official_key}: recorded subject_name mismatch",
    )
    _require(
        (evaluated.get("creation_date") or None) == entry.get("creation_date"),
        f"{official_key}: recorded creation_date mismatch",
    )
    _require(
        (evaluated.get("language") or None) == entry.get("language"),
        f"{official_key}: recorded language mismatch",
    )
    _require(
        (evaluated.get("language_variant") or None) == entry.get("language_variant"),
        f"{official_key}: recorded language_variant mismatch",
    )
    retrieved_at = _require_string(entry.get("retrieved_at"), f"{official_key}.retrieved_at")
    document_id = _document_id(exam_date, shift)
    raw_path = DATA_ROOT / "raw" / f"{document_id}.pdf"
    return {
        "document_id": document_id,
        "official_key": official_key,
        "exam_date": exam_date,
        "shift": shift,
        "year": schedule_entry["year"],
        "session_label": schedule_entry["session_label"],
        "session_id": schedule_entry["session_id"],
        "schedule_source_url": schedule_entry["source_url"],
        "alternate_source_urls": schedule_entry["alternate_source_urls"],
        "evidence_type": schedule_entry["evidence_type"],
        "expected_gap": schedule_entry["expected_gap"],
        "paper_url": paper_url,
        "sha256": actual_sha256,
        "size_bytes": actual_size,
        "page_count": actual_page_count,
        "retrieved_at": retrieved_at,
        "language": _language_label(evaluated.get("language"), evaluated.get("language_variant")),
        "language_variant": evaluated.get("language_variant"),
        "question_paper_name": evaluated.get("question_paper_name"),
        "subject_name": evaluated.get("subject_name"),
        "creation_date": evaluated.get("creation_date"),
        "staged_path": staged_path,
        "raw_path": raw_path,
        "regional_fallback": evaluated.get("language_variant") == "regional",
    }


def _document_record(candidate: dict[str, Any]) -> dict[str, Any]:
    notes = {
        "canonical_language_variant": candidate["language_variant"],
        "creation_date": candidate["creation_date"],
        "evidence_type": candidate["evidence_type"],
        "official_key": candidate["official_key"],
        "question_paper_name": candidate["question_paper_name"],
        "redistribution": "rights_review_required",
        "report_schema_version": IMPORT_SCHEMA_VERSION,
        "schedule_alternate_source_urls": candidate["alternate_source_urls"],
        "schedule_session_id": candidate["session_id"],
        "schedule_session_label": candidate["session_label"],
        "schedule_source_url": candidate["schedule_source_url"],
        "subject_name": candidate["subject_name"],
        "verification_status": "official_canonical_candidate",
    }
    record = {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "document_id": candidate["document_id"],
        "provenance": {
            "publisher": "National Testing Agency",
            "source_type": "official",
            "retrieved_at": candidate["retrieved_at"],
            "notes": json.dumps(notes, ensure_ascii=False, sort_keys=True),
        },
        "year": candidate["year"],
        "exam": "JEE Main",
        "session": _month_session(candidate["exam_date"]),
        "set": f"{candidate['exam_date']} shift {candidate['shift']}",
        "subject": "Physics, Chemistry, Mathematics",
        "source_url": candidate["paper_url"],
        "paper": {
            "stage": "main",
            "paper_number": "B.E./B.Tech Paper 1",
            "exam_date": candidate["exam_date"],
            "shift": str(candidate["shift"]),
            "mode": "computer_based",
            "language": candidate["language"],
            "accessibility_variant": "standard",
        },
        "artifact": {
            "media_type": "application/pdf",
            "page_count": candidate["page_count"],
            "container_url": None,
            "container_sha256": None,
            "member_path": None,
        },
        "sha256": candidate["sha256"],
        "status": "acquired",
    }
    validate_document(record)
    return record


def _preflight_import(
    *,
    report: dict[str, Any],
    report_schema_version: str,
    staging_dir: Path,
    manifest_path: Path,
    raw_dir: Path,
    allow_regional_fallback: bool,
) -> dict[str, Any]:
    if report_schema_version == acquisition.REPORT_SCHEMA_VERSION:
        canonical_entries = sorted(
            report["canonical_candidates"],
            key=lambda item: (item["exam_date"], item["shift"]),
        )
        candidates = [
            _verified_candidate_payload(
                entry,
                staging_dir=staging_dir,
                allow_regional_fallback=allow_regional_fallback,
            )
            for entry in canonical_entries
        ]
        missing_schedule_keys = report["missing_schedule_keys"]
    elif report_schema_version == reverify_quarantine.REPORT_SCHEMA_VERSION:
        verified_entries = sorted(
            [entry for entry in report["records"] if entry.get("status") == "verified"],
            key=lambda item: (item["internal_exam_date"], item["internal_shift"]),
        )
        _require(verified_entries, "reverify report: no verified records to import")
        candidates = [
            _verified_reverify_payload(
                entry,
                staging_dir=staging_dir,
                allow_regional_fallback=allow_regional_fallback,
            )
            for entry in verified_entries
        ]
        missing_schedule_keys = []
    else:
        raise ImportError(f"unsupported import source schema: {report_schema_version}")

    existing_documents = load_documents(manifest_path) if manifest_path.exists() else []
    existing_by_id = {item["document_id"]: item for item in existing_documents}
    existing_raw_hashes: dict[str, str] = {}
    for candidate in candidates:
        raw_path = raw_dir / f"{candidate['document_id']}.pdf"
        candidate["raw_path"] = raw_path
        if raw_path.exists():
            existing_raw_hashes[candidate["document_id"]] = sha256_file(raw_path)

    actions: list[dict[str, Any]] = []
    for candidate in candidates:
        previous = existing_by_id.get(candidate["document_id"])
        if previous is not None:
            _require(
                previous["sha256"] == candidate["sha256"],
                f"{candidate['document_id']}: manifest hash conflict {previous['sha256']} != {candidate['sha256']}",
            )
        raw_hash = existing_raw_hashes.get(candidate["document_id"])
        if raw_hash is not None:
            _require(
                raw_hash == candidate["sha256"],
                f"{candidate['document_id']}: raw PDF hash conflict {raw_hash} != {candidate['sha256']}",
            )
        record = _document_record(candidate)
        actions.append(
            {
                "candidate": candidate,
                "record": record,
                "manifest_exists": previous is not None,
                "raw_exists": raw_hash is not None,
            }
        )
    return {
        "existing_documents": existing_documents,
        "actions": actions,
        "missing_schedule_keys": missing_schedule_keys,
    }


def import_nta_jee_main(
    report_path: Path,
    staging_dir: Path,
    manifest_path: Path,
    raw_dir: Path,
    output_report_path: Path,
    *,
    allow_regional_fallback: bool = False,
) -> dict[str, Any]:
    raw_report = _load_json(report_path)
    report_schema_version = raw_report.get("schema_version")
    if report_schema_version == acquisition.REPORT_SCHEMA_VERSION:
        report = _validate_acquisition_report(raw_report)
    elif report_schema_version == reverify_quarantine.REPORT_SCHEMA_VERSION:
        report = _validate_reverify_report(raw_report)
    else:
        raise ImportError(f"unsupported import source schema: {report_schema_version}")
    preflight = _preflight_import(
        report=report,
        report_schema_version=report_schema_version,
        staging_dir=staging_dir,
        manifest_path=manifest_path,
        raw_dir=raw_dir,
        allow_regional_fallback=allow_regional_fallback,
    )

    actions = preflight["actions"]
    created_raw_paths: list[Path] = []
    try:
        for action in actions:
            if action["raw_exists"]:
                continue
            data = action["candidate"]["staged_path"].read_bytes()
            destination = action["candidate"]["raw_path"]
            _atomic_write_bytes(destination, data)
            _require(
                sha256_file(destination) == action["candidate"]["sha256"],
                f"{action['candidate']['document_id']}: failed to persist exact raw bytes",
            )
            created_raw_paths.append(destination)

        by_id = {item["document_id"]: item for item in preflight["existing_documents"]}
        for action in actions:
            if action["manifest_exists"]:
                continue
            by_id[action["record"]["document_id"]] = action["record"]
        documents = sorted(by_id.values(), key=lambda item: item["document_id"])
        validate_corpus(documents, [])
        write_jsonl(manifest_path, documents)
    except BaseException:
        for created_path in reversed(created_raw_paths):
            try:
                created_path.unlink()
            except FileNotFoundError:
                pass
        raise

    imported_ids = sorted(
        action["record"]["document_id"] for action in actions if not action["manifest_exists"]
    )
    reused_manifest_ids = sorted(
        action["record"]["document_id"] for action in actions if action["manifest_exists"]
    )
    copied_raw_ids = sorted(
        action["record"]["document_id"] for action in actions if not action["raw_exists"]
    )
    reused_raw_ids = sorted(
        action["record"]["document_id"] for action in actions if action["raw_exists"]
    )

    import_report = {
        "schema_version": IMPORT_SCHEMA_VERSION,
        "operation": "import-nta-jee-main",
        "source_release_status": "candidate_only",
        "input_report_path": str(report_path),
        "input_report_schema_version": report_schema_version,
        "staging_dir": str(staging_dir),
        "manifest_path": str(manifest_path),
        "raw_dir": str(raw_dir),
        "allow_regional_fallback": allow_regional_fallback,
        "imported_document_ids": imported_ids,
        "reused_manifest_document_ids": reused_manifest_ids,
        "copied_raw_document_ids": copied_raw_ids,
        "reused_raw_document_ids": reused_raw_ids,
        "missing_schedule_keys": [
            _stable_missing_key_view(item)
            for item in sorted(
                preflight["missing_schedule_keys"],
                key=lambda row: (row["exam_date"], row["shift"]),
            )
        ],
        "summary": {
            "canonical_candidates": len(actions),
            "imported_documents": len(imported_ids),
            "reused_manifest_documents": len(reused_manifest_ids),
            "copied_raw_documents": len(copied_raw_ids),
            "reused_raw_documents": len(reused_raw_ids),
            "missing_schedule_keys": len(preflight["missing_schedule_keys"]),
        },
        "by_year": dict(
            sorted(
                Counter(str(action["record"]["year"]) for action in actions).items()
            )
        ),
        "notes": [
            "Only canonical official NTA candidates are imported.",
            "Partial official imports are allowed; remaining schedule gaps stay candidate_only.",
            "Question text is intentionally excluded from the import report.",
        ],
    }
    _atomic_json(output_report_path, import_report)
    return import_report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition-report", type=Path, default=DEFAULT_ACQUISITION_REPORT)
    parser.add_argument("--staging-dir", type=Path, default=DEFAULT_STAGING_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--allow-regional-fallback", action="store_true")
    args = parser.parse_args()

    report = import_nta_jee_main(
        args.acquisition_report,
        args.staging_dir,
        args.manifest,
        args.raw_dir,
        args.report,
        allow_regional_fallback=args.allow_regional_fallback,
    )
    print(
        json.dumps(
            {
                "report": str(args.report),
                "imported_documents": report["summary"]["imported_documents"],
                "reused_manifest_documents": report["summary"]["reused_manifest_documents"],
                "missing_schedule_keys": report["summary"]["missing_schedule_keys"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
