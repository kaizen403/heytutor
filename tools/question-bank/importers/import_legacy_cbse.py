#!/usr/bin/env python3
"""Import verified legacy CBSE artifacts into the local canonical manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    load_documents,
    sha256_file,
    validate_corpus,
    validate_document,
    write_jsonl,
)
from question_bank.pipeline import pdf_page_count

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_REPORT = DATA_ROOT / "reports" / "coverage" / "legacy-cbse-coverage-2026-08-10.json"
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
DEFAULT_RAW_DIR = DATA_ROOT / "raw"


class ImportError(RuntimeError):
    """Raised when staged bytes do not match the verified legacy report."""


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized or "paper"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def _verified_staged_path(artifact: dict[str, Any], staging_dir: Path) -> Path:
    value = artifact.get("staged_path")
    if not isinstance(value, str) or not value:
        raise ImportError(f"{artifact['artifact_id']}: report has no staged_path")
    path = Path(value).resolve()
    if path.parent != staging_dir.resolve():
        raise ImportError(
            f"{artifact['artifact_id']}: staged path escapes --staging-dir: {path}"
        )
    if not path.is_file():
        raise ImportError(f"{artifact['artifact_id']}: missing staged artifact: {path}")
    actual_hash = sha256_file(path)
    if actual_hash != artifact["sha256"]:
        raise ImportError(
            f"{artifact['artifact_id']}: container hash mismatch: "
            f"{actual_hash} != {artifact['sha256']}"
        )
    return path


def _rar_member_bytes(archive_path: Path, member: str) -> bytes:
    executable = shutil.which("unrar")
    if executable is None:
        raise ImportError("RAR artifact encountered but `unrar` is unavailable")
    completed = subprocess.run(
        [executable, "p", "-inul", str(archive_path), member],
        check=False,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise ImportError(f"failed to read {archive_path.name}!{member}")
    return completed.stdout


def _archive_pdf_payloads(
    artifact: dict[str, Any], archive_path: Path
) -> Iterable[tuple[str, bytes]]:
    declared_members = artifact.get("members")
    if not isinstance(declared_members, list):
        raise ImportError(f"{artifact['artifact_id']}: archive report has no member list")
    pdf_members = sorted(
        member
        for member in declared_members
        if isinstance(member, str) and member.casefold().endswith(".pdf")
    )
    if artifact["kind"] == "zip":
        with zipfile.ZipFile(archive_path) as archive:
            actual_members = {
                info.filename for info in archive.infolist() if not info.is_dir()
            }
            missing = sorted(set(pdf_members) - actual_members)
            if missing:
                raise ImportError(
                    f"{artifact['artifact_id']}: declared ZIP members missing: {missing[:10]}"
                )
            for member in pdf_members:
                yield member, archive.read(member)
        return
    if artifact["kind"] == "rar":
        for member in pdf_members:
            yield member, _rar_member_bytes(archive_path, member)
        return
    raise ImportError(f"unsupported archive kind: {artifact['kind']!r}")


def _accessibility_variant(artifact: dict[str, Any], member: str | None) -> str:
    if artifact.get("accessibility_variant") == "blind":
        return "blind"
    name = member or artifact["artifact_id"]
    if "blind" in name.casefold() or re.search(r"\b(?:55|65)\s*\(\s*b\s*\)", name, re.I):
        return "blind"
    return "standard"


def _document_id(artifact_id: str, member: str | None) -> str:
    if member is None:
        return artifact_id
    member_token = hashlib.sha256(member.encode("utf-8")).hexdigest()[:10]
    return f"{artifact_id}-{_slug(Path(member).stem)[:68]}-{member_token}"


def _document_record(
    artifact: dict[str, Any],
    *,
    document_id: str,
    pdf_path: Path,
    retrieved_at: str,
    member: str | None,
) -> dict[str, Any]:
    container = member is not None
    accessibility = _accessibility_variant(artifact, member)
    notes = {
        "accessibility_variant": accessibility,
        "artifact_id": artifact["artifact_id"],
        "legacy_source_page_url": artifact["source_page_url"],
        "region": artifact.get("region"),
        "report_schema_version": "question-bank-legacy-cbse-sources/v1",
        "redistribution": "rights_review_required",
        "verification_status": artifact["verification_status"],
    }
    if member is not None:
        notes["archive_member"] = member
        notes["archive_sha256"] = artifact["sha256"]
    set_name = member or artifact.get("set_label") or artifact.get("region") or "not_applicable"
    record = {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "document_id": document_id,
        "provenance": {
            "publisher": "Central Board of Secondary Education",
            "source_type": "official",
            "retrieved_at": retrieved_at,
            "notes": json.dumps(notes, ensure_ascii=False, sort_keys=True),
        },
        "year": artifact["year"],
        "exam": "CBSE Class XII Board Examination",
        "session": artifact["session"],
        "set": set_name,
        "subject": artifact["subject"],
        "source_url": artifact["url"],
        "paper": {
            "stage": artifact["session"],
            "paper_number": None,
            "exam_date": None,
            "shift": None,
            "mode": "offline",
            "language": "English",
            "accessibility_variant": accessibility,
        },
        "artifact": {
            "media_type": "application/pdf",
            "page_count": pdf_page_count(pdf_path),
            "container_url": artifact["url"] if container else None,
            "container_sha256": artifact["sha256"] if container else None,
            "member_path": member,
        },
        "sha256": sha256_file(pdf_path),
        "status": "acquired",
    }
    validate_document(record)
    return record


def import_legacy_cbse(
    report_path: Path,
    staging_dir: Path,
    manifest_path: Path,
    raw_dir: Path,
) -> dict[str, Any]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("schema_version") != "question-bank-legacy-cbse-sources/v1":
        raise ImportError("unsupported legacy CBSE report schema")
    retrieved_at = report.get("generated_at")
    if not isinstance(retrieved_at, str) or not retrieved_at:
        raise ImportError("legacy CBSE report has no generated_at timestamp")

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for artifact in report.get("artifacts", []):
        archive_path = _verified_staged_path(artifact, staging_dir)
        if artifact.get("verification_status") != "verified":
            skipped.append(
                {
                    "artifact_id": artifact["artifact_id"],
                    "reason": f"verification-status-{artifact.get('verification_status')}",
                }
            )
            continue
        payloads: Iterable[tuple[str | None, bytes]]
        if artifact["kind"] == "pdf":
            payloads = [(None, archive_path.read_bytes())]
        else:
            payloads = _archive_pdf_payloads(artifact, archive_path)
        for member, data in payloads:
            if member is not None and "urdu" in member.casefold():
                skipped.append(
                    {
                        "artifact_id": artifact["artifact_id"],
                        "member": member,
                        "reason": "non-english-urdu-variant",
                    }
                )
                continue
            if b"%PDF-" not in data[:1024]:
                skipped.append(
                    {
                        "artifact_id": artifact["artifact_id"],
                        **({"member": member} if member is not None else {}),
                        "reason": "missing-pdf-header-magic",
                    }
                )
                continue
            document_id = _document_id(artifact["artifact_id"], member)
            destination = raw_dir / f"{document_id}.pdf"
            _atomic_write_bytes(destination, data)
            if sha256_file(destination) != _sha256_bytes(data):
                raise ImportError(f"failed to persist exact bytes for {document_id}")
            imported.append(
                _document_record(
                    artifact,
                    document_id=document_id,
                    pdf_path=destination,
                    retrieved_at=retrieved_at,
                    member=member,
                )
            )

    existing = load_documents(manifest_path) if manifest_path.exists() else []
    by_id = {document["document_id"]: document for document in existing}
    for document in imported:
        previous = by_id.get(document["document_id"])
        if previous is not None and previous["sha256"] != document["sha256"]:
            raise ImportError(
                f"source bytes changed for {document['document_id']}: "
                f"{previous['sha256']} -> {document['sha256']}"
            )
        by_id[document["document_id"]] = document
    documents = sorted(by_id.values(), key=lambda item: item["document_id"])
    validate_corpus(documents, [])
    write_jsonl(manifest_path, documents)

    hashes: dict[str, list[str]] = defaultdict(list)
    for document in imported:
        hashes[document["sha256"]].append(document["document_id"])
    duplicate_groups = [group for group in hashes.values() if len(group) > 1]
    return {
        "operation": "import-legacy-cbse",
        "report": str(report_path),
        "retrieved_at": retrieved_at,
        "imported_documents": len(imported),
        "manifest_documents": len(documents),
        "by_year": dict(sorted(Counter(str(item["year"]) for item in imported).items())),
        "by_subject": dict(sorted(Counter(item["subject"] for item in imported).items())),
        "duplicate_pdf_hash_groups": len(duplicate_groups),
        "duplicate_pdf_occurrences": sum(len(group) for group in duplicate_groups),
        "skipped": skipped,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--staging-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--report", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = import_legacy_cbse(
            args.source_report, args.staging_dir, args.manifest, args.raw_dir
        )
        if args.report is not None:
            _atomic_json(args.report, result)
            result = {**result, "import_report": str(args.report)}
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (ImportError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=os.sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
