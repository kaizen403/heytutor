#!/usr/bin/env python3
"""Catalog and import the first official HeyTutor exam-paper corpus.

The source catalog is deliberately explicit.  It describes only artifacts that
were verified on the issuer's site; it does not turn filename guesses into
sources.  Raw PDFs remain local, while the resulting manifest is small enough
to review and commit.
"""

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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    load_documents,
    sha256_file,
    validate_corpus,
    validate_document,
    write_jsonl,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_CATALOG = DATA_ROOT / "source-catalog.json"
DEFAULT_MANIFEST = DATA_ROOT / "manifest.jsonl"
DEFAULT_RAW_DIR = DATA_ROOT / "raw"
DEFAULT_TEXT_DIR = DATA_ROOT / "text"

CATALOG_SCHEMA_VERSION = "question-bank-source-catalog/v1"
RETRIEVAL_NOTE = "Internal research corpus; redistribution rights require review."


class ImportError(RuntimeError):
    """Raised when staged bytes do not match the declared source catalog."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "not-applicable"


def _jee_advanced_sources() -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    for year in range(2007, 2027):
        for paper in (1, 2):
            if year <= 2018:
                filename = f"{year}_{paper}.pdf"
                url = f"https://jeeadv.ac.in/past_qps/{filename}"
            elif year <= 2025:
                filename = f"{year}_{paper}_English.pdf"
                url = f"https://jeeadv.ac.in/past_qps/{filename}"
            else:
                filename = f"p{paper}_english.pdf"
                url = f"https://jeeadv.ac.in/documents/{filename}"
            sources.append(
                {
                    "artifact_id": f"jee-advanced-{year}-paper-{paper}-english",
                    "kind": "pdf",
                    "local_name": filename,
                    "publisher": "JEE (Advanced) Joint Admission Board",
                    "source_type": "official",
                    "exam": "JEE Advanced",
                    "year": year,
                    "session": f"Paper {paper}",
                    "set": "English",
                    "subject": "Physics, Chemistry, Mathematics",
                    "url": url,
                    "language": "English",
                    "accessibility_variant": "standard",
                    "stage": "main",
                    "paper_number": str(paper),
                    "mode": "computer_based" if year >= 2018 else "offline",
                }
            )
    return sources


def _jee_main_2026_sources() -> list[dict[str, Any]]:
    rows = [
        ("2026-04-02", "1", "202604092096865379.pdf"),
        ("2026-04-02", "2", "20260409481957146.pdf"),
        ("2026-04-04", "1", "202604091916616339.pdf"),
        ("2026-04-04", "2", "20260409432593766.pdf"),
        ("2026-04-05", "1", "20260409828731207.pdf"),
        ("2026-04-05", "2", "20260409829414602.pdf"),
        ("2026-04-06", "1", "202604092007095665.pdf"),
        ("2026-04-06", "2", "20260409725707538.pdf"),
        ("2026-04-08", "2", "20260409932754345.pdf"),
    ]
    sources: list[dict[str, Any]] = []
    cdn = (
        "https://cdnbbsr.s3waas.gov.in/"
        "s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/04"
    )
    for exam_date, shift, remote_name in rows:
        local_name = f"jee-main-{exam_date}-shift-{shift}.pdf"
        sources.append(
            {
                "artifact_id": local_name.removesuffix(".pdf"),
                "kind": "pdf",
                "local_name": local_name,
                "publisher": "National Testing Agency",
                "source_type": "official",
                "exam": "JEE Main",
                "year": 2026,
                "session": "April",
                "set": f"{exam_date} shift {shift}",
                "subject": "Physics, Chemistry, Mathematics",
                "url": f"{cdn}/{remote_name}",
                "language": "English",
                "accessibility_variant": "standard",
                "stage": "main",
                "paper_number": "B.E./B.Tech Paper 1",
                "exam_date": exam_date,
                "shift": shift,
                "mode": "computer_based",
            }
        )
    return sources


def _cbse_sources() -> list[dict[str, Any]]:
    rows = [
        (2022, "main", "mathematics", "Math.zip"),
        (2022, "main", "physics", "Physics.zip"),
        (2022, "compartment", "mathematics", "MATHS.zip"),
        (2022, "compartment", "physics", "PHYSICS.zip"),
        (2023, "main", "mathematics", "MATHEMATICS.zip"),
        (2023, "main", "physics", "PHYSICS.zip"),
        (2023, "compartment", "mathematics", "Mathematics.zip"),
        (2023, "compartment", "physics", "Physics.zip"),
        (2024, "main", "mathematics", "MATHEMATICS.zip"),
        (2024, "main", "physics", "PHYSICS.zip"),
        (2024, "compartment", "mathematics", "Mathematics.zip"),
        (2024, "compartment", "physics", "Physics.zip"),
        (2025, "main", "mathematics", "MATHEMATICS.zip"),
        (2025, "main", "physics", "PHYSICS.zip"),
        (2025, "compartment", "mathematics", "Mathematics.zip"),
        (2025, "compartment", "physics", "Physics.zip"),
        (2026, "main", "mathematics", "Mathematics.zip"),
        (2026, "main", "physics", "Physics.zip"),
    ]
    sources: list[dict[str, Any]] = []
    for year, session, subject_slug, remote_name in rows:
        tree = f"{year}-COMPTT" if session == "compartment" else str(year)
        local_name = f"cbse-{year}-{session}-{subject_slug}.zip"
        sources.append(
            {
                "artifact_id": local_name.removesuffix(".zip"),
                "kind": "zip",
                "local_name": local_name,
                "publisher": "Central Board of Secondary Education",
                "source_type": "official",
                "exam": "CBSE Class XII Board Examination",
                "year": year,
                "session": session,
                "set": "archive-member",
                "subject": subject_slug.title(),
                "url": (
                    "https://www.cbse.gov.in/cbsenew/question-paper/"
                    f"{tree}/XII/{remote_name}"
                ),
                "language": "English",
                "accessibility_variant": "member-dependent",
                "stage": session,
                "paper_number": None,
                "mode": "offline",
            }
        )
    return sources


def build_catalog() -> dict[str, Any]:
    artifacts = [*_jee_advanced_sources(), *_jee_main_2026_sources(), *_cbse_sources()]
    return {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "as_of": "2026-08-10",
        "scope": {
            "mathematics": "Three-Dimensional Geometry",
            "physics": "Electromagnetic Induction and Alternating Current",
        },
        "artifacts": artifacts,
        "known_gaps": [
            {
                "collection": "IIT-JEE / JEE Advanced",
                "years": "2000-2006",
                "status": "no_official_archive",
                "notes": "Screening and Main stages require two-source validation of legacy mirrors.",
            },
            {
                "collection": "JEE Main / AIEEE",
                "years": "2000-2026",
                "status": "pending_separate_shift_inventory",
                "notes": "NTA metadata is noisy; internal paper headers must be verified before import.",
            },
            {
                "collection": "CBSE Class XII",
                "years": "2000-2006",
                "status": "no_first_party_archive_located",
                "notes": "Do not claim completeness from commercial mirrors.",
            },
            {
                "collection": "CBSE Class XII",
                "years": "2007-2020",
                "status": "official_legacy_backfill_pending",
                "notes": "Live official coverage is fragmented; 2008 Physics and 2013/2014/2019 main are known gaps.",
            },
            {
                "collection": "CBSE Class XII",
                "years": "2021",
                "status": "regular_exam_cancelled",
                "notes": "There is no genuine 2021 annual main paper.",
            },
            {
                "collection": "CBSE Class XII supplementary",
                "years": "2026",
                "status": "not_published_as_of_catalog_date",
                "notes": "The official page lists no Class XII 2026 supplementary archive.",
            },
        ],
    }


def _validate_catalog(value: Any, path: str = "source catalog") -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ImportError(f"{path}: expected an object")
    expected_root = {"schema_version", "as_of", "scope", "artifacts", "known_gaps"}
    if set(value) != expected_root:
        raise ImportError(
            f"{path}: expected exactly {', '.join(sorted(expected_root))}"
        )
    if value["schema_version"] != CATALOG_SCHEMA_VERSION:
        raise ImportError(f"{path}: unsupported schema version")
    if not isinstance(value["as_of"], str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}", value["as_of"]
    ):
        raise ImportError(f"{path}.as_of: expected YYYY-MM-DD")
    if not isinstance(value["scope"], dict) or set(value["scope"]) != {
        "mathematics",
        "physics",
    }:
        raise ImportError(f"{path}.scope: expected mathematics and physics")
    if not all(
        isinstance(item, str) and item.strip() for item in value["scope"].values()
    ):
        raise ImportError(f"{path}.scope: values must be non-empty strings")

    artifacts = value["artifacts"]
    if not isinstance(artifacts, list):
        raise ImportError(f"{path}.artifacts: expected an array")
    required_artifact = {
        "artifact_id",
        "kind",
        "local_name",
        "publisher",
        "source_type",
        "exam",
        "year",
        "session",
        "set",
        "subject",
        "url",
        "language",
        "accessibility_variant",
        "stage",
        "paper_number",
        "mode",
    }
    optional_artifact = {"exam_date", "shift"}
    artifact_ids: set[str] = set()
    for index, artifact in enumerate(artifacts):
        item_path = f"{path}.artifacts[{index}]"
        if not isinstance(artifact, dict) or not required_artifact.issubset(artifact) or (
            set(artifact) - required_artifact - optional_artifact
        ):
            raise ImportError(f"{item_path}: invalid artifact fields")
        artifact_id = artifact["artifact_id"]
        if (
            not isinstance(artifact_id, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", artifact_id)
            or artifact_id in artifact_ids
        ):
            raise ImportError(f"{item_path}.artifact_id: expected a unique safe id")
        artifact_ids.add(artifact_id)
        if artifact["kind"] not in {"pdf", "zip"}:
            raise ImportError(f"{item_path}.kind: expected pdf or zip")
        for field in (
            "local_name",
            "publisher",
            "source_type",
            "exam",
            "session",
            "set",
            "subject",
            "language",
            "accessibility_variant",
            "stage",
            "mode",
        ):
            if not isinstance(artifact[field], str) or not artifact[field].strip():
                raise ImportError(f"{item_path}.{field}: expected a non-empty string")
        if artifact["source_type"] not in {
            "official",
            "institutional_archive",
            "public_archive",
            "third_party",
            "unknown",
        }:
            raise ImportError(f"{item_path}.source_type: unsupported value")
        if artifact["mode"] not in {"offline", "computer_based", "unknown"}:
            raise ImportError(f"{item_path}.mode: unsupported value")
        if (
            not isinstance(artifact["year"], int)
            or isinstance(artifact["year"], bool)
            or not 1900 <= artifact["year"] <= 2100
        ):
            raise ImportError(f"{item_path}.year: expected 1900 through 2100")
        parsed_url = urlparse(artifact["url"]) if isinstance(artifact["url"], str) else None
        if parsed_url is None or parsed_url.scheme != "https" or not parsed_url.netloc:
            raise ImportError(f"{item_path}.url: expected an HTTPS URL")
        paper_number = artifact["paper_number"]
        if paper_number is not None and (
            not isinstance(paper_number, str) or not paper_number.strip()
        ):
            raise ImportError(f"{item_path}.paper_number: expected string or null")
        exam_date = artifact.get("exam_date")
        if exam_date is not None and (
            not isinstance(exam_date, str)
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", exam_date)
        ):
            raise ImportError(f"{item_path}.exam_date: expected YYYY-MM-DD")
        shift = artifact.get("shift")
        if shift is not None and (not isinstance(shift, str) or not shift.strip()):
            raise ImportError(f"{item_path}.shift: expected a non-empty string")

    known_gaps = value["known_gaps"]
    if not isinstance(known_gaps, list):
        raise ImportError(f"{path}.known_gaps: expected an array")
    for index, gap in enumerate(known_gaps):
        item_path = f"{path}.known_gaps[{index}]"
        if not isinstance(gap, dict) or set(gap) != {
            "collection",
            "years",
            "status",
            "notes",
        }:
            raise ImportError(f"{item_path}: invalid gap fields")
        if not all(isinstance(item, str) and item.strip() for item in gap.values()):
            raise ImportError(f"{item_path}: values must be non-empty strings")
    return value


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


def _load_catalog(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise ImportError(f"cannot load source catalog {path}: {exc}") from exc
    return _validate_catalog(value, str(path))


def _is_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as source:
            return b"%PDF-" in source.read(1024)
    except FileNotFoundError:
        return False


def _zip_pdf_hashes(path: Path) -> dict[str, str]:
    """Return verified PDF member hashes keyed by their exact archive names."""

    member_hashes: dict[str, str] = {}
    try:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir() or not info.filename.casefold().endswith(".pdf"):
                    continue
                member_path = Path(info.filename)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise ImportError(f"unsafe archive member in {path}: {info.filename}")
                digest = hashlib.sha256()
                with archive.open(info) as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                member_hash = digest.hexdigest()
                previous = member_hashes.get(info.filename)
                if previous is not None and previous != member_hash:
                    raise ImportError(
                        f"duplicate archive member has different bytes in {path}: "
                        f"{info.filename}"
                    )
                member_hashes[info.filename] = member_hash
    except (zipfile.BadZipFile, OSError) as exc:
        raise ImportError(f"cannot verify ZIP container {path}: {exc}") from exc
    return member_hashes


def _pdf_page_count(path: Path) -> int | None:
    executable = shutil.which("pdfinfo")
    if executable is None:
        return None
    completed = subprocess.run(
        [executable, str(path)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        return None
    match = re.search(r"^Pages:\s+(\d+)\s*$", completed.stdout, re.MULTILINE)
    return int(match.group(1)) if match else None


def _atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".copy", dir=destination.parent
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        temporary_path.unlink()
        try:
            os.link(source, temporary_path)
        except OSError:
            shutil.copyfile(source, temporary_path)
        os.replace(temporary_path, destination)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _copy_text_if_present(
    document_id: str,
    source_filename: str,
    native_text_dir: Path | None,
    ocr_text_dir: Path | None,
    destination_dir: Path,
) -> str | None:
    stem = Path(source_filename).stem
    candidates: list[tuple[str, Path]] = []
    if ocr_text_dir is not None:
        candidates.append(("tesseract-ocr", ocr_text_dir / f"{stem}.txt"))
    if native_text_dir is not None:
        candidates.append(("pdftotext-layout", native_text_dir / f"{stem}.txt"))
    for method, source in candidates:
        if source.is_file() and source.stat().st_size >= 1000:
            _atomic_copy(source, destination_dir / f"{document_id}.txt")
            return method
    return None


def _accessibility_variant(member: str) -> str:
    lower = member.casefold()
    if any(token in lower for token in ("blind", "visually", "vi candidate", "(b)", "_b")):
        return "visually-impaired"
    return "standard"


def _document_record(
    artifact: dict[str, Any],
    *,
    document_id: str,
    source_pdf: Path,
    retrieved_at: str,
    set_name: str,
    notes: dict[str, Any],
    container_url: str | None = None,
    container_sha256: str | None = None,
    member_path: str | None = None,
) -> dict[str, Any]:
    record = {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "document_id": document_id,
        "provenance": {
            "publisher": artifact["publisher"],
            "source_type": artifact["source_type"],
            "retrieved_at": retrieved_at,
            "notes": json.dumps(notes, ensure_ascii=False, sort_keys=True),
        },
        "year": artifact["year"],
        "exam": artifact["exam"],
        "session": artifact["session"],
        "set": set_name,
        "subject": artifact["subject"],
        "source_url": artifact["url"],
        "paper": {
            "stage": artifact["stage"],
            "paper_number": artifact["paper_number"],
            "exam_date": artifact.get("exam_date"),
            "shift": artifact.get("shift"),
            "mode": artifact["mode"],
            "language": artifact["language"],
            "accessibility_variant": notes["accessibility_variant"],
        },
        "artifact": {
            "media_type": "application/pdf",
            "page_count": _pdf_page_count(source_pdf),
            "container_url": container_url,
            "container_sha256": container_sha256,
            "member_path": member_path,
        },
        "sha256": sha256_file(source_pdf),
        "status": "acquired",
    }
    validate_document(record)
    return record


def import_staged(
    catalog_path: Path,
    manifest_path: Path,
    raw_dir: Path,
    text_dir: Path,
    *,
    jee_dir: Path,
    cbse_archive_dir: Path,
    cbse_extracted_dir: Path,
    jee_native_text_dir: Path | None,
    jee_ocr_text_dir: Path | None,
    retrieved_at: str,
) -> dict[str, Any]:
    catalog = _load_catalog(catalog_path)
    imported: list[dict[str, Any]] = []
    missing_artifacts: list[str] = []
    skipped_members: list[dict[str, str]] = []

    for artifact in catalog["artifacts"]:
        if artifact["kind"] == "pdf":
            source_pdf = jee_dir / artifact["local_name"]
            if not _is_pdf(source_pdf):
                missing_artifacts.append(artifact["artifact_id"])
                continue
            document_id = artifact["artifact_id"]
            notes = {
                "accessibility_variant": artifact["accessibility_variant"],
                "artifact_id": artifact["artifact_id"],
                "language": artifact["language"],
                "redistribution": "rights_review_required",
                "source_stage_filename": artifact["local_name"],
            }
            record = _document_record(
                artifact,
                document_id=document_id,
                source_pdf=source_pdf,
                retrieved_at=retrieved_at,
                set_name=artifact["set"],
                notes=notes,
            )
            _atomic_copy(source_pdf, raw_dir / f"{document_id}.pdf")
            notes["staged_text_method"] = _copy_text_if_present(
                document_id,
                artifact["local_name"],
                jee_native_text_dir,
                jee_ocr_text_dir,
                text_dir,
            )
            record["provenance"]["notes"] = json.dumps(
                notes, ensure_ascii=False, sort_keys=True
            )
            imported.append(record)
            continue

        if artifact["kind"] != "zip":
            raise ImportError(f"unsupported artifact kind {artifact['kind']!r}")
        archive_path = cbse_archive_dir / artifact["local_name"]
        extracted_root = cbse_extracted_dir / artifact["artifact_id"]
        if not archive_path.is_file() or not extracted_root.is_dir():
            missing_artifacts.append(artifact["artifact_id"])
            continue
        archive_hash = sha256_file(archive_path)
        archive_member_hashes = _zip_pdf_hashes(archive_path)
        members = sorted(
            path for path in extracted_root.rglob("*") if path.is_file() and path.suffix.casefold() == ".pdf"
        )
        extracted_member_names = {path.relative_to(extracted_root).as_posix() for path in members}
        missing_members = sorted(set(archive_member_hashes) - extracted_member_names)
        unexpected_members = sorted(extracted_member_names - set(archive_member_hashes))
        if missing_members or unexpected_members:
            raise ImportError(
                f"expanded archive does not match {archive_path}: "
                f"missing={missing_members[:10]} unexpected={unexpected_members[:10]}"
            )
        for source_pdf in members:
            member = source_pdf.relative_to(extracted_root).as_posix()
            if not _is_pdf(source_pdf):
                skipped_members.append({"artifact_id": artifact["artifact_id"], "member": member})
                continue
            extracted_hash = sha256_file(source_pdf)
            if extracted_hash != archive_member_hashes[member]:
                raise ImportError(
                    f"expanded member bytes do not match {archive_path}!{member}: "
                    f"{extracted_hash} != {archive_member_hashes[member]}"
                )
            if artifact["subject"] == "Mathematics" and "applied" in member.casefold():
                skipped_members.append(
                    {
                        "artifact_id": artifact["artifact_id"],
                        "member": member,
                        "reason": "applied-mathematics-outside-target-syllabus",
                    }
                )
                continue
            member_hash = hashlib.sha256(member.encode("utf-8")).hexdigest()[:10]
            document_id = f"{artifact['artifact_id']}-{_slug(Path(member).stem)[:72]}-{member_hash}"
            accessibility = _accessibility_variant(member)
            notes = {
                "accessibility_variant": accessibility,
                "archive_member": member,
                "archive_sha256": archive_hash,
                "artifact_id": artifact["artifact_id"],
                "language": artifact["language"],
                "redistribution": "rights_review_required",
            }
            record = _document_record(
                artifact,
                document_id=document_id,
                source_pdf=source_pdf,
                retrieved_at=retrieved_at,
                set_name=member,
                notes=notes,
                container_url=artifact["url"],
                container_sha256=archive_hash,
                member_path=member,
            )
            _atomic_copy(source_pdf, raw_dir / f"{document_id}.pdf")
            imported.append(record)

    existing = load_documents(manifest_path) if manifest_path.exists() else []
    by_id = {record["document_id"]: record for record in existing}
    for record in imported:
        previous = by_id.get(record["document_id"])
        if previous is not None and previous["sha256"] != record["sha256"]:
            raise ImportError(
                f"staged bytes changed for {record['document_id']}: "
                f"{previous['sha256']} -> {record['sha256']}"
            )
        by_id[record["document_id"]] = record
    documents = sorted(by_id.values(), key=lambda item: item["document_id"])
    validate_corpus(documents, [])
    write_jsonl(manifest_path, documents)

    hashes: dict[str, list[str]] = defaultdict(list)
    for record in imported:
        hashes[record["sha256"]].append(record["document_id"])
    duplicate_groups = [ids for ids in hashes.values() if len(ids) > 1]
    return {
        "operation": "import-staged",
        "retrieved_at": retrieved_at,
        "imported_documents": len(imported),
        "manifest_documents": len(documents),
        "by_exam": dict(sorted(Counter(item["exam"] for item in imported).items())),
        "by_year": dict(sorted(Counter(str(item["year"]) for item in imported).items())),
        "by_subject": dict(sorted(Counter(item["subject"] for item in imported).items())),
        "duplicate_pdf_hash_groups": len(duplicate_groups),
        "duplicate_pdf_occurrences": sum(len(group) for group in duplicate_groups),
        "missing_artifacts": missing_artifacts,
        "skipped_members": skipped_members,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    catalog_parser = subparsers.add_parser("write-catalog")
    catalog_parser.add_argument("--output", type=Path, default=DEFAULT_CATALOG)

    import_parser = subparsers.add_parser("import-staged")
    import_parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    import_parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    import_parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    import_parser.add_argument("--text-dir", type=Path, default=DEFAULT_TEXT_DIR)
    import_parser.add_argument("--jee-dir", type=Path, required=True)
    import_parser.add_argument("--jee-native-text-dir", type=Path)
    import_parser.add_argument("--jee-ocr-text-dir", type=Path)
    import_parser.add_argument("--cbse-archive-dir", type=Path, required=True)
    import_parser.add_argument("--cbse-extracted-dir", type=Path, required=True)
    import_parser.add_argument("--retrieved-at", default=_utc_now())
    import_parser.add_argument("--report", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "write-catalog":
            catalog = _validate_catalog(build_catalog())
            _atomic_json(args.output, catalog)
            result = {
                "operation": "write-catalog",
                "output": str(args.output),
                "artifacts": len(catalog["artifacts"]),
                "known_gaps": len(catalog["known_gaps"]),
            }
        else:
            result = import_staged(
                args.catalog,
                args.manifest,
                args.raw_dir,
                args.text_dir,
                jee_dir=args.jee_dir,
                cbse_archive_dir=args.cbse_archive_dir,
                cbse_extracted_dir=args.cbse_extracted_dir,
                jee_native_text_dir=args.jee_native_text_dir,
                jee_ocr_text_dir=args.jee_ocr_text_dir,
                retrieved_at=args.retrieved_at,
            )
            if args.report is not None:
                _atomic_json(args.report, result)
                result = {**result, "report": str(args.report)}
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (ImportError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=os.sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
