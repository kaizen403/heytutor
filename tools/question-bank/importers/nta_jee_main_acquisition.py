#!/usr/bin/env python3
"""Stage verified official NTA JEE Main Paper 1 PDFs for later import."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from nta_jee_main_sources import _parse_pdf_text_metadata, _validate_https
from question_bank.models import sha256_file

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"

DEFAULT_INVENTORY_REPORT = (
    DATA_ROOT / "reports" / "coverage" / "nta-jee-main-coverage-2026-08-10.json"
)
DEFAULT_SCHEDULE = DATA_ROOT / "nta-jee-main-official-schedule.json"
DEFAULT_STAGING_DIR = DATA_ROOT / "staging" / "nta-jee-main"
DEFAULT_REPORT = (
    DATA_ROOT / "reports" / "coverage" / "nta-jee-main-acquisition-2026-08-10.json"
)

SCHEDULE_SCHEMA_VERSION = "nta-jee-main-official-schedule/v1"
REPORT_SCHEMA_VERSION = "nta-jee-main-acquisition-report/v1"
SIDECAR_SCHEMA_VERSION = "nta-jee-main-staged-artifact/v1"

DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
USER_AGENT = "HeyTutor-nta-jee-main-acquisition/1"

_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
_REGIONAL_LANGUAGES = {
    "assamese",
    "bengali",
    "gujarati",
    "kannada",
    "malayalam",
    "marathi",
    "odia",
    "oriya",
    "punjabi",
    "tamil",
    "telugu",
    "urdu",
}


class AcquisitionError(RuntimeError):
    """Raised when the acquisition layer cannot proceed safely."""


class DownloadTransferError(AcquisitionError):
    """Raised when a staged transfer fails after consuming network budget."""

    def __init__(
        self,
        message: str,
        *,
        downloaded_bytes: int,
        total_exhausted: bool,
        preserve_part: bool = False,
    ) -> None:
        super().__init__(message)
        self.downloaded_bytes = downloaded_bytes
        self.total_exhausted = total_exhausted
        self.preserve_part = preserve_part


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _compact_text(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", value.upper())


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
        raise AcquisitionError(f"missing JSON file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AcquisitionError(f"invalid JSON in {path}") from exc


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AcquisitionError(message)


def _exact_keys(value: dict[str, Any], expected: set[str], path: str) -> None:
    _require(
        set(value) == expected,
        f"{path}: expected exactly {', '.join(sorted(expected))}",
    )


def _parse_iso_date_from_reported(value: str) -> str | None:
    match = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", value)
    if not match:
        return None
    day, month, year = match.groups()
    return f"{year}-{month}-{day}"


def _official_key(exam_date: str, shift: int) -> str:
    return f"{exam_date}-shift-{shift}"


def _looks_like_excluded_non_paper1(text: str) -> bool:
    expanded = text.upper()
    compact = _compact_text(text)
    if "BARCH" in compact or "BPLANNING" in compact:
        return True
    if re.search(r"\bPAPER[\s\-–]*(?:II|2|2A|2B)\b", expanded):
        return True
    return "PAPERII" in compact or "PAPER2" in compact


def _looks_like_paper1(text: str) -> bool:
    expanded = text.upper()
    compact = _compact_text(text)
    if _looks_like_excluded_non_paper1(text):
        return False
    if any(token in compact for token in ("BTECH", "BEBTECH")):
        return True
    if re.search(r"\bPAPER[\s\-–]*(?:I|1)\b", expanded):
        return True
    return "PAPERI" in compact or "PAPER1" in compact


def _language_variant_from_labels(names: list[str]) -> tuple[str, int]:
    has_english = any("ENGLISH" in name.upper() for name in names)
    has_hindi = any("HINDI" in name.upper() for name in names)
    joined = " ".join(names).casefold()
    has_regional = any(language in joined for language in _REGIONAL_LANGUAGES)
    if has_english and has_hindi:
        return "english_hindi", 2
    if has_english:
        return "english", 1
    if has_hindi or has_regional:
        return "regional", 4
    if any(_looks_like_paper1(name) for name in names):
        return "generic", 3
    return "regional", 4


def _schedule_index(schedule: dict[str, Any]) -> dict[str, Any]:
    by_key: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for session in schedule["sessions"]:
        for key_row in session["keys"]:
            official_key = _official_key(key_row["exam_date"], key_row["shift"])
            entry = {
                "official_key": official_key,
                "exam_date": key_row["exam_date"],
                "shift": key_row["shift"],
                "evidence_type": key_row["evidence_type"],
                "expected_gap": key_row["expected_gap"],
                "session_id": session["session_id"],
                "session_label": session["label"],
                "source_url": session["source_url"],
                "alternate_source_urls": session["alternate_source_urls"],
                "year": session["year"],
            }
            _require(official_key not in by_key, f"duplicate schedule key: {official_key}")
            by_key[official_key] = entry
            ordered.append(entry)
    ordered.sort(key=lambda item: (item["exam_date"], item["shift"]))
    return {"by_key": by_key, "ordered": ordered}


def _validate_inventory_report(value: Any) -> dict[str, Any]:
    _require(isinstance(value, dict), "inventory report: expected an object")
    _require(
        value.get("schema_version") == "nta-jee-main-source-inventory/v1",
        "inventory report: unsupported schema_version",
    )
    _require(isinstance(value.get("observed_at"), str), "inventory report: missing observed_at")
    _require(
        isinstance(value.get("report_filename_date"), str),
        "inventory report: missing report_filename_date",
    )
    historical = value.get("historical_endpoint_inventory")
    _require(
        isinstance(historical, dict), "inventory report: missing historical_endpoint_inventory"
    )
    unique_papers = historical.get("unique_papers")
    _require(
        isinstance(unique_papers, list),
        "inventory report: historical_endpoint_inventory.unique_papers must be a list",
    )
    for index, item in enumerate(unique_papers):
        path = f"inventory.unique_papers[{index}]"
        _require(isinstance(item, dict), f"{path}: expected an object")
        _validate_https(item.get("paper_url", ""))
        for key in (
            "paper_file",
            "paper_url",
            "candidate_status",
            "raw_row_count",
            "row_ids",
            "reported_years",
            "reported_paper_dates",
            "reported_paper_names",
            "reported_shifts",
            "raw_rows",
        ):
            _require(key in item, f"{path}: missing {key}")
    return value


def _validate_schedule(value: Any) -> dict[str, Any]:
    _require(isinstance(value, dict), "schedule: expected an object")
    _exact_keys(value, {"schema_version", "as_of", "program", "sessions"}, "schedule")
    _require(
        value["schema_version"] == SCHEDULE_SCHEMA_VERSION,
        "schedule: unsupported schema_version",
    )
    _require(isinstance(value["as_of"], str), "schedule.as_of: expected string")
    _require(isinstance(value["program"], str), "schedule.program: expected string")
    _require(isinstance(value["sessions"], list), "schedule.sessions: expected list")
    for index, session in enumerate(value["sessions"]):
        path = f"schedule.sessions[{index}]"
        _require(isinstance(session, dict), f"{path}: expected object")
        _exact_keys(
            session,
            {
                "session_id",
                "label",
                "year",
                "source_url",
                "alternate_source_urls",
                "keys",
            },
            path,
        )
        _require(isinstance(session["session_id"], str) and session["session_id"], f"{path}.session_id: expected non-empty string")
        _require(isinstance(session["label"], str) and session["label"], f"{path}.label: expected non-empty string")
        _require(isinstance(session["year"], int), f"{path}.year: expected int")
        _validate_https(session["source_url"])
        _require(isinstance(session["alternate_source_urls"], list), f"{path}.alternate_source_urls: expected list")
        for alt in session["alternate_source_urls"]:
            _require(isinstance(alt, str), f"{path}.alternate_source_urls: expected strings")
            _validate_https(alt)
        _require(isinstance(session["keys"], list) and session["keys"], f"{path}.keys: expected non-empty list")
        for key_index, key_row in enumerate(session["keys"]):
            key_path = f"{path}.keys[{key_index}]"
            _require(isinstance(key_row, dict), f"{key_path}: expected object")
            _exact_keys(
                key_row,
                {"exam_date", "shift", "evidence_type", "expected_gap"},
                key_path,
            )
            _require(
                isinstance(key_row["exam_date"], str)
                and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", key_row["exam_date"])),
                f"{key_path}.exam_date: expected YYYY-MM-DD",
            )
            _require(
                key_row["shift"] in {1, 2},
                f"{key_path}.shift: expected 1 or 2",
            )
            _require(
                isinstance(key_row["evidence_type"], str) and key_row["evidence_type"],
                f"{key_path}.evidence_type: expected non-empty string",
            )
            _require(
                isinstance(key_row["expected_gap"], bool),
                f"{key_path}.expected_gap: expected bool",
            )
    return value


def _candidate_reported_schedule_keys(
    row: dict[str, Any], schedule_by_key: dict[str, dict[str, Any]]
) -> list[str]:
    keys: set[str] = set()
    for date in row["reported_paper_dates"]:
        iso_date = _parse_iso_date_from_reported(date)
        if iso_date is None:
            continue
        for shift_text in row["reported_shifts"]:
            if str(shift_text) not in {"1", "2"}:
                continue
            key = _official_key(iso_date, int(shift_text))
            if key in schedule_by_key:
                keys.add(key)
    return sorted(keys)


def _normalized_candidate(row: dict[str, Any], schedule_by_key: dict[str, dict[str, Any]]) -> dict[str, Any]:
    names = [_clean_text(name) for name in row["reported_paper_names"] if _clean_text(name)]
    all_names = names or [""]
    language_variant, variant_rank = _language_variant_from_labels(all_names)
    reported_keys = _candidate_reported_schedule_keys(row, schedule_by_key)
    explicitly_excluded = any(_looks_like_excluded_non_paper1(name) for name in all_names)
    joined_names = " ".join(all_names).casefold()
    explicit_regional = any(language in joined_names for language in _REGIONAL_LANGUAGES)
    explicit_hindi = any("HINDI" in name.upper() for name in all_names)
    if explicitly_excluded:
        plan_rank = 99
        plan_reason = None
    elif reported_keys:
        if variant_rank == 4 and not explicit_regional and not explicit_hindi:
            plan_rank = 4
            plan_reason = "reported_schedule_resolvable_ambiguous"
        elif variant_rank == 4:
            plan_rank = 5
            plan_reason = "regional_fallback"
        else:
            plan_rank = variant_rank
            plan_reason = "reported_schedule_match"
    elif variant_rank <= 3:
        plan_rank = variant_rank
        plan_reason = "metadata_outlier"
    else:
        plan_rank = 5
        plan_reason = None
    return {
        **row,
        "reported_schedule_keys": reported_keys,
        "language_variant": language_variant,
        "variant_rank": variant_rank,
        "plan_rank": plan_rank,
        "plan_reason": plan_reason,
    }


def _candidate_sort_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    return (
        min(candidate["reported_schedule_keys"]) if candidate["reported_schedule_keys"] else "zzzz",
        candidate["plan_rank"],
        candidate["variant_rank"],
        candidate["paper_url"],
    )


def _plan_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "paper_file": candidate["paper_file"],
        "paper_url": candidate["paper_url"],
        "candidate_status": candidate["candidate_status"],
        "plan_rank": candidate["plan_rank"],
        "raw_row_count": candidate["raw_row_count"],
        "row_ids": candidate["row_ids"],
        "reported_years": candidate["reported_years"],
        "reported_paper_dates": candidate["reported_paper_dates"],
        "reported_paper_names": candidate["reported_paper_names"],
        "reported_shifts": candidate["reported_shifts"],
        "reported_schedule_keys": candidate["reported_schedule_keys"],
        "language_variant": candidate["language_variant"],
        "variant_rank": candidate["variant_rank"],
        "raw_rows": candidate["raw_rows"],
    }


def _build_download_plan(inventory: dict[str, Any], schedule: dict[str, Any]) -> dict[str, Any]:
    schedule_info = _schedule_index(schedule)
    candidates = [
        _normalized_candidate(item, schedule_info["by_key"])
        for item in inventory["historical_endpoint_inventory"]["unique_papers"]
    ]
    candidates.sort(key=_candidate_sort_key)
    planned: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []
    selected_urls: set[str] = set()
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for candidate in candidates:
        if candidate["plan_rank"] == 99:
            suppressed.append(
                {
                    **_plan_summary(candidate),
                    "suppression_reasons": ["excluded_non_paper1_program"],
                }
            )
            continue
        for key in candidate["reported_schedule_keys"]:
            grouped[key].append(candidate)

    for official_key in sorted(grouped):
        group = sorted(grouped[official_key], key=_candidate_sort_key)
        best = group[0]
        if best["plan_rank"] >= 5:
            chosen = [group[0]]
            chosen[0] = {**chosen[0], "plan_reason": "regional_fallback"}
        elif best["plan_rank"] == 3:
            chosen = [item for item in group if item["plan_rank"] == best["plan_rank"]]
        else:
            chosen = [group[0]]
        chosen_urls = {item["paper_url"] for item in chosen}
        for item in chosen:
            if item["paper_url"] in selected_urls:
                continue
            planned.append({**_plan_summary(item), "plan_reason": item["plan_reason"]})
            selected_urls.add(item["paper_url"])
        for item in group:
            if item["paper_url"] in chosen_urls:
                continue
            suppressed.append(
                {
                    **_plan_summary(item),
                    "suppression_reasons": ["lower_priority_same_reported_schedule_key"],
                }
            )

    for candidate in candidates:
        if candidate["paper_url"] in selected_urls or candidate["plan_rank"] == 99:
            continue
        if not candidate["reported_schedule_keys"] and candidate["plan_rank"] <= 3:
            planned.append({**_plan_summary(candidate), "plan_reason": candidate["plan_reason"]})
            selected_urls.add(candidate["paper_url"])
            continue
        if not candidate["reported_schedule_keys"]:
            suppressed.append(
                {
                    **_plan_summary(candidate),
                    "suppression_reasons": ["no_schedule_match_and_not_high_priority"],
                }
            )

    planned.sort(key=lambda item: (_candidate_sort_key(item), item["paper_file"]))
    suppressed.sort(key=lambda item: item["paper_file"])
    return {
        "planned_candidates": planned,
        "suppressed_candidates": suppressed,
    }


def _sidecar_path(staged_path: Path) -> Path:
    return staged_path.with_suffix(f"{staged_path.suffix}.sidecar.json")


def _staged_pdf_path(staging_dir: Path, url: str) -> Path:
    parsed = urlparse(url)
    basename = Path(parsed.path).name or "artifact.pdf"
    stem = Path(basename).stem or "artifact"
    suffix = Path(basename).suffix or ".pdf"
    token = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    return staging_dir / f"{stem}-{token}{suffix}"


def _quarantine_path(destination: Path, reason: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", reason.casefold()).strip("-") or "artifact"
    return destination.with_suffix(f"{destination.suffix}.{slug}.quarantine")


def _open_request(request: Request, timeout_seconds: float):
    return urlopen(request, timeout=timeout_seconds)


def _parse_content_range(value: str | None) -> tuple[int, int, int] | None:
    if not value:
        return None
    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", value.strip())
    if not match:
        return None
    start, end, total = (int(part) for part in match.groups())
    return start, end, total


def _download_to_stage(
    *,
    url: str,
    destination: Path,
    max_file_bytes: int,
    max_total_bytes: int,
    total_bytes_used: int,
    timeout_seconds: float,
) -> tuple[Path, int]:
    _validate_https(url)
    destination.parent.mkdir(parents=True, exist_ok=True)
    part_path = destination.with_suffix(f"{destination.suffix}.part")
    resume_from = part_path.stat().st_size if part_path.exists() else 0
    remaining_total_before_open = max_total_bytes - total_bytes_used
    if remaining_total_before_open <= 0:
        raise DownloadTransferError(
            f"total byte cap exhausted before opening {url}",
            downloaded_bytes=0,
            total_exhausted=True,
        )
    request = Request(url, headers={"User-Agent": USER_AGENT})
    if resume_from:
        request.add_header("Range", f"bytes={resume_from}-")
    try:
        response = _open_request(request, timeout_seconds)
    except (HTTPError, URLError) as exc:
        raise AcquisitionError(f"download failed for {url}: {exc}") from exc
    with response:
        status = getattr(response, "status", None)
        headers = {str(key).lower(): str(value) for key, value in dict(response.headers).items()}
        content_range = _parse_content_range(headers.get("content-range"))
        expected_body_length: int | None = None
        if resume_from and status == 206:
            _require(
                content_range is not None,
                f"invalid Content-Range for resume: {headers.get('content-range')!r}",
            )
            start, end, total = content_range
            _require(
                start == resume_from and end >= start and total > end,
                f"invalid Content-Range for resume: {headers.get('content-range')!r}",
            )
            mode = "ab"
            current_size = resume_from
            expected_body_length = end - start + 1
        elif resume_from and status == 200:
            mode = "wb"
            current_size = 0
        elif status == 200:
            mode = "wb"
            current_size = 0
            content_length = headers.get("content-length")
            if content_length is not None and content_length.isdigit():
                expected_body_length = int(content_length)
        else:
            raise AcquisitionError(f"unexpected HTTP status {status} for {url}")
        downloaded_this_call = 0
        with part_path.open(mode) as output:
            if mode == "wb":
                output.truncate(0)
            while True:
                remaining_file = max_file_bytes - current_size
                remaining_total = max_total_bytes - total_bytes_used - downloaded_this_call
                if remaining_file <= 0 or remaining_total <= 0:
                    try:
                        probe = response.read(1)
                    except Exception as exc:
                        raise DownloadTransferError(
                            f"download interrupted for {url}: {exc}",
                            downloaded_bytes=downloaded_this_call,
                            total_exhausted=remaining_total <= 0,
                            preserve_part=True,
                        ) from exc
                    if not probe:
                        break
                    downloaded_this_call += len(probe)
                    raise DownloadTransferError(
                        (
                            f"total byte cap exceeded for {url}"
                            if remaining_total <= 0
                            else f"per-file byte cap exceeded for {url}"
                        ),
                        downloaded_bytes=downloaded_this_call,
                        total_exhausted=remaining_total <= 0,
                    )
                try:
                    chunk = response.read(min(1024 * 1024, remaining_file, remaining_total))
                except Exception as exc:
                    raise DownloadTransferError(
                        f"download interrupted for {url}: {exc}",
                        downloaded_bytes=downloaded_this_call,
                        total_exhausted=False,
                        preserve_part=True,
                    ) from exc
                if not chunk:
                    break
                downloaded_this_call += len(chunk)
                current_size += len(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    if expected_body_length is not None and downloaded_this_call != expected_body_length:
        raise DownloadTransferError(
            f"truncated body for {url}",
            downloaded_bytes=downloaded_this_call,
            total_exhausted=False,
        )
    return part_path, downloaded_this_call


def _pdf_page_count(path: Path) -> int | None:
    result = subprocess.run(
        ["pdfinfo", str(path)],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        return None
    match = re.search(r"^Pages:\s+(\d+)\s*$", result.stdout, re.MULTILINE)
    return int(match.group(1)) if match else None


def _pdftotext_preview(path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-f", "1", "-l", "2", str(path), "-"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.stdout


def _header_exam_date_and_shift(question_paper_name: str) -> tuple[str | None, int | None]:
    if not question_paper_name:
        return None, None
    shift_match = re.search(r"\bShift\s*([12])\b", question_paper_name, re.IGNORECASE)
    shift = int(shift_match.group(1)) if shift_match else None
    match = re.search(
        r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(20\d{2})\b",
        question_paper_name,
        re.IGNORECASE,
    )
    if not match:
        return None, shift
    day_text, month_text, year_text = match.groups()
    month = _MONTHS.get(month_text.casefold()[:3])
    if month is None:
        return None, shift
    return f"{year_text}-{month:02d}-{int(day_text):02d}", shift


def _official_historical_schedule_entry(
    candidate: dict[str, Any], schedule_index: dict[str, Any]
) -> dict[str, Any] | None:
    paper_url = str(candidate.get("paper_url") or "")
    paper_file = str(candidate.get("paper_file") or "")
    reported_schedule_keys = candidate.get("reported_schedule_keys")
    if not paper_url.startswith("https://www.nta.ac.in/Download/ExamPaper/"):
        return None
    if not paper_file.startswith("/Download/ExamPaper/"):
        return None
    if not isinstance(reported_schedule_keys, list) or len(reported_schedule_keys) != 1:
        return None
    official_key = reported_schedule_keys[0]
    if official_key not in schedule_index["by_key"]:
        return None
    return schedule_index["by_key"][official_key]


def _looks_like_btech(text: str) -> bool:
    compact = _compact_text(text)
    return "BTECH" in compact or "BEBTECH" in compact


def _legacy_official_english_header_metadata(
    preview_text: str,
) -> tuple[str, int, str] | None:
    lines = [_clean_text(line) for line in preview_text.splitlines() if _clean_text(line)]
    joined = "\n".join(lines)
    if not re.search(r"\bB\.?\s*E\.?\s*/\s*B\.?\s*Tech\.?\s*\(\s*Paper\s*I\s*\)", joined, re.IGNORECASE):
        return None
    date_match = re.search(r"\b(\d{2})-(\d{2})-(20\d{2})\b", joined)
    slot_match = re.search(r"\bSLOT\s*[-:]?\s*([12])\b", joined, re.IGNORECASE)
    language_match = re.search(r"\bEnglish\b", joined, re.IGNORECASE)
    if date_match is None or slot_match is None or language_match is None:
        return None
    day_text, month_text, year_text = date_match.groups()
    return (
        f"{year_text}-{int(month_text):02d}-{int(day_text):02d}",
        int(slot_match.group(1)),
        "English",
    )


def _header_language(parsed: dict[str, str | None], candidate_variant: str) -> tuple[str, int, str | None]:
    explicit = _clean_text(parsed.get("language"))
    if explicit:
        lowered = explicit.casefold()
        if lowered == "english":
            return "english", 1, explicit
        if lowered in {"englishhindi", "hindienglish"}:
            return "english_hindi", 2, explicit
        if lowered == "hindi" or lowered in _REGIONAL_LANGUAGES:
            return "regional", 4, explicit
    if candidate_variant == "english":
        return "english", 1, explicit or None
    if candidate_variant == "english_hindi":
        return "english_hindi", 2, explicit or None
    if candidate_variant == "generic":
        return "generic", 3, explicit or None
    return "regional", 4, explicit or None


def _evaluate_pdf_metadata(
    *,
    candidate: dict[str, Any],
    schedule_index: dict[str, Any],
    staged_path: Path,
    sha256: str,
    size_bytes: int,
    page_count: int | None,
    pdf_magic: bool,
    preview_text: str,
) -> dict[str, Any]:
    base = {
        "paper_file": candidate["paper_file"],
        "paper_url": candidate["paper_url"],
        "staged_path": str(staged_path),
        "sha256": sha256,
        "size_bytes": size_bytes,
        "page_count": page_count,
        "reported_schedule_keys": candidate["reported_schedule_keys"],
        "plan_reason": candidate["plan_reason"],
        "pdf_magic": pdf_magic,
    }
    if not pdf_magic:
        return {**base, "status": "quarantined", "quarantine_reason": "invalid_pdf_magic"}
    if not isinstance(page_count, int) or page_count <= 0:
        return {
            **base,
            "status": "quarantined",
            "quarantine_reason": "invalid_pdf_page_count",
        }
    parsed = _parse_pdf_text_metadata(preview_text)
    question_paper_name = _clean_text(parsed.get("question_paper_name"))
    subject_name = _clean_text(parsed.get("subject_name"))
    subject_evidence = " ".join(part for part in (question_paper_name, subject_name) if part)
    fallback_schedule_entry = _official_historical_schedule_entry(candidate, schedule_index)
    legacy_header_match: tuple[str, int, str] | None = None
    if fallback_schedule_entry is not None and candidate["language_variant"] == "english":
        legacy_header = _legacy_official_english_header_metadata(preview_text)
        if legacy_header is not None:
            legacy_exam_date, legacy_shift, legacy_language = legacy_header
            legacy_key = _official_key(legacy_exam_date, legacy_shift)
            if legacy_key == fallback_schedule_entry["official_key"]:
                legacy_header_match = (legacy_exam_date, legacy_shift, legacy_language)
    if not _looks_like_paper1(subject_evidence):
        if legacy_header_match is None:
            return {
                **base,
                "status": "quarantined",
                "quarantine_reason": "non_paper1_subject_evidence",
                "question_paper_name": question_paper_name or None,
                "subject_name": subject_name or None,
            }
    exam_date, shift = _header_exam_date_and_shift(question_paper_name)
    if (
        (exam_date is None or shift is None)
        and fallback_schedule_entry is not None
        and candidate["language_variant"] == "english_hindi"
        and re.fullmatch(r"\d+", question_paper_name)
        and _looks_like_btech(subject_name)
    ):
        exam_date = fallback_schedule_entry["exam_date"]
        shift = fallback_schedule_entry["shift"]
    if (exam_date is None or shift is None) and legacy_header_match is not None:
        legacy_exam_date, legacy_shift, legacy_language = legacy_header_match
        exam_date = legacy_exam_date
        shift = legacy_shift
        parsed["language"] = legacy_language
        subject_name = "B.E/B.Tech.(Paper I)"
        question_paper_name = question_paper_name or None
    if exam_date is None or shift is None:
        return {
            **base,
            "status": "quarantined",
            "quarantine_reason": "ambiguous_internal_schedule",
            "question_paper_name": question_paper_name or None,
            "subject_name": subject_name or None,
        }
    official_key = _official_key(exam_date, shift)
    if official_key not in schedule_index["by_key"]:
        return {
            **base,
            "status": "quarantined",
            "quarantine_reason": "internal_schedule_key_not_found",
            "question_paper_name": question_paper_name or None,
            "subject_name": subject_name or None,
            "internal_exam_date": exam_date,
            "internal_shift": shift,
        }
    language_variant, variant_rank, explicit_language = _header_language(
        parsed,
        candidate["language_variant"],
    )
    warnings: list[str] = []
    if candidate["reported_schedule_keys"] and official_key not in candidate["reported_schedule_keys"]:
        warnings.append("metadata_corrected")
    if not candidate["reported_schedule_keys"]:
        warnings.append("resolved_from_internal_header")
    return {
        **base,
        "status": "verified",
        "official_key": official_key,
        "question_paper_name": question_paper_name or None,
        "subject_name": subject_name or None,
        "creation_date": _clean_text(parsed.get("creation_date")) or None,
        "language": explicit_language,
        "language_variant": language_variant,
        "variant_rank": variant_rank,
        "internal_exam_date": exam_date,
        "internal_shift": shift,
        "warnings": warnings,
    }


def _write_sidecar(path: Path, record: dict[str, Any]) -> None:
    payload = {
        "schema_version": SIDECAR_SCHEMA_VERSION,
        "paper_url": record["paper_url"],
        "sha256": record["sha256"],
        "size_bytes": record["size_bytes"],
        "page_count": record["page_count"],
        "pdf_magic": record["pdf_magic"],
        "question_paper_name": record.get("question_paper_name"),
        "subject_name": record.get("subject_name"),
        "creation_date": record.get("creation_date"),
        "language": record.get("language"),
        "official_key": record.get("official_key"),
        "retrieved_at": record.get("retrieved_at"),
        "warnings": record.get("warnings", []),
    }
    _atomic_json(path, payload)


def _reuse_verified_stage(
    *,
    candidate: dict[str, Any],
    staged_path: Path,
    sidecar_path: Path,
    schedule_info: dict[str, Any],
) -> dict[str, Any] | None:
    if not staged_path.is_file() or not sidecar_path.is_file():
        return None
    sidecar = _load_json(sidecar_path)
    _require(
        isinstance(sidecar, dict)
        and sidecar.get("schema_version") == SIDECAR_SCHEMA_VERSION,
        f"invalid sidecar: {sidecar_path}",
    )
    if sidecar.get("paper_url") != candidate["paper_url"]:
        return None
    actual_sha256 = sha256_file(staged_path)
    actual_size = staged_path.stat().st_size
    actual_pages = _pdf_page_count(staged_path)
    if (
        actual_sha256 != sidecar.get("sha256")
        or actual_size != sidecar.get("size_bytes")
        or actual_pages != sidecar.get("page_count")
    ):
        return None
    retrieved_at = sidecar.get("retrieved_at")
    if not isinstance(retrieved_at, str) or not retrieved_at:
        return None
    actual_pdf_magic = staged_path.read_bytes()[:5] == b"%PDF-"
    reused = _evaluate_pdf_metadata(
        candidate=candidate,
        schedule_index=schedule_info,
        staged_path=staged_path,
        sha256=actual_sha256,
        size_bytes=actual_size,
        page_count=actual_pages,
        pdf_magic=actual_pdf_magic,
        preview_text=_pdftotext_preview(staged_path),
    )
    if reused["status"] != "verified":
        return reused
    reused["retrieved_at"] = retrieved_at
    return reused


def _verify_or_stage_candidate(
    *,
    candidate: dict[str, Any],
    staging_dir: Path,
    dry_run: bool,
    schedule_info: dict[str, Any],
    max_file_bytes: int,
    max_total_bytes: int,
    total_bytes_used: int,
    timeout_seconds: float,
) -> tuple[dict[str, Any] | None, int, bool]:
    staged_path = _staged_pdf_path(staging_dir, candidate["paper_url"])
    sidecar_path = _sidecar_path(staged_path)
    if dry_run:
        return None, total_bytes_used, False
    reused = _reuse_verified_stage(
        candidate=candidate,
        staged_path=staged_path,
        sidecar_path=sidecar_path,
        schedule_info=schedule_info,
    )
    if reused is not None:
        return reused, total_bytes_used, False
    try:
        transient_path, downloaded_bytes = _download_to_stage(
            url=candidate["paper_url"],
            destination=staged_path,
            max_file_bytes=max_file_bytes,
            max_total_bytes=max_total_bytes,
            total_bytes_used=total_bytes_used,
            timeout_seconds=timeout_seconds,
        )
    except DownloadTransferError as exc:
        part_path = staged_path.with_suffix(f"{staged_path.suffix}.part")
        quarantine_record = {
            **_plan_summary(candidate),
            "status": "quarantined",
            "quarantine_reason": str(exc),
        }
        if part_path.exists():
            if exc.preserve_part:
                quarantine_record["resumable_part_path"] = str(part_path)
            else:
                quarantine_path = _quarantine_path(staged_path, str(exc))
                os.replace(part_path, quarantine_path)
                quarantine_record["quarantine_path"] = str(quarantine_path)
        return (
            quarantine_record,
            total_bytes_used + exc.downloaded_bytes,
            exc.total_exhausted,
        )
    pdf_magic = transient_path.read_bytes()[:5] == b"%PDF-"
    record = _evaluate_pdf_metadata(
        candidate=candidate,
        schedule_index=schedule_info,
        staged_path=transient_path,
        sha256=sha256_file(transient_path),
        size_bytes=transient_path.stat().st_size,
        page_count=_pdf_page_count(transient_path),
        pdf_magic=pdf_magic,
        preview_text=_pdftotext_preview(transient_path),
    )
    if record["status"] == "verified":
        record["retrieved_at"] = _utc_now()
        os.replace(transient_path, staged_path)
        record["staged_path"] = str(staged_path)
        _write_sidecar(sidecar_path, record)
        return record, total_bytes_used + downloaded_bytes, False
    quarantine_path = _quarantine_path(staged_path, record["quarantine_reason"])
    os.replace(transient_path, quarantine_path)
    record["quarantine_path"] = str(quarantine_path)
    return record, total_bytes_used + downloaded_bytes, False


def _select_canonical_candidates(
    verified_candidates: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in verified_candidates:
        grouped[candidate["official_key"]].append(candidate)
    selected: dict[str, dict[str, Any]] = {}
    for official_key, items in grouped.items():
        ordered = sorted(
            items,
            key=lambda item: (item["variant_rank"], item["paper_url"], item["sha256"]),
        )
        canonical = ordered[0]
        alternates = [
            {
                "paper_url": item["paper_url"],
                "sha256": item["sha256"],
                "language_variant": item["language_variant"],
                "alternate_reason": "lower_language_rank",
            }
            for item in ordered[1:]
        ]
        selected[official_key] = {
            "canonical": canonical,
            "alternates": alternates,
            "regional_fallback": canonical["variant_rank"] >= 4,
        }
    return selected


def _stable_candidate_view(candidate: dict[str, Any]) -> dict[str, Any]:
    fields = [
        "official_key",
        "paper_file",
        "paper_url",
        "staged_path",
        "sha256",
        "size_bytes",
        "page_count",
        "reported_schedule_keys",
        "plan_reason",
        "question_paper_name",
        "subject_name",
        "creation_date",
        "retrieved_at",
        "language",
        "language_variant",
        "variant_rank",
        "internal_exam_date",
        "internal_shift",
        "warnings",
    ]
    return {field: candidate.get(field) for field in fields if field in candidate}


def run_acquisition(
    *,
    inventory_path: Path,
    schedule_path: Path,
    staging_dir: Path,
    report_path: Path,
    dry_run: bool,
    max_file_bytes: int,
    max_total_bytes: int,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    inventory = _validate_inventory_report(_load_json(inventory_path))
    schedule = _validate_schedule(_load_json(schedule_path))
    schedule_info = _schedule_index(schedule)
    plan = _build_download_plan(inventory, schedule)

    verified: list[dict[str, Any]] = []
    quarantined: list[dict[str, Any]] = []
    total_bytes_used = 0
    total_budget_exhausted = False
    for index, candidate in enumerate(plan["planned_candidates"]):
        if total_budget_exhausted:
            quarantined.append(
                {
                    **_plan_summary(candidate),
                    "status": "quarantined",
                    "quarantine_reason": "total_byte_cap_exhausted_before_attempt",
                }
            )
            continue
        record, total_bytes_used, total_budget_exhausted = _verify_or_stage_candidate(
            candidate=candidate,
            staging_dir=staging_dir,
            dry_run=dry_run,
            schedule_info=schedule_info,
            max_file_bytes=max_file_bytes,
            max_total_bytes=max_total_bytes,
            total_bytes_used=total_bytes_used,
            timeout_seconds=timeout_seconds,
        )
        if record is None:
            continue
        if record["status"] == "verified":
            verified.append(record)
        else:
            quarantined.append(record)

    canonical_map = _select_canonical_candidates(verified)
    recovered_keys = set(canonical_map)
    missing = [
        entry
        for entry in schedule_info["ordered"]
        if entry["official_key"] not in recovered_keys
    ]
    canonical_candidates = []
    for entry in schedule_info["ordered"]:
        if entry["official_key"] not in canonical_map:
            continue
        selected = canonical_map[entry["official_key"]]
        canonical_candidates.append(
            {
                **entry,
                "canonical": _stable_candidate_view(selected["canonical"]),
                "alternates": selected["alternates"],
                "regional_fallback": selected["regional_fallback"],
            }
        )

    report = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "inventory_report_path": str(inventory_path),
        "inventory_observed_at": inventory["observed_at"],
        "inventory_report_filename_date": inventory["report_filename_date"],
        "schedule_path": str(schedule_path),
        "schedule_as_of": schedule["as_of"],
        "dry_run": dry_run,
        "config": {
            "staging_dir": str(staging_dir),
            "max_file_bytes": max_file_bytes,
            "max_total_bytes": max_total_bytes,
            "timeout_seconds": timeout_seconds,
        },
        "expected_schedule_keys": schedule_info["ordered"],
        "planned_candidates": plan["planned_candidates"],
        "suppressed_candidates": plan["suppressed_candidates"],
        "verified_candidates": sorted(
            (_stable_candidate_view(item) for item in verified),
            key=lambda item: (item["official_key"], item["paper_url"]),
        ),
        "quarantined_candidates": sorted(
            quarantined,
            key=lambda item: (item.get("paper_url", ""), item.get("quarantine_reason", "")),
        ),
        "canonical_candidates": canonical_candidates,
        "missing_schedule_keys": missing,
        "summary": {
            "expected_schedule_keys": len(schedule_info["ordered"]),
            "planned_candidates": len(plan["planned_candidates"]),
            "suppressed_candidates": len(plan["suppressed_candidates"]),
            "verified_candidates": len(verified),
            "quarantined_candidates": len(quarantined),
            "canonical_candidates": len(canonical_candidates),
            "missing_schedule_keys": len(missing),
        },
        "notes": [
            "The acquisition stage is provenance-first and does not import the manifest.",
            "Reports are byte-stable across unchanged reruns because they reuse stable input and sidecar metadata.",
            "Question text is intentionally excluded from the report.",
        ],
    }
    _atomic_json(report_path, report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory-report", type=Path, default=DEFAULT_INVENTORY_REPORT)
    parser.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    parser.add_argument("--staging-dir", type=Path, default=DEFAULT_STAGING_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    parser.add_argument("--max-total-bytes", type=int, default=DEFAULT_MAX_TOTAL_BYTES)
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    args = parser.parse_args()

    report = run_acquisition(
        inventory_path=args.inventory_report,
        schedule_path=args.schedule,
        staging_dir=args.staging_dir,
        report_path=args.report,
        dry_run=args.dry_run,
        max_file_bytes=args.max_file_bytes,
        max_total_bytes=args.max_total_bytes,
        timeout_seconds=args.timeout_seconds,
    )
    print(
        json.dumps(
            {
                "report": str(args.report),
                "planned_candidates": report["summary"]["planned_candidates"],
                "verified_candidates": report["summary"]["verified_candidates"],
                "missing_schedule_keys": report["summary"]["missing_schedule_keys"],
                "dry_run": args.dry_run,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
