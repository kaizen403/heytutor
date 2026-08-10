#!/usr/bin/env python3
"""Build a provenance-first legacy IIT-JEE source report.

This tool is intentionally narrow:
- 2000-2006 IIT-JEE legacy mathematics paper family
- 2000-2005 two-round structure: screening + main
- 2006 single objective mathematics paper

It keeps the provenance threshold explicit:
- no commercial topic databases are used as provenance
- a 2000-2006 artifact becomes ``verified`` only after two independent
  institutional hosts agree on the fetched bytes or on the first-page identity
- anything with only one institutional source stays ``candidate-only``
- anything with no institutional source stays ``missing``

The report is JSON and the source bytes are never committed. If
``--staging-dir`` is supplied, fetched artifact bytes are copied there for local
inspection only.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import html.parser
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlsplit, urlunsplit


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_REPORT = DATA_ROOT / "reports" / "legacy-jee-coverage-2026-08-10.json"

REPORT_SCHEMA_VERSION = "question-bank-legacy-jee-sources/v1"
AS_OF_DATE = "2026-08-09"
USER_AGENT = "Mozilla/5.0 (compatible; HeyTutor Legacy JEE Source Audit/1.0)"
MAX_BYTES_DEFAULT = 32 * 1024 * 1024


class VerificationError(RuntimeError):
    """Raised when a fetched source cannot be audited honestly."""


@dataclass(frozen=True)
class ArtifactSpec:
    artifact_id: str
    year: int
    stage: str
    paper_label: str
    subject: str
    language: str | None
    set_label: str | None
    source_urls: tuple[str, ...]
    notes: str


@dataclass(frozen=True)
class ContextSpec:
    context_id: str
    label: str
    url: str
    notes: str
    expect_pdf: bool = False


@dataclass(frozen=True)
class SourceProbe:
    url: str
    final_url: str
    host: str
    status: int | str
    content_type: str | None
    title: str | None
    body_sha256: str | None
    magic: str | None
    bytes_sha256: str | None
    page_count: int | None
    page1_image_sha256: str | None
    page1_text_sha256: str | None
    staged_path: str | None
    error: str | None


class _HTMLTitleParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_title = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "title":
            self.in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.parts.append(data)

    def title(self) -> str | None:
        value = "".join(self.parts).strip()
        return value or None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def _normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise VerificationError(f"unsupported URL scheme: {url}")
    path = quote(parts.path, safe="/%._-~()")
    query = quote(parts.query, safe="=&%._-~")
    fragment = quote(parts.fragment, safe="%._-~")
    return urlunsplit(("https", parts.netloc.lower(), path, query, fragment))


def _canonical_host(url: str) -> str:
    host = urlsplit(_normalize_url(url)).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\s+", " ", text, flags=re.UNICODE)
    return text.strip()


def _sniff_magic(data: bytes) -> str:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return "zip"
    if data.startswith((b"Rar!\x1a\x07\x00", b"Rar!\x1a\x07\x01\x00")):
        return "rar"
    raise VerificationError("unrecognized file magic")


def _title_from_html(data: bytes) -> str | None:
    try:
        html_text = data.decode("utf-8", "replace")
    except Exception:
        return None
    parser = _HTMLTitleParser()
    try:
        parser.feed(html_text)
    except Exception:
        return None
    return parser.title()


def _command_available(executable: str) -> bool:
    return shutil.which(executable) is not None


def _render_first_page_png(pdf_path: Path, png_path: Path) -> bytes | None:
    if not _command_available("pdftoppm"):
        return None
    try:
        subprocess.run(
            [
                "pdftoppm",
                "-r",
                "144",
                "-png",
                "-singlefile",
                "-f",
                "1",
                "-l",
                "1",
                str(pdf_path),
                str(png_path.with_suffix("")),
            ],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError:
        return None
    if png_path.exists():
        return png_path.read_bytes()
    return None


def _page_count(pdf_path: Path) -> int | None:
    if not _command_available("pdfinfo"):
        return None
    try:
        result = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        return None
    for line in result.stdout.splitlines():
        if line.startswith("Pages:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return None
    return None


def _first_page_text(pdf_path: Path) -> str | None:
    if not _command_available("pdftotext"):
        return None
    try:
        result = subprocess.run(
            ["pdftotext", "-f", "1", "-l", "1", str(pdf_path), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError:
        return None
    text = _normalize_text(result.stdout)
    if len(re.findall(r"[A-Za-z0-9]", text)) < 20:
        return None
    return text


def _first_page_hashes(pdf_bytes: bytes) -> tuple[str | None, str | None]:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_root = Path(temp_dir)
        pdf_path = temp_root / "source.pdf"
        pdf_path.write_bytes(pdf_bytes)

        text = _first_page_text(pdf_path)
        png_path = temp_root / "page1.png"
        png_bytes = _render_first_page_png(pdf_path, png_path)
        image_hash = _sha256_bytes(png_bytes) if png_bytes is not None else None
        text_hash = _sha256_bytes(text.encode("utf-8")) if text is not None else None
        return image_hash, text_hash


def _probe_url(
    url: str,
    *,
    expect_pdf: bool,
    timeout_seconds: float,
    max_bytes: int,
    staging_dir: Path | None,
    staged_name: str | None = None,
) -> SourceProbe:
    normalized_url = _normalize_url(url)
    request = urllib.request.Request(
        normalized_url,
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=timeout_seconds,
            context=ssl_context(),
        ) as response:
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise VerificationError(f"{normalized_url}: exceeded max-bytes={max_bytes}")
            final_url = _normalize_url(response.geturl())
            status = getattr(response, "status", 200)
            content_type = response.headers.get_content_type()
            title = _title_from_html(data) if content_type == "text/html" else None
    except urllib.error.HTTPError as exc:
        return SourceProbe(
            url=normalized_url,
            final_url=normalized_url,
            host=_canonical_host(normalized_url),
            status=exc.code,
            content_type=exc.headers.get_content_type() if exc.headers else None,
            title=None,
            body_sha256=None,
            magic=None,
            bytes_sha256=None,
            page_count=None,
            page1_image_sha256=None,
            page1_text_sha256=None,
            staged_path=None,
            error=str(exc),
        )
    except Exception as exc:
        return SourceProbe(
            url=normalized_url,
            final_url=normalized_url,
            host=_canonical_host(normalized_url),
            status="error",
            content_type=None,
            title=None,
            body_sha256=None,
            magic=None,
            bytes_sha256=None,
            page_count=None,
            page1_image_sha256=None,
            page1_text_sha256=None,
            staged_path=None,
            error=str(exc),
        )

    body_sha256 = _sha256_bytes(data)
    magic = None
    page_count = None
    page1_image_sha256 = None
    page1_text_sha256 = None
    staged_path = None
    error = None

    if expect_pdf:
        try:
            magic = _sniff_magic(data)
        except VerificationError as exc:
            error = str(exc)
        else:
            if magic not in {"pdf", "zip"}:
                error = f"unexpected artifact kind: {magic}"
            elif magic == "pdf":
                page_count = _page_count_from_bytes(data)
                page1_image_sha256, page1_text_sha256 = _first_page_hashes(data)
            if staging_dir is not None and error is None:
                staged_path = _stage_bytes(
                    staging_dir,
                    data,
                    staged_name or _suggest_stage_name(normalized_url, body_sha256),
                )
    else:
        if content_type == "text/html":
            magic = "html"
        if staging_dir is not None:
            staged_path = None

    return SourceProbe(
        url=normalized_url,
        final_url=final_url,
        host=_canonical_host(normalized_url),
        status=status,
        content_type=content_type,
        title=title,
        body_sha256=body_sha256,
        magic=magic,
        bytes_sha256=body_sha256 if expect_pdf and error is None else None,
        page_count=page_count,
        page1_image_sha256=page1_image_sha256,
        page1_text_sha256=page1_text_sha256,
        staged_path=staged_path,
        error=error,
    )


def ssl_context():
    import ssl

    return ssl._create_unverified_context()


def _page_count_from_bytes(data: bytes) -> int | None:
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "source.pdf"
        pdf_path.write_bytes(data)
        return _page_count(pdf_path)


def _stage_bytes(staging_dir: Path, data: bytes, staged_name: str) -> str:
    staging_dir.mkdir(parents=True, exist_ok=True)
    suffix = ".pdf"
    if staged_name.endswith(".html"):
        suffix = ".html"
    elif staged_name.endswith(".zip"):
        suffix = ".zip"
    elif staged_name.endswith(".bin"):
        suffix = ".bin"
    destination = staging_dir / f"{staged_name}{suffix}"
    destination.write_bytes(data)
    return str(destination)


def _suggest_stage_name(url: str, fingerprint: str) -> str:
    parsed = urlsplit(url)
    stem = Path(parsed.path).name or "source"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-") or "source"
    return f"{stem}-{fingerprint[:12]}"


def _artifact_specs() -> tuple[ArtifactSpec, ...]:
    commentary = "Institutional commentary PDF; no second non-commercial mirror was located in this pass."
    return (
        ArtifactSpec(
            artifact_id="jee-2000-mathematics-screening",
            year=2000,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2000-mathematics-main",
            year=2000,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2001-mathematics-screening",
            year=2001,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2001-mathematics-main",
            year=2001,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2002-mathematics-screening",
            year=2002,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2002-mathematics-main",
            year=2002,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language=None,
            set_label=None,
            source_urls=(),
            notes="No non-commercial institutional source was recovered during this audit.",
        ),
        ArtifactSpec(
            artifact_id="jee-2003-mathematics-screening",
            year=2003,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2003.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2003-mathematics-main",
            year=2003,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2003.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2004-mathematics-screening",
            year=2004,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2004.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2004-mathematics-main",
            year=2004,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2004.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2005-mathematics-screening",
            year=2005,
            stage="screening",
            paper_label="Screening Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2005.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2005-mathematics-main",
            year=2005,
            stage="main",
            paper_label="Main Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2005.pdf",),
            notes=commentary,
        ),
        ArtifactSpec(
            artifact_id="jee-2006-mathematics-paper",
            year=2006,
            stage="single",
            paper_label="Mathematics Paper",
            subject="Mathematics",
            language="English",
            set_label=None,
            source_urls=("https://www.math.iitb.ac.in/~kdjoshi/jee2006",),
            notes=(
                "Single objective mathematics paper; the institutional commentary "
                "describes it as 53 problems in two hours."
            ),
        ),
    )


def _context_specs() -> tuple[ContextSpec, ...]:
    return (
        ContextSpec(
            context_id="official-archive-boundary",
            label="Official archive boundary",
            url="https://jeeadv.ac.in/archive.html",
            notes="The official JEE Advanced archive starts at 2007 and lists question papers from 2007 onward.",
        ),
        ContextSpec(
            context_id="iitb-chronology",
            label="IIT Bombay chronology note",
            url="https://www.civil.iitb.ac.in/tvm/4201-bioData/tvmcv/tvmcv.html",
            notes=(
                "Institutional CV listing JEE 2001 screening, 2002 main, 2003 screening/main, "
                "2004 screening/main, 2005 screening/main, and 2006 main."
            ),
        ),
        ContextSpec(
            context_id="iitb-commentary-index",
            label="IIT Bombay commentary index",
            url="https://www.math.iitb.ac.in/~kdjoshi/jee",
            notes="Index page linking the JEE mathematics commentary PDFs from 2003 onward.",
        ),
    )


def _classify_artifact(probes: list[SourceProbe]) -> tuple[str, str | None, str | None]:
    successful = [probe for probe in probes if probe.error is None and probe.status == 200]
    independent_hosts = {
        probe.host for probe in successful if probe.host
    }
    if not successful:
        return "missing", None, "no recoverable institutional source was probed"
    if len(independent_hosts) < 2:
        return (
            "candidate-only",
            None,
            "fewer than two independent institutional hosts were recovered",
        )

    comparisons = (
        ("bytes_sha256", "fetched bytes"),
        ("page1_image_sha256", "first-page image"),
        ("page1_text_sha256", "first-page text"),
    )
    saw_comparable_mismatch = False
    for attribute, basis in comparisons:
        values = [getattr(probe, attribute) for probe in successful]
        if all(value is not None for value in values) and len(set(values)) == 1:
            return "verified", basis, None
        if all(value is not None for value in values) and len(set(values)) > 1:
            saw_comparable_mismatch = True

    if saw_comparable_mismatch:
        return "conflicting", "fetched bytes / first-page identity", (
            "independent hosts disagreed on the artifact identity"
        )

    return "candidate-only", None, "fewer than two comparable fingerprints were available"


def _artifact_record(
    spec: ArtifactSpec,
    probes: list[SourceProbe],
) -> dict[str, Any]:
    status, comparison_basis, status_note = _classify_artifact(probes)
    independent_hosts = sorted({probe.host for probe in probes if probe.error is None and probe.status == 200})
    successful = [probe for probe in probes if probe.error is None and probe.status == 200]

    record = {
        "artifact_id": spec.artifact_id,
        "year": spec.year,
        "stage": spec.stage,
        "paper_label": spec.paper_label,
        "subject": spec.subject,
        "language": spec.language,
        "set_label": spec.set_label,
        "status": status,
        "comparison_basis": comparison_basis,
        "status_note": status_note,
        "independent_source_families": independent_hosts,
        "independent_source_count": len(independent_hosts),
        "successful_probe_count": len(successful),
        "source_urls": list(spec.source_urls),
        "notes": spec.notes,
        "source_probes": [dataclasses.asdict(probe) for probe in probes],
    }
    return record


def _probe_context_source(
    spec: ContextSpec,
    *,
    timeout_seconds: float,
) -> dict[str, Any]:
    probe = _probe_url(
        spec.url,
        expect_pdf=spec.expect_pdf,
        timeout_seconds=timeout_seconds,
        max_bytes=MAX_BYTES_DEFAULT,
        staging_dir=None,
        staged_name=None,
    )
    return {
        "context_id": spec.context_id,
        "label": spec.label,
        "url": probe.url,
        "final_url": probe.final_url,
        "status": probe.status,
        "content_type": probe.content_type,
        "title": probe.title,
        "body_sha256": probe.body_sha256,
        "notes": spec.notes,
        "error": probe.error,
    }


def build_report(
    *,
    staging_dir: Path | None,
    timeout_seconds: float,
    max_bytes: int,
) -> dict[str, Any]:
    artifact_specs = _artifact_specs()
    context_specs = _context_specs()

    artifacts: list[dict[str, Any]] = []
    for spec in artifact_specs:
        probes = [
            _probe_url(
                source_url,
                expect_pdf=True,
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
                staging_dir=staging_dir,
                staged_name=f"{spec.artifact_id}-{index + 1}",
            )
            for index, source_url in enumerate(spec.source_urls)
        ]
        artifacts.append(_artifact_record(spec, probes))

    context_sources = [
        _probe_context_source(spec, timeout_seconds=timeout_seconds)
        for spec in context_specs
    ]

    summary = {
        "artifact_total": len(artifacts),
        "verified": sum(1 for artifact in artifacts if artifact["status"] == "verified"),
        "candidate_only": sum(1 for artifact in artifacts if artifact["status"] == "candidate-only"),
        "conflicting": sum(1 for artifact in artifacts if artifact["status"] == "conflicting"),
        "missing": sum(1 for artifact in artifacts if artifact["status"] == "missing"),
    }

    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "generated_at": _utc_now(),
        "as_of": AS_OF_DATE,
        "scope": {
            "exam": "IIT-JEE",
            "subject_scope": ["Mathematics"],
            "years": "2000-2006",
            "notes": (
                "This report is intentionally narrow to the institutional mathematics "
                "commentary family that was recoverable without commercial topic databases. "
                "Physics and chemistry mirrors were not grounded in this pass."
            ),
            "recoverability_threshold": 2,
            "excluded_provenance_families": ["commercial topic databases"],
        },
        "boundary": {
            "official_archive_url": "https://jeeadv.ac.in/archive.html",
            "official_archive_starts_year": 2007,
        },
        "context_sources": context_sources,
        "summary": summary,
        "artifacts": artifacts,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a provenance-first legacy IIT-JEE source report."
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help="Output JSON report path.",
    )
    parser.add_argument(
        "--staging-dir",
        type=Path,
        help="Optional directory to copy fetched artifact bytes for local inspection.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Per-URL timeout in seconds.",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=MAX_BYTES_DEFAULT,
        help="Maximum bytes to fetch from a single URL.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    report = build_report(
        staging_dir=args.staging_dir,
        timeout_seconds=args.timeout,
        max_bytes=args.max_bytes,
    )
    _atomic_write_json(args.report, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
