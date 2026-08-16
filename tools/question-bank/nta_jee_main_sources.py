#!/usr/bin/env python3
"""Inventory official NTA JEE Main B.E./B.Tech. question-paper PDFs.

The inventory is intentionally provenance-first:

* only official `nta.ac.in`, `jeemain.nta.nic.in`, and `cdnbbsr.s3waas.gov.in`
  endpoints are queried
* direct PDF artifacts are reported only when an official endpoint exposes them
* historical POST-backed discovery is best-effort and its status is reported
* years without an official live listing stay explicit gaps instead of guesses
* notice rows are a volatile live snapshot and are reported as such

The task requires the report filename
`data/question-bank/reports/nta-jee-main-coverage-2026-08-10.json`. The report
timestamp and observed date are derived from the actual UTC crawl time.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import tempfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_REPORT = (
    DATA_ROOT / "reports" / "nta-jee-main-coverage-2026-08-10.json"
)

REPORT_FILENAME_DATE = "2026-08-10"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
YEAR_RANGE = tuple(range(2019, 2027))
HISTORICAL_YEAR_RANGE = YEAR_RANGE
PROGRAM_LABEL = "B.E./B.Tech."

JEE_MAIN_HOME = "https://jeemain.nta.nic.in/"
NTA_NOTICE_ARCHIVE = "https://www.nta.ac.in/NoticeBoardArchive"
NTA_DOWNLOADS = "https://www.nta.ac.in/Downloads"
JEE_MAIN_AJAX = "https://jeemain.nta.nic.in/wp-admin/admin-ajax.php"
HISTORICAL_POST_URL = "https://www.nta.ac.in/downloads/getlist"
HISTORICAL_POST_DATA = {"Year": "0", "ExamType": "1", "PaperType": "0"}
HISTORICAL_POST_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Referer": NTA_DOWNLOADS,
    "X-Requested-With": "XMLHttpRequest",
}


class InventoryError(RuntimeError):
    """Raised when the live inventory cannot be produced safely."""


@dataclass(frozen=True)
class DirectRow:
    source_url: str
    label: str
    href: str


@dataclass(frozen=True)
class NoticeRow:
    source_url: str
    title: str
    href: str


@dataclass(frozen=True)
class PdfProbe:
    content_type: str | None
    size_bytes: int
    pdf_magic: bool
    pdfinfo: dict[str, str]
    internal_question_paper_name: str | None
    internal_subject_name: str | None
    internal_creation_date: str | None
    internal_language: str | None
    sha256: str | None


class AnchorCollector(HTMLParser):
    """Collect anchors and their visible text from HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.anchors: list[tuple[str, str]] = []
        self._href: str | None = None
        self._chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attr_map = dict(attrs)
        self._href = attr_map.get("href")
        self._chunks = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._href is None:
            return
        text = _clean_text("".join(self._chunks))
        self.anchors.append((self._href, text))
        self._href = None
        self._chunks = []


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _observed_date(observed_at: str) -> str:
    return observed_at.split("T", 1)[0]


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def _month_number(month_text: str) -> int:
    months = {
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
    return months[month_text.casefold()[:3]]


def _fetch(
    url: str,
    *,
    method: str = "GET",
    data: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    encoded = urlencode(data).encode("utf-8") if data is not None else None
    request_headers = {"User-Agent": USER_AGENT}
    if headers:
        request_headers.update(headers)
    request = Request(
        url,
        data=encoded,
        method=method,
        headers=request_headers,
    )
    try:
        with urlopen(request, timeout=60) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return response.status, headers, response.read()
    except HTTPError as exc:
        headers = {key.lower(): value for key, value in exc.headers.items()}
        return exc.code, headers, exc.read()
    except URLError as exc:
        raise InventoryError(f"network error for {url}: {exc}") from exc


def _decode_html(body: bytes) -> str:
    return body.decode("utf-8", errors="replace")


def _validate_https(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise InventoryError(f"expected HTTPS URL, got {url!r}")
    allowed_hosts = {
        "jeemain.nta.nic.in",
        "www.nta.ac.in",
        "nta.ac.in",
        "cdnbbsr.s3waas.gov.in",
    }
    if parsed.netloc not in allowed_hosts:
        raise InventoryError(f"unexpected non-official host in {url!r}")


def _historical_request_spec() -> dict[str, Any]:
    return {
        "url": HISTORICAL_POST_URL,
        "method": "POST",
        "data": dict(HISTORICAL_POST_DATA),
        "headers": dict(HISTORICAL_POST_HEADERS),
    }


def _parse_historical_payload(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("List"), list):
        raise InventoryError(
            "historical endpoint payload must be an object with a List array"
        )
    rows = payload["List"]
    if not all(isinstance(row, dict) for row in rows):
        raise InventoryError("historical endpoint List entries must be objects")
    return rows


def _fetch_historical_payload_response() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    spec = _historical_request_spec()
    status, response_headers, body = _fetch(
        spec["url"],
        method=spec["method"],
        data=spec["data"],
        headers=spec["headers"],
    )
    if status != 200:
        raise InventoryError(
            f"historical endpoint request failed for {spec['url']}: HTTP {status}"
        )
    try:
        payload = json.loads(_decode_html(body))
    except json.JSONDecodeError as exc:
        raise InventoryError(
            f"historical endpoint returned invalid JSON for {spec['url']}"
        ) from exc
    rows = _parse_historical_payload(payload)
    return rows, {
        "url": spec["url"],
        "method": spec["method"],
        "request_headers": spec["headers"],
        "request_data": spec["data"],
        "status": status,
        "content_type": response_headers.get("content-type"),
    }


def _fetch_historical_payload() -> list[dict[str, Any]]:
    rows, _ = _fetch_historical_payload_response()
    return rows


def _clean_optional_text(value: Any) -> str | None:
    text = _clean_text("" if value is None else str(value))
    return text or None


def _build_official_download_url(paper_file: str) -> str:
    candidate = _clean_text(paper_file)
    if not candidate:
        raise InventoryError("historical endpoint row is missing PaperFile")
    absolute_url = (
        candidate if "://" in candidate else urljoin("https://www.nta.ac.in", candidate)
    )
    _validate_https(absolute_url)
    return absolute_url


def _classify_historical_candidate(paper_name: str | None) -> str:
    upper = (paper_name or "").upper()
    excluded_tokens = (
        "B.ARCH",
        "B ARCH",
        "B.PLANNING",
        "B PLANNING",
        "PAPER-II",
        "PAPER II",
        "PAPER 2",
    )
    if any(token in upper for token in excluded_tokens):
        return "excluded"
    if any(token in upper for token in ("B.E.", "B.E", "B TECH", "B.TECH", "BTECH")):
        return "candidate"
    if re.search(r"\bPAPER[\s\-–]*(?:I|1)\b", upper):
        return "candidate_generic_paper_1"
    return "ambiguous"


def _normalize_historical_row(row: dict[str, Any]) -> dict[str, Any]:
    paper_file = _clean_optional_text(row.get("PaperFile"))
    if paper_file is None:
        raise InventoryError("historical endpoint row is missing PaperFile")
    paper_name = _clean_optional_text(row.get("PaperName"))
    reported_year: int | None
    try:
        reported_year = int(row["Year"]) if row.get("Year") is not None else None
    except (TypeError, ValueError):
        reported_year = None
    return {
        "row_id": row.get("ID"),
        "reported_year": reported_year,
        "reported_paper_date": _clean_optional_text(row.get("PaperDate")),
        "reported_shift": _clean_optional_text(row.get("Shift")),
        "reported_paper_name": paper_name,
        "paper_file": paper_file,
        "paper_url": _build_official_download_url(paper_file),
        "candidate_status": _classify_historical_candidate(paper_name),
        "raw_row": dict(row),
    }


def _value_set(rows: list[dict[str, Any]], key: str) -> list[Any]:
    values = {row.get(key) for row in rows if row.get(key) not in (None, "")}
    return sorted(values)


def _group_candidate_status(rows: list[dict[str, Any]]) -> str:
    statuses = {row["candidate_status"] for row in rows}
    if "candidate" in statuses:
        return "candidate"
    if statuses == {"candidate_generic_paper_1"}:
        return "candidate_generic_paper_1"
    if statuses == {"excluded"}:
        return "excluded"
    return "ambiguous"


def _build_historical_inventory(rows: list[dict[str, Any]]) -> dict[str, Any]:
    nonempty_rows: list[dict[str, Any]] = []
    empty_paperfile_rows: list[dict[str, Any]] = []
    for row in rows:
        if _clean_optional_text(row.get("PaperFile")) is None:
            empty_paperfile_rows.append(
                {
                    "row_id": row.get("ID"),
                    "reported_year": row.get("Year"),
                    "reported_paper_name": _clean_optional_text(row.get("PaperName")),
                }
            )
            continue
        nonempty_rows.append(_normalize_historical_row(row))

    counts_by_year_raw = Counter()
    for row in nonempty_rows:
        if row["reported_year"] is not None:
            counts_by_year_raw[str(row["reported_year"])] += 1

    program_candidate_counts_raw = Counter(
        row["candidate_status"] for row in nonempty_rows
    )

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in nonempty_rows:
        groups[row["paper_file"]].append(row)

    unique_papers: list[dict[str, Any]] = []
    suspect_metadata: list[dict[str, Any]] = []
    counts_by_year_unique_consistent = Counter()
    program_candidate_counts_unique = Counter()

    for paper_file, group_rows in sorted(groups.items()):
        representative = group_rows[0]
        conflict_fields: dict[str, list[Any]] = {}
        for key in (
            "reported_year",
            "reported_paper_date",
            "reported_paper_name",
            "reported_shift",
        ):
            values = _value_set(group_rows, key)
            if len(values) > 1:
                conflict_fields[key] = values

        grouped_status = _group_candidate_status(group_rows)
        program_candidate_counts_unique[grouped_status] += 1

        reported_years = _value_set(group_rows, "reported_year")
        if len(reported_years) == 1:
            counts_by_year_unique_consistent[str(reported_years[0])] += 1

        unique_entry = {
            "paper_file": paper_file,
            "paper_url": representative["paper_url"],
            "candidate_status": grouped_status,
            "raw_row_count": len(group_rows),
            "row_ids": [row["row_id"] for row in group_rows],
            "reported_years": reported_years,
            "reported_paper_dates": _value_set(group_rows, "reported_paper_date"),
            "reported_paper_names": _value_set(group_rows, "reported_paper_name"),
            "reported_shifts": _value_set(group_rows, "reported_shift"),
            "raw_rows": [row["raw_row"] for row in group_rows],
        }
        unique_papers.append(unique_entry)

        if conflict_fields:
            suspect_metadata.append(
                {
                    "paper_file": paper_file,
                    "paper_url": representative["paper_url"],
                    "row_count": len(group_rows),
                    "row_ids": unique_entry["row_ids"],
                    "conflict_fields": conflict_fields,
                }
            )

    seen_years = {
        int(year)
        for year in {
            row.get("Year")
            for row in rows
            if row.get("Year") not in (None, "")
        }
    }
    endpoint_coverage_gaps: list[dict[str, Any]] = []
    for year in sorted(set(HISTORICAL_YEAR_RANGE) - seen_years):
        note = "the verified historical endpoint did not return this year"
        if year == 2026:
            note += "; live 2026 direct-paper inventory is reported separately"
        endpoint_coverage_gaps.append(
            {
                "year": year,
                "status": "missing_from_historical_endpoint",
                "notes": note,
            }
        )

    return {
        "request": _historical_request_spec(),
        "response_shape": {"top_level_type": "object", "list_key": "List"},
        "raw_row_count": len(rows),
        "nonempty_paperfile_row_count": len(nonempty_rows),
        "unique_nonempty_paperfile_count": len(unique_papers),
        "duplicate_nonempty_paperfile_row_count": len(nonempty_rows) - len(unique_papers),
        "empty_paperfile_row_count": len(empty_paperfile_rows),
        "counts_by_reported_year_raw": dict(sorted(counts_by_year_raw.items())),
        "counts_by_reported_year_unique_consistent": dict(
            sorted(counts_by_year_unique_consistent.items())
        ),
        "program_candidate_counts_raw": dict(sorted(program_candidate_counts_raw.items())),
        "program_candidate_counts_unique": dict(
            sorted(program_candidate_counts_unique.items())
        ),
        "endpoint_coverage_gaps": endpoint_coverage_gaps,
        "unique_papers": unique_papers,
        "empty_paperfile_rows": empty_paperfile_rows,
        "suspect_metadata": suspect_metadata,
    }


def _collect_direct_rows(home_html: str) -> list[DirectRow]:
    parser = AnchorCollector()
    parser.feed(home_html)
    rows: list[DirectRow] = []
    for href, text in parser.anchors:
        if not re.search(r"\bB\s*Tech\b", text, re.IGNORECASE):
            continue
        if "Shift" not in text:
            continue
        absolute_href = urljoin(JEE_MAIN_HOME, href)
        _validate_https(absolute_href)
        rows.append(DirectRow(source_url=JEE_MAIN_HOME, label=text, href=absolute_href))
    return rows


def _collect_notice_rows(page_html: str, source_url: str) -> list[NoticeRow]:
    pattern = re.compile(
        r"<content[^>]*>(?P<title>.*?)</content>.*?"
        r"<a href=\"(?P<href>/Download/Notice/[^\"]+\.pdf)\"",
        re.IGNORECASE | re.DOTALL,
    )
    rows: list[NoticeRow] = []
    for match in pattern.finditer(page_html):
        title = _clean_text(match.group("title"))
        href = urljoin(source_url, match.group("href"))
        _validate_https(href)
        if "JEE" not in title.upper():
            continue
        rows.append(NoticeRow(source_url=source_url, title=title, href=href))
    return rows


def _normalize_direct_row(row: DirectRow) -> dict[str, Any]:
    label = _clean_text(row.label)
    match = re.search(
        r"B\s*Tech\s+"
        r"(?P<day>\d{1,2})(?:st|nd|rd|th)\s+"
        r"(?P<month>[A-Za-z]{3})\s+"
        r"(?P<year>\d{4})\s+Shift\s*(?P<shift>\d+)",
        label,
        re.IGNORECASE,
    )
    if not match:
        raise InventoryError(f"could not normalize direct row label {label!r}")
    month_number = _month_number(match.group("month"))
    exam_date = (
        f"{match.group('year')}-{month_number:02d}-{int(match.group('day')):02d}"
    )
    session_match = re.search(r"Session[\s\-–]*(\d)", label, flags=re.IGNORECASE)
    session: int | None = None
    session_evidence = "not stated in the live menu label"
    if session_match:
        session = int(session_match.group(1))
        session_evidence = "explicitly stated in the live menu label"
    elif int(match.group("year")) == 2026:
        derived_sessions = {1: 1, 4: 2}
        session = derived_sessions.get(month_number)
        if session is not None:
            session_evidence = "derived from the verified 2026 exam month"
    return {
        "source_url": row.source_url,
        "label": label,
        "href": row.href,
        "year": int(match.group("year")),
        "program": PROGRAM_LABEL,
        "exam_date": exam_date,
        "session": session,
        "session_evidence": session_evidence,
        "shift": int(match.group("shift")),
        "language": None,
        "language_evidence": "not stated in the live menu label",
    }


def _normalize_notice_row(row: NoticeRow) -> dict[str, Any]:
    title = _clean_text(row.title)
    years = [int(value) for value in re.findall(r"\b(20\d{2})\b", title)]
    sessions = re.findall(r"Session[\s\-–]*(\d)", title, flags=re.IGNORECASE)
    return {
        "source_url": row.source_url,
        "title": title,
        "href": row.href,
        "year": years[0] if years else None,
        "sessions": sorted({int(value) for value in sessions}),
        "mentions_question_paper": "QUESTION PAPER" in title.upper(),
        "mentions_answer_key": "ANSWER KEY" in title.upper(),
        "mentions_recorded_response": "RECORDED RESPONSE" in title.upper(),
    }


def _dedupe_records(
    records: list[dict[str, Any]],
    *,
    key_fields: tuple[str, ...],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    unique: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    seen: dict[tuple[Any, ...], dict[str, Any]] = {}
    for record in records:
        key = tuple(record[field] for field in key_fields)
        if key not in seen:
            seen[key] = record
            unique.append(record)
            continue
        duplicates.append(
            {
                "key": {field: record[field] for field in key_fields},
                "first": seen[key],
                "duplicate": record,
            }
        )
    return unique, duplicates


def _run_pdfinfo(path: Path) -> dict[str, str]:
    result = subprocess.run(
        ["pdfinfo", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    info: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        info[_clean_text(key)] = _clean_text(value)
    return info


def _run_pdftotext(path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-f", "1", "-l", "2", str(path), "-"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout


def _parse_pdf_text_metadata(text: str) -> dict[str, str | None]:
    lines = [_clean_text(line) for line in text.splitlines() if _clean_text(line)]
    joined = "\n".join(lines)
    question_paper_name: str | None = None
    subject_name: str | None = None
    creation_date: str | None = None
    language: str | None = None

    paired_pattern = re.compile(
        r"Question Paper Name\s*:?\s*(?P<question_paper_name>.*?)\n"
        r"Subject Name\s*:?\s*(?P<subject_name>.*?)\n"
        r"Creation Date\s*:?\s*(?P<creation_date>[^\n]+)",
        re.IGNORECASE | re.DOTALL,
    )
    paired_match = paired_pattern.search(joined)
    if paired_match:
        question_paper_name = _clean_text(paired_match.group("question_paper_name"))
        subject_name = _clean_text(paired_match.group("subject_name"))
        creation_date = _clean_text(paired_match.group("creation_date"))

    if (
        (not question_paper_name or creation_date in {None, "", "Duration :"})
        and len(lines) >= 12
    ):
        header_labels = [
            "Question Paper Name :",
            "Subject Name :",
            "Creation Date :",
            "Duration :",
            "Total Marks :",
            "Display Marks:",
        ]
        for index in range(len(lines) - len(header_labels)):
            window = lines[index : index + len(header_labels)]
            if window != header_labels:
                continue
            values = lines[index + len(header_labels) : index + (2 * len(header_labels))]
            if len(values) < len(header_labels):
                continue
            question_paper_name = values[0]
            subject_name = values[1]
            creation_date = values[2]
            break

    if question_paper_name in {"", ":"}:
        question_paper_name = None
    if subject_name in {"", ":"}:
        subject_name = None

    language_match = re.search(r"\bLang\s+(?P<language>[A-Za-z]+)\b", joined)
    if language_match:
        language = _clean_text(language_match.group("language"))

    return {
        "question_paper_name": question_paper_name,
        "subject_name": subject_name,
        "creation_date": creation_date,
        "language": language,
    }


def _stage_pdf_bytes(
    pdf_bytes: bytes,
    url: str,
    staging_dir: Path | None,
) -> tuple[Path, str | None]:
    if staging_dir is None:
        handle = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        handle.write(pdf_bytes)
        handle.close()
        return Path(handle.name), None

    staging_dir.mkdir(parents=True, exist_ok=True)
    filename = Path(urlparse(url).path).name or "artifact.pdf"
    destination = staging_dir / filename
    destination.write_bytes(pdf_bytes)
    sha256 = hashlib.sha256(pdf_bytes).hexdigest()
    return destination, sha256


def _probe_pdf(url: str, staging_dir: Path | None) -> PdfProbe:
    status, headers, body = _fetch(url)
    if status != 200:
        raise InventoryError(f"expected HTTP 200 for {url}, got {status}")
    pdf_magic = body.startswith(b"%PDF-")
    path, sha256 = _stage_pdf_bytes(body, url, staging_dir)
    try:
        pdfinfo = _run_pdfinfo(path)
        text = _run_pdftotext(path)
        parsed = _parse_pdf_text_metadata(text)
    finally:
        if staging_dir is None:
            path.unlink(missing_ok=True)
    return PdfProbe(
        content_type=headers.get("content-type"),
        size_bytes=len(body),
        pdf_magic=pdf_magic,
        pdfinfo=pdfinfo,
        internal_question_paper_name=parsed["question_paper_name"],
        internal_subject_name=parsed["subject_name"],
        internal_creation_date=parsed["creation_date"],
        internal_language=parsed["language"],
        sha256=sha256,
    )


def _probe_post_candidates() -> list[dict[str, Any]]:
    candidates = [
        {
            "name": "jeemain-wordpress-admin-ajax-empty-post",
            "url": JEE_MAIN_AJAX,
            "data": {},
        },
        {
            "name": "nta-downloads-empty-post",
            "url": NTA_DOWNLOADS,
            "data": {},
        },
        {
            "name": "nta-notice-archive-empty-post",
            "url": NTA_NOTICE_ARCHIVE,
            "data": {},
        },
    ]
    results: list[dict[str, Any]] = []
    for candidate in candidates:
        status, headers, body = _fetch(
            candidate["url"],
            method="POST",
            data=candidate["data"],
        )
        snippet = _clean_text(_decode_html(body)[:200])
        results.append(
            {
                "name": candidate["name"],
                "url": candidate["url"],
                "status": status,
                "content_type": headers.get("content-type"),
                "body_snippet": snippet,
                "usable_historical_rows": False,
                "notes": (
                    "blank POST accepted but did not expose paper rows"
                    if status < 400
                    else "POST endpoint unavailable for historical paper listing"
                ),
            }
        )
    return results


def _build_gap_report(
    direct_artifacts: list[dict[str, Any]],
    notice_rows: list[dict[str, Any]],
    observed_date: str | None = None,
) -> list[dict[str, Any]]:
    direct_years = {artifact["year"] for artifact in direct_artifacts}
    notices_by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in notice_rows:
        if row["year"] is not None:
            notices_by_year[row["year"]].append(row)

    gaps: list[dict[str, Any]] = []
    for year in YEAR_RANGE:
        if year not in direct_years:
            sessions = sorted(
                {
                    session
                    for row in notices_by_year.get(year, [])
                    for session in row["sessions"]
                }
            )
            gaps.append(
                {
                    "year": year,
                    "status": "no_direct_official_question_paper_pdf_linked",
                    "program": PROGRAM_LABEL,
                    "official_notice_sessions_seen": sessions,
                    "notes": (
                        "official notices were present but no direct paper PDF link was "
                        "surfaced by the crawled official endpoints"
                        if notices_by_year.get(year)
                        else "no direct paper PDF or notice evidence was surfaced"
                    ),
                }
            )

    session_2026_direct = sorted(
        {
            artifact["session"]
            for artifact in direct_artifacts
            if artifact["year"] == 2026
            and isinstance(artifact.get("session"), int)
        }
    )
    if session_2026_direct == [2]:
        note_date = observed_date or "the observed crawl date"
        gaps.append(
            {
                "year": 2026,
                "status": "session_gap",
                "program": PROGRAM_LABEL,
                "missing_session": 1,
                "notes": (
                    "the live official question-paper menu exposes Session 2 B.E./B.Tech "
                    "papers only; no Session 1 direct paper PDFs were linked on "
                    f"{note_date}"
                ),
            }
        )
    return gaps


def _language_variants(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    variants: dict[int, set[str]] = defaultdict(set)
    unstated = 0
    for artifact in artifacts:
        language = artifact["pdf_probe"]["internal_language"]
        if language:
            variants[artifact["year"]].add(language)
        else:
            unstated += 1
    return {
        "by_year": {str(year): sorted(values) for year, values in sorted(variants.items())},
        "unstated_pdf_count": unstated,
        "notes": "2026 live PDFs expose program/date/shift metadata but not an explicit language field",
    }


def _is_jee_main_notice(title: str) -> bool:
    upper = title.upper()
    if "JEE" not in upper:
        return False
    if not (
        "JEE (MAIN)" in upper
        or "JEE(MAIN)" in upper
        or "JOINT ENTRANCE EXAMINATION (MAIN)" in upper
    ):
        return False
    excluded_tokens = ("B.ARCH", "B.PLANNING", "PAPER-II", "PAPER 2A", "PAPER 2B")
    return not any(token in upper for token in excluded_tokens)


def _build_notice_snapshot(
    *,
    observed_at: str,
    notice_rows: list[dict[str, Any]],
    notice_duplicates: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "captured_at": observed_at,
        "captured_date": _observed_date(observed_at),
        "volatile_live_snapshot": True,
        "row_count": len(notice_rows),
        "duplicate_row_count": len(notice_duplicates),
        "source_urls": [NTA_NOTICE_ARCHIVE, NTA_DOWNLOADS],
        "notes": [
            "Official notice rows are a live crawl snapshot and may drift between runs.",
            "Use the historical endpoint inventory for deterministic historical coverage counts.",
            "Do not treat notice_row_count as stable historical evidence.",
        ],
    }


def build_inventory(*, staging_dir: Path | None) -> dict[str, Any]:
    observed_at = _utc_now()
    home_status, home_headers, home_body = _fetch(JEE_MAIN_HOME)
    notice_status, notice_headers, notice_body = _fetch(NTA_NOTICE_ARCHIVE)
    downloads_status, downloads_headers, downloads_body = _fetch(NTA_DOWNLOADS)
    historical_rows, historical_response = _fetch_historical_payload_response()

    if home_status != 200:
        raise InventoryError(f"failed to fetch {JEE_MAIN_HOME}: HTTP {home_status}")
    if notice_status != 200:
        raise InventoryError(
            f"failed to fetch {NTA_NOTICE_ARCHIVE}: HTTP {notice_status}"
        )
    if downloads_status != 200:
        raise InventoryError(f"failed to fetch {NTA_DOWNLOADS}: HTTP {downloads_status}")

    direct_rows = [_normalize_direct_row(row) for row in _collect_direct_rows(_decode_html(home_body))]
    direct_rows, direct_duplicates = _dedupe_records(
        direct_rows,
        key_fields=("href", "label"),
    )

    notice_rows = [
        _normalize_notice_row(row)
        for row in [
            *_collect_notice_rows(_decode_html(notice_body), NTA_NOTICE_ARCHIVE),
            *_collect_notice_rows(_decode_html(downloads_body), NTA_DOWNLOADS),
        ]
        if _is_jee_main_notice(row.title)
    ]
    notice_rows, notice_duplicates = _dedupe_records(
        notice_rows,
        key_fields=("href", "title"),
    )
    notice_snapshot = _build_notice_snapshot(
        observed_at=observed_at,
        notice_rows=notice_rows,
        notice_duplicates=notice_duplicates,
    )
    historical_inventory = _build_historical_inventory(historical_rows)
    historical_inventory["response"] = historical_response

    probed_direct_artifacts: list[dict[str, Any]] = []
    suspect_metadata: list[dict[str, Any]] = []
    for direct_row in direct_rows:
        probe = _probe_pdf(direct_row["href"], staging_dir)
        artifact = {**direct_row, "pdf_probe": asdict(probe)}
        probed_direct_artifacts.append(artifact)
        if not probe.pdf_magic:
            suspect_metadata.append(
                {
                    "url": direct_row["href"],
                    "reason": "response did not start with %PDF-",
                }
            )
            continue
        question_paper_name = probe.internal_question_paper_name or ""
        if question_paper_name and direct_row["label"] not in question_paper_name:
            suspect_metadata.append(
                {
                    "url": direct_row["href"],
                    "reason": "menu label and internal question-paper name differ",
                    "menu_label": direct_row["label"],
                    "internal_question_paper_name": question_paper_name,
                }
            )

    report = {
        "schema_version": "nta-jee-main-source-inventory/v1",
        "observed_at": observed_at,
        "observed_date": _observed_date(observed_at),
        "report_filename_date": REPORT_FILENAME_DATE,
        "notes": [
            "The report filename date was task-specified.",
            "The live crawl and endpoint observations were timestamped from the actual UTC run.",
            "Only official nta.ac.in, jeemain.nta.nic.in, and cdnbbsr.s3waas.gov.in endpoints were queried.",
            "Historical endpoint inventory is provenance-first and does not download the discovered historical PDFs.",
            "Official notice rows are retained as a volatile live snapshot for auditability and may drift between runs.",
        ],
        "endpoint_status": {
            "jeemain_home": {
                "url": JEE_MAIN_HOME,
                "status": home_status,
                "content_type": home_headers.get("content-type"),
            },
            "nta_notice_archive": {
                "url": NTA_NOTICE_ARCHIVE,
                "status": notice_status,
                "content_type": notice_headers.get("content-type"),
            },
            "nta_downloads": {
                "url": NTA_DOWNLOADS,
                "status": downloads_status,
                "content_type": downloads_headers.get("content-type"),
            },
            "historical_post_listing": historical_response,
        },
        "summary": {
            "direct_question_paper_pdf_count": len(probed_direct_artifacts),
            "notice_row_count": len(notice_rows),
            "duplicate_notice_row_count": len(notice_duplicates),
            "duplicate_direct_row_count": len(direct_duplicates),
            "historical_raw_row_count": historical_inventory["raw_row_count"],
            "historical_unique_nonempty_paperfile_count": historical_inventory[
                "unique_nonempty_paperfile_count"
            ],
            "historical_candidate_unique_count": historical_inventory[
                "program_candidate_counts_unique"
            ].get("candidate", 0)
            + historical_inventory["program_candidate_counts_unique"].get(
                "candidate_generic_paper_1", 0
            ),
            "historical_excluded_unique_count": historical_inventory[
                "program_candidate_counts_unique"
            ].get("excluded", 0),
            "historical_ambiguous_unique_count": historical_inventory[
                "program_candidate_counts_unique"
            ].get("ambiguous", 0),
            "years_with_direct_question_papers": sorted(
                {artifact["year"] for artifact in probed_direct_artifacts}
            ),
            "years_in_scope": list(YEAR_RANGE),
        },
        "direct_question_paper_pdfs": probed_direct_artifacts,
        "historical_endpoint_inventory": historical_inventory,
        "official_notice_snapshot": notice_snapshot,
        "official_notice_rows": notice_rows,
        "duplicate_rows": {
            "direct_question_papers": direct_duplicates,
            "official_notice_rows": notice_duplicates,
        },
        "language_variants": _language_variants(probed_direct_artifacts),
        "suspect_metadata": suspect_metadata,
        "gaps": _build_gap_report(
            probed_direct_artifacts,
            notice_rows,
            observed_date=_observed_date(observed_at),
        ),
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help="Where to write the JSON report.",
    )
    parser.add_argument(
        "--staging-dir",
        type=Path,
        default=None,
        help="Optional directory for staged PDFs. SHA-256 values are emitted only when set.",
    )
    args = parser.parse_args()

    report = build_inventory(staging_dir=args.staging_dir)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "report": str(args.report),
                "direct_question_paper_pdf_count": report["summary"][
                    "direct_question_paper_pdf_count"
                ],
                "historical_unique_nonempty_paperfile_count": report["summary"][
                    "historical_unique_nonempty_paperfile_count"
                ],
                "years_with_direct_question_papers": report["summary"][
                    "years_with_direct_question_papers"
                ],
                "observed_date": report["observed_date"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
