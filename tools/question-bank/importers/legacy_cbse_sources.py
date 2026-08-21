#!/usr/bin/env python3
"""Build a provenance-first official CBSE Class XII legacy source report.

This inventory is intentionally narrow:
- CBSE Class XII
- Mathematics and Physics
- 2007-2020 archival question papers on primary ``cbse.gov.in`` hosts
- 2021 regular-exam cancellation as an explicit non-paper event

The report never writes bulk source bytes into git. When ``--staging-dir`` is
provided, verified downloads are copied there for local inspection only.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlsplit, urlunsplit

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
DEFAULT_REPORT = DATA_ROOT / "reports" / "coverage" / "legacy-cbse-coverage-2026-08-10.json"

REPORT_SCHEMA_VERSION = "question-bank-legacy-cbse-sources/v1"
AS_OF_DATE = "2026-08-09"
MAX_BYTES_DEFAULT = 200 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (compatible; HeyTutor Legacy CBSE Source Audit/1.0)"


class VerificationError(RuntimeError):
    """Raised when an official artifact cannot be verified honestly."""


@dataclass(frozen=True)
class ArtifactSpec:
    artifact_id: str
    year: int
    session: str
    subject: str
    kind: str
    url: str
    source_page_url: str
    region: str | None = None
    set_label: str | None = None
    accessibility_variant: str = "standard"
    notes: str | None = None


@dataclass(frozen=True)
class ProbeSpec:
    url: str
    note: str


@dataclass(frozen=True)
class GapSpec:
    year: int
    scope: str
    status: str
    notes: str
    probes: tuple[ProbeSpec, ...] = ()


@dataclass(frozen=True)
class EventSpec:
    event_id: str
    year: int
    title: str
    status: str
    notes: str
    sources: tuple[str, ...]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise VerificationError(f"expected HTTPS URL, got: {url}")
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            quote(parts.path, safe="/%._-~()"),
            quote(parts.query, safe="=&%._-~"),
            quote(parts.fragment, safe="%._-~"),
        )
    )


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


def _fetch_bytes(url: str, *, timeout_seconds: float, max_bytes: int) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(
        _normalize_url(url),
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise VerificationError(f"{url}: exceeded max-bytes={max_bytes}")
        headers = {
            "content_type": response.headers.get_content_type(),
            "content_length": response.headers.get("Content-Length"),
            "last_modified": response.headers.get("Last-Modified"),
        }
    return data, headers


def _probe_url(url: str, *, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(_normalize_url(url), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return {
                "url": _normalize_url(url),
                "status": response.status,
                "content_type": response.headers.get_content_type(),
            }
    except urllib.error.HTTPError as exc:
        return {
            "url": _normalize_url(url),
            "status": exc.code,
            "content_type": exc.headers.get_content_type() if exc.headers is not None else None,
        }
    except OSError as exc:
        return {
            "url": _normalize_url(url),
            "status": "error",
            "error": str(exc),
        }


def sniff_magic(data: bytes) -> str:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
        return "zip"
    if data.startswith((b"Rar!\x1a\x07\x00", b"Rar!\x1a\x07\x01\x00")):
        return "rar"
    raise VerificationError("unrecognized file magic; expected PDF, ZIP, or RAR")


def _detect_kind_or_none(data: bytes) -> str | None:
    try:
        return sniff_magic(data)
    except VerificationError:
        return None


def _looks_like_pdf_structure(data: bytes) -> bool:
    head = data[:4096]
    return b"endobj" in head and b"/PDF" in head


def _list_zip_members(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = [
            info.filename
            for info in archive.infolist()
            if not info.is_dir()
        ]
    return sorted(members)


def _list_rar_members(data: bytes) -> list[str]:
    executable = shutil.which("unrar")
    if executable is None:
        raise VerificationError("RAR artifact encountered but `unrar` is unavailable")
    with tempfile.NamedTemporaryFile(prefix="cbse-", suffix=".rar", delete=False) as temp:
        temp.write(data)
        temp_path = Path(temp.name)
    try:
        result = subprocess.run(
            [executable, "lb", str(temp_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        members = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        return sorted(members)
    except subprocess.CalledProcessError as exc:
        raise VerificationError(f"failed to inspect RAR members for {temp_path.name}") from exc
    finally:
        temp_path.unlink(missing_ok=True)


def list_container_members(kind: str, data: bytes) -> list[str] | None:
    if kind == "zip":
        return _list_zip_members(data)
    if kind == "rar":
        return _list_rar_members(data)
    return None


def _write_staged_copy(staging_dir: Path, spec: ArtifactSpec, data: bytes) -> str:
    staging_dir.mkdir(parents=True, exist_ok=True)
    suffix = {"pdf": ".pdf", "zip": ".zip", "rar": ".rar"}[spec.kind]
    destination = staging_dir / f"{spec.artifact_id}{suffix}"
    destination.write_bytes(data)
    return str(destination)


def _verify_artifact(
    spec: ArtifactSpec,
    *,
    timeout_seconds: float,
    max_bytes: int,
    staging_dir: Path | None,
) -> dict[str, Any]:
    data, headers = _fetch_bytes(
        spec.url, timeout_seconds=timeout_seconds, max_bytes=max_bytes
    )
    detected_kind = _detect_kind_or_none(data)
    verification_status = "verified"
    verification_notes: list[str] = []
    effective_kind = spec.kind
    if detected_kind is None:
        if spec.kind == "pdf" and headers.get("content_type") == "application/pdf" and _looks_like_pdf_structure(data):
            verification_status = "anomalous"
            verification_notes.append(
                "Content-Type is application/pdf and PDF object structure is present, but the %PDF header magic is missing."
            )
        else:
            raise VerificationError(
                f"{spec.artifact_id}: unrecognized file magic for declared {spec.kind}"
            )
    elif detected_kind != spec.kind:
        raise VerificationError(
            f"{spec.artifact_id}: expected {spec.kind}, fetched {detected_kind}"
        )
    else:
        effective_kind = detected_kind
    members = list_container_members(effective_kind, data)
    sha256 = hashlib.sha256(data).hexdigest()
    record = {
        **asdict(spec),
        "url": _normalize_url(spec.url),
        "source_page_url": _normalize_url(spec.source_page_url),
        "sha256": sha256,
        "size_bytes": len(data),
        "http": headers,
        "magic_kind": detected_kind,
        "verification_status": verification_status,
        "verification_notes": verification_notes,
        "member_count": None if members is None else len(members),
        "members": members,
    }
    if staging_dir is not None:
        record["staged_path"] = _write_staged_copy(staging_dir, spec, data)
    return record


def _verify_event_source(
    url: str, *, timeout_seconds: float, max_bytes: int
) -> dict[str, Any]:
    data, headers = _fetch_bytes(url, timeout_seconds=timeout_seconds, max_bytes=max_bytes)
    kind = sniff_magic(data)
    if kind != "pdf":
        raise VerificationError(f"event source is not a PDF: {url}")
    return {
        "url": _normalize_url(url),
        "kind": kind,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
        "http": headers,
    }


def _artifact(
    *,
    artifact_id: str,
    year: int,
    session: str,
    subject: str,
    kind: str,
    url: str,
    source_page_url: str,
    region: str | None = None,
    set_label: str | None = None,
    accessibility_variant: str = "standard",
    notes: str | None = None,
) -> ArtifactSpec:
    return ArtifactSpec(
        artifact_id=artifact_id,
        year=year,
        session=session,
        subject=subject,
        kind=kind,
        url=url,
        source_page_url=source_page_url,
        region=region,
        set_label=set_label,
        accessibility_variant=accessibility_variant,
        notes=notes,
    )


def _build_artifact_specs() -> list[ArtifactSpec]:
    artifacts: list[ArtifactSpec] = []

    source_2007 = "https://www.cbse.gov.in/curric~1/class-xii2007/XII2007.HTM"
    for region_slug, region_label in (
        ("delhi", "DELHI"),
        ("outside", "OUTSIDE DELHI"),
        ("foreign", "FOREIGN"),
    ):
        url_region = {
            "delhi": "Delhi",
            "outside": "Outside",
            "foreign": "Foreign",
        }[region_slug]
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-2007-main-mathematics-{region_slug}",
                    year=2007,
                    session="main",
                    subject="Mathematics",
                    kind="pdf",
                    url=f"https://www.cbse.gov.in/curric~1/class-xii2007/Mathematics-{url_region}-XII-2007.pdf",
                    source_page_url=source_2007,
                    region=region_label,
                    set_label=f"SET {('I' if region_slug == 'delhi' else 'II' if region_slug == 'outside' else 'III')}",
                ),
                _artifact(
                    artifact_id=f"cbse-2007-main-physics-{region_slug}",
                    year=2007,
                    session="main",
                    subject="Physics",
                    kind="pdf",
                    url=f"https://www.cbse.gov.in/curric~1/class-xii2007/Physics-{url_region}-XII-2007.pdf",
                    source_page_url=source_2007,
                    region=region_label,
                    set_label=f"SET {('I' if region_slug == 'delhi' else 'II' if region_slug == 'outside' else 'III')}",
                ),
            ]
        )

    source_2008 = "https://www.cbse.gov.in/curric~1/ms2008.htm"
    for set_number in (1, 2, 3):
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-2008-main-mathematics-set-{set_number}",
                year=2008,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url=f"https://www.cbse.gov.in/curric~1/math-qp-xii-{set_number}-2008.pdf",
                source_page_url=source_2008,
                set_label=f"SET{set_number}",
            )
        )

    source_2009 = "https://www.cbse.gov.in/curric~1/qp2009/Science.html"
    for region, label, math_name, physics_name in (
        ("delhi", "DELHI", "Maths_1_XII_Del20091.pdf", "Phy_1_Del20091.pdf"),
        ("outside_delhi", "OUTSIDE DELHI", "Mathematics_1_XII_Out20091.pdf", "Phys_Theory_1_XII_Out20091.pdf"),
        ("foreign", "FOREIGN", "Mathematics_1_XII_Foreign20091.pdf", "Physics_1_XII_Foreign20091.pdf"),
    ):
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-2009-main-mathematics-{region}",
                year=2009,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url=f"https://www.cbse.gov.in/curric~1/qp2009/Ques_Paper/Ques_Paper_{'DELHI2009' if region == 'delhi' else 'OUTSIDE2009' if region == 'outside_delhi' else 'Foreign2009'}/{math_name}",
                source_page_url=source_2009,
                region=label,
            )
        )
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-2009-main-physics-{region}",
                year=2009,
                session="main",
                subject="Physics",
                kind="pdf",
                url=f"https://www.cbse.gov.in/curric~1/qp2009/Ques_Paper/Ques_Paper_{'DELHI2009' if region == 'delhi' else 'OUTSIDE2009' if region == 'outside_delhi' else 'Foreign2009'}/{physics_name}",
                source_page_url=source_2009,
                region=label,
            )
        )

    source_2010 = "https://www.cbse.gov.in/curric~1/qp2010/ClassXII.html"
    artifacts.extend(
        [
            _artifact(
                artifact_id="cbse-2010-main-mathematics",
                year=2010,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2010/12/MATHEMATICS.pdf",
                source_page_url=source_2010,
            ),
            _artifact(
                artifact_id="cbse-2010-main-physics",
                year=2010,
                session="main",
                subject="Physics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2010/12/PHYSICS2.pdf",
                source_page_url=source_2010,
            ),
        ]
    )

    source_2011 = "https://www.cbse.gov.in/curric~1/qp2011/ClassXII11.html"
    for set_number, math_url, physics_url in (
        (1, "https://www.cbse.gov.in/curric~1/qp2011/SOS/Mathematics.pdf", "https://www.cbse.gov.in/curric~1/qp2011/SOS/Physics(Theory).pdf"),
        (2, "https://www.cbse.gov.in/curric~1/qp2011/SOS1/Mathematics0001.pdf", "https://www.cbse.gov.in/curric~1/qp2011/SOS1/Physics(theory)0001.pdf"),
        (3, "https://www.cbse.gov.in/curric~1/qp2011/SOS2/Mathematics_XII_2011.pdf", "https://www.cbse.gov.in/curric~1/qp2011/SOS2/Physics(theory)_XII_2011.pdf"),
    ):
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-2011-main-mathematics-set-{set_number}",
                    year=2011,
                    session="main",
                    subject="Mathematics",
                    kind="pdf",
                    url=math_url,
                    source_page_url=source_2011,
                    set_label=f"SET{set_number}",
                ),
                _artifact(
                    artifact_id=f"cbse-2011-main-physics-set-{set_number}",
                    year=2011,
                    session="main",
                    subject="Physics",
                    kind="pdf",
                    url=physics_url,
                    source_page_url=source_2011,
                    set_label=f"SET{set_number}",
                ),
            ]
        )

    source_2012 = "https://www.cbse.gov.in/curric~1/qp2012/QuestionPaperX11.html"
    for set_number, math_url, physics_url in (
        (1, "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set1/MATHEMATICS_1_X11_2012.pdf", "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set1/PHYSICS_1_X11_2012.pdf"),
        (2, "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set2/MATHEMATICS_2_X11_2012.pdf", "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set2/PHYSICS_2_X11_2012.pdf"),
        (3, "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set3/MATHEMATICS_3_X11_2012.pdf", "https://www.cbse.gov.in/curric~1/qp2012/SamplePaperX11/Set3/PHYSICS_3_X11_2012.pdf"),
    ):
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-2012-main-mathematics-set-{set_number}",
                    year=2012,
                    session="main",
                    subject="Mathematics",
                    kind="pdf",
                    url=math_url,
                    source_page_url=source_2012,
                    set_label=f"SET{set_number}",
                ),
                _artifact(
                    artifact_id=f"cbse-2012-main-physics-set-{set_number}",
                    year=2012,
                    session="main",
                    subject="Physics",
                    kind="pdf",
                    url=physics_url,
                    source_page_url=source_2012,
                    set_label=f"SET{set_number}",
                ),
            ]
        )

    source_2013_main = "https://www.cbse.gov.in/curric~1/qp2013/QP_MAIN/QPX11.html"
    artifacts.extend(
        [
            _artifact(
                artifact_id="cbse-2013-main-mathematics-set-1",
                year=2013,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_MAIN/QP_X11/Math_Code_No_1.pdf",
                source_page_url=source_2013_main,
                set_label="SET1",
            ),
            _artifact(
                artifact_id="cbse-2013-main-physics-set-1",
                year=2013,
                session="main",
                subject="Physics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_MAIN/QP_X11/physics_1.pdf",
                source_page_url=source_2013_main,
                set_label="SET1",
            ),
        ]
    )

    source_2013_comp = "https://www.cbse.gov.in/curric~1/qp2013/QP_COMPT/QP_XII.htm"
    artifacts.extend(
        [
            _artifact(
                artifact_id="cbse-2013-compartment-mathematics-standard",
                year=2013,
                session="compartment",
                subject="Mathematics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_COMPT/QP_Comp_XII/Math_65_10001.pdf",
                source_page_url=source_2013_comp,
            ),
            _artifact(
                artifact_id="cbse-2013-compartment-mathematics-blind",
                year=2013,
                session="compartment",
                subject="Mathematics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_COMPT/QP_Comp_XII/Mathmatics_B_650001.pdf",
                source_page_url=source_2013_comp,
                accessibility_variant="blind",
            ),
            _artifact(
                artifact_id="cbse-2013-compartment-physics-standard",
                year=2013,
                session="compartment",
                subject="Physics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_COMPT/QP_Comp_XII/Physics_55_10001.pdf",
                source_page_url=source_2013_comp,
            ),
            _artifact(
                artifact_id="cbse-2013-compartment-physics-blind",
                year=2013,
                session="compartment",
                subject="Physics",
                kind="pdf",
                url="https://www.cbse.gov.in/curric~1/qp2013/QP_COMPT/QP_Comp_XII/Physics_55(B)0001.pdf",
                source_page_url=source_2013_comp,
                accessibility_variant="blind",
            ),
        ]
    )

    source_2015_main = "https://www.cbse.gov.in/curric~1/qpms2015/Rev.htm"
    base_2015 = (
        "https://www.cbse.gov.in/curric~1/qpms2015/"
        "Question_Papers_Class_X_XII_Main_Exam_2015/"
        "CLASS XII - 2015 - MAIN EXAMS"
    )
    outside_2015 = f"{base_2015}/CLASS XII - OUTSIDE - 2015 - MAIN EXAMS"
    delhi_2015 = f"{base_2015}/CLASS XII - LOCAL - 2015 - MAIN EXAMS"
    foreign_2015 = f"{base_2015}/CLASS XII - FOREIGN - 2015 - MAIN EXAMS"
    math_regions = (
        ("ajmer", "65-{set_number}A Mathematics.pdf"),
        ("allahabad_uttarakhand", "65-{set_number}-RU Mathematics.pdf"),
        ("bhubaneshwar", "65-{set_number}-B Mathematics.pdf"),
        ("guwahati", "65-{set_number}-G Mathematics.pdf"),
        ("chandigarh_panchkula", "65-{set_number}-C Mathematics.pdf"),
        ("patna", "65-{set_number}-P Mathematics.pdf"),
        ("thiruvananthapuram_chennai", "65-{set_number}-MT Mathematics.pdf"),
    )
    for region_slug, filename_pattern in math_regions:
        for set_number in (1, 2, 3):
            artifacts.append(
                _artifact(
                    artifact_id=f"cbse-2015-main-mathematics-{region_slug}-set-{set_number}",
                    year=2015,
                    session="main",
                    subject="Mathematics",
                    kind="pdf",
                    url=f"{outside_2015}/{filename_pattern.format(set_number=set_number)}",
                    source_page_url=source_2015_main,
                    region="OUTSIDE DELHI",
                    set_label=f"SET{set_number}",
                )
            )
    artifacts.extend(
        [
            _artifact(
                artifact_id="cbse-2015-main-mathematics-bhubaneshwar-set-4",
                year=2015,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url=f"{outside_2015}/65-B Mathematics.pdf",
                source_page_url=source_2015_main,
                region="OUTSIDE DELHI",
                set_label="SET4",
                notes="Additional Bhubaneswar-region Mathematics paper on the official page.",
            ),
        ]
    )
    for set_number in (1, 2, 3):
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-2015-main-mathematics-delhi-set-{set_number}",
                year=2015,
                session="main",
                subject="Mathematics",
                kind="pdf",
                url=f"{delhi_2015}/65-{set_number}-D Mathematics.pdf",
                source_page_url=source_2015_main,
                region="DELHI",
                set_label=f"SET{set_number}",
            )
        )
    artifacts.append(
        _artifact(
            artifact_id="cbse-2015-main-mathematics-foreign-set-1",
            year=2015,
            session="main",
            subject="Mathematics",
            kind="pdf",
            url=f"{foreign_2015}/65-2-1-f MATHEMATICS.pdf",
            source_page_url=source_2015_main,
            region="FOREIGN",
            set_label="SET1",
            notes="Only one foreign Mathematics paper URL was present on the primary-domain page.",
        )
    )

    physics_regions = (
        ("ajmer", "55-{set_number}A PHYSICS.pdf"),
        ("bhubaneshwar", "55-{set_number}-B PHYSICS.pdf"),
        ("uttarakhand", "55-{set_number}RU PHYSICS.pdf"),
        ("guwahati", "55-{set_number}-G PHYSICS.pdf"),
        ("chandigarh", "55-{set_number}-C PHYSICS.pdf"),
        ("patna", "55-{set_number}-P PHYSICS.pdf"),
        ("thiruvananthapuram_chennai", "55-{set_number}-MT PHYSICS.pdf"),
    )
    for region_slug, filename_pattern in physics_regions:
        for set_number in (1, 2, 3):
            artifacts.append(
                _artifact(
                    artifact_id=f"cbse-2015-main-physics-{region_slug}-set-{set_number}",
                    year=2015,
                    session="main",
                    subject="Physics",
                    kind="pdf",
                    url=f"{outside_2015}/{filename_pattern.format(set_number=set_number)}",
                    source_page_url=source_2015_main,
                    region="OUTSIDE DELHI",
                    set_label=f"SET{set_number}",
                )
            )
    for set_number in (1, 2, 3):
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-2015-main-physics-delhi-set-{set_number}",
                year=2015,
                session="main",
                subject="Physics",
                kind="pdf",
                url=f"{delhi_2015}/55-1-{set_number}-D PHYSICS.pdf",
                source_page_url=source_2015_main,
                region="DELHI",
                set_label=f"SET{set_number}",
            )
        )

    source_2015_comp = "https://www.cbse.gov.in/curric~1/qpms2015/comptt/Rev12_Comp.htm"
    local_comp_2015 = (
        "https://www.cbse.gov.in/curric~1/qpms2015/comptt/"
        "Questions_Paper_Comp_2015/CLASS XII - LOCAL-C"
    )
    outside_comp_2015 = (
        "https://www.cbse.gov.in/curric~1/qpms2015/comptt/"
        "Questions_Paper_Comp_2015/CLASS XII - OUTSIDE-C"
    )
    for set_number in (1, 2, 3):
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-2015-compartment-mathematics-delhi-set-{set_number}",
                    year=2015,
                    session="compartment",
                    subject="Mathematics",
                    kind="pdf",
                    url=f"{local_comp_2015}/65-1-{set_number} _Mathematics_SSO-1-C.pdf",
                    source_page_url=source_2015_comp,
                    region="DELHI",
                    set_label=f"SET{set_number}",
                ),
                _artifact(
                    artifact_id=f"cbse-2015-compartment-mathematics-outside-set-{set_number}",
                    year=2015,
                    session="compartment",
                    subject="Mathematics",
                    kind="pdf",
                    url=f"{outside_comp_2015}/65-{set_number} Mathematics_SSO-C.pdf",
                    source_page_url=source_2015_comp,
                    region="OUTSIDE DELHI",
                    set_label=f"SET{set_number}",
                ),
                _artifact(
                    artifact_id=f"cbse-2015-compartment-physics-delhi-set-{set_number}",
                    year=2015,
                    session="compartment",
                    subject="Physics",
                    kind="pdf",
                    url=f"{local_comp_2015}/55-1-{set_number}_Physics (Theory)_SSO-1-C.pdf",
                    source_page_url=source_2015_comp,
                    region="DELHI",
                    set_label=f"SET{set_number}",
                ),
                _artifact(
                    artifact_id=f"cbse-2015-compartment-physics-outside-set-{set_number}",
                    year=2015,
                    session="compartment",
                    subject="Physics",
                    kind="pdf",
                    url=f"{outside_comp_2015}/55-{set_number}_Physics (Theory)_SSO-C.pdf",
                    source_page_url=source_2015_comp,
                    region="OUTSIDE DELHI",
                    set_label=f"SET{set_number}",
                ),
            ]
        )

    for year, session, source_page_url, path_prefix, scheme, kind in (
        (2016, "main", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/outside/qp-12-outside.html", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/outside", "ALL INDIA SCHEME", "zip"),
        (2016, "main", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/delhi/qp-12-delhi.html", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/delhi", "DELHI SCHEME", "zip"),
        (2016, "main", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/foreign/qp-12-foreign.html", "https://www.cbse.gov.in/curric~1/qpms2016/qp_12/foreign", "FOREIGN", "zip"),
        (2017, "main", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/outside/qp-12-outside.html", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/outside", "ALL INDIA SCHEME", "rar"),
        (2017, "main", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/delhi/qp-12-delhi.html", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/delhi", "DELHI SCHEME", "rar"),
        (2017, "main", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/foreign/qp-12-foreign.html", "https://www.cbse.gov.in/curric~1/qpms2017/qp1217/foreign", "FOREIGN", "rar"),
    ):
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-{year}-{session}-mathematics-{scheme.lower().replace(' ', '-').replace('/', '-')}",
                year=year,
                session=session,
                subject="Mathematics",
                kind=kind,
                url=f"{path_prefix}/{'maths.zip' if year == 2016 else 'maths.rar'}",
                source_page_url=source_page_url,
                region=scheme,
            )
        )
        artifacts.append(
            _artifact(
                artifact_id=f"cbse-{year}-{session}-physics-{scheme.lower().replace(' ', '-').replace('/', '-')}",
                year=year,
                session=session,
                subject="Physics",
                kind="zip" if year == 2017 and scheme == "DELHI SCHEME" else kind,
                url=(
                    f"{path_prefix}/physics.zip"
                    if year == 2016
                    else f"{path_prefix}/{'phy.zip' if scheme == 'DELHI SCHEME' else 'phy.rar'}"
                ),
                source_page_url=source_page_url,
                region=scheme,
                notes="2017 official archives mix ZIP and RAR containers across schemes." if year == 2017 else None,
            )
        )

    for region_slug, source_page_url, path_prefix in (
        ("all-india-scheme", "https://www.cbse.gov.in/curric~1/qpms2017/comptt/qp1217/outside/qp-12-outside.html", "https://www.cbse.gov.in/curric~1/qpms2017/comptt/qp1217/outside"),
        ("delhi-scheme", "https://www.cbse.gov.in/curric~1/qpms2017/comptt/qp1217/delhi/qp-12-delhi.html", "https://www.cbse.gov.in/curric~1/qpms2017/comptt/qp1217/delhi"),
    ):
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-2017-compartment-mathematics-{region_slug}",
                    year=2017,
                    session="compartment",
                    subject="Mathematics",
                    kind="zip",
                    url=f"{path_prefix}/Maths.zip",
                    source_page_url=source_page_url,
                    region=region_slug.replace("-", " ").upper(),
                ),
                _artifact(
                    artifact_id=f"cbse-2017-compartment-physics-{region_slug}",
                    year=2017,
                    session="compartment",
                    subject="Physics",
                    kind="zip",
                    url=f"{path_prefix}/Physics.zip",
                    source_page_url=source_page_url,
                    region=region_slug.replace("-", " ").upper(),
                ),
            ]
        )

    for session, source_page_url, path_prefix in (
        ("main", "https://www.cbse.gov.in/curric~1/qpms2018/qp12-2018.html", "https://www.cbse.gov.in/curric~1/qpms2018/qp_12"),
        ("compartment", "https://www.cbse.gov.in/curric~1/qpms2018/comptt/qp12-2018.html", "https://www.cbse.gov.in/curric~1/qpms2018/comptt/qp_12"),
        ("main", "https://www.cbse.gov.in/curric~1/qpms2020/qp12-2020.html", "https://www.cbse.gov.in/curric~1/qpms2020/qp_12"),
        ("compartment", "https://www.cbse.gov.in/curric~1/qpms2020/qpcompt12-2020.html", "https://www.cbse.gov.in/curric~1/qpms2020/qpcompt12"),
    ):
        year = 2018 if "2018" in source_page_url else 2020
        artifacts.extend(
            [
                _artifact(
                    artifact_id=f"cbse-{year}-{session}-mathematics-archive",
                    year=year,
                    session=session,
                    subject="Mathematics",
                    kind="zip",
                    url=f"{path_prefix}/{'maths.zip' if year == 2018 else 'Mathematics.zip'}",
                    source_page_url=source_page_url,
                ),
                _artifact(
                    artifact_id=f"cbse-{year}-{session}-physics-archive",
                    year=year,
                    session=session,
                    subject="Physics",
                    kind="zip",
                    url=f"{path_prefix}/physics.zip" if year == 2018 else f"{path_prefix}/Physics.zip",
                    source_page_url=source_page_url,
                ),
            ]
        )

    return artifacts


def _build_gap_specs() -> list[GapSpec]:
    return [
        GapSpec(
            year=2008,
            scope="main physics",
            status="subject_missing_on_official_page",
            notes="The official 2008 page exposes three Mathematics set PDFs but no Class XII Physics question-paper URL.",
        ),
        GapSpec(
            year=2014,
            scope="main mathematics + physics",
            status="no_primary_domain_artifact_located",
            notes="No primary-domain cbse.gov.in Mathematics/Physics question-paper artifact was located for 2014.",
            probes=(
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2014/qpms2014.htm",
                    note="Expected 2014 landing-page pattern returns 404.",
                ),
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2014/qp-12-2014.html",
                    note="Expected Class XII 2014 page pattern returns 404.",
                ),
            ),
        ),
        GapSpec(
            year=2016,
            scope="compartment mathematics + physics",
            status="question_paper_page_not_located",
            notes="CBSE hosts 2016 compartment marking-scheme pages, but no primary-domain Mathematics/Physics question-paper artifact page was found.",
            probes=(
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2016c/qp-12-2016.html",
                    note="Plausible 2016 compartment question-paper landing page returns 404.",
                ),
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2016c/qp12-2016.html",
                    note="Alternate 2016 compartment landing-page pattern returns 404.",
                ),
            ),
        ),
        GapSpec(
            year=2019,
            scope="main + compartment mathematics + physics",
            status="no_primary_domain_artifact_located",
            notes="Neither the main nor compartment 2019 Mathematics/Physics archive could be located on cbse.gov.in.",
            probes=(
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2019/qp12-2019.html",
                    note="Expected 2019 landing-page pattern returns 404.",
                ),
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2019/qp-12-2019.html",
                    note="Alternate 2019 Class XII landing-page pattern returns 404.",
                ),
                ProbeSpec(
                    url="https://www.cbse.gov.in/curric~1/qpms2019/comptt/qp12-2019.html",
                    note="Expected 2019 compartment landing-page pattern returns 404.",
                ),
            ),
        ),
    ]


def _build_event_specs() -> list[EventSpec]:
    return [
        EventSpec(
            event_id="cbse-2021-class-xii-regular-exam-cancelled",
            year=2021,
            title="CBSE Class XII regular board examination cancelled",
            status="non_paper_event",
            notes="The 2021 annual board examination was cancelled and replaced with tabulation policy; there is no genuine 2021 regular main Mathematics or Physics paper.",
            sources=(
                "https://www.cbse.gov.in/cbsenew/documents/notification_12.pdf",
                "https://www.cbse.gov.in/cbsenew/documents/Tabulation Policy Class XII 2021.pdf",
            ),
        )
    ]


def _summarize_artifacts(artifacts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    by_year: dict[str, int] = {}
    by_year_subject: dict[str, dict[str, int]] = {}
    by_session: dict[str, int] = {}
    for artifact in artifacts:
        year_key = str(artifact["year"])
        by_year[year_key] = by_year.get(year_key, 0) + 1
        by_session[artifact["session"]] = by_session.get(artifact["session"], 0) + 1
        subject_bucket = by_year_subject.setdefault(year_key, {})
        subject_bucket[artifact["subject"]] = subject_bucket.get(artifact["subject"], 0) + 1
    return {
        "verified_artifacts": sum(by_year.values()),
        "by_year": dict(sorted(by_year.items())),
        "by_year_subject": {
            year: dict(sorted(subjects.items()))
            for year, subjects in sorted(by_year_subject.items())
        },
        "by_session": dict(sorted(by_session.items())),
    }


def build_report(
    *,
    timeout_seconds: float,
    max_bytes: int,
    staging_dir: Path | None,
) -> dict[str, Any]:
    artifact_specs = _build_artifact_specs()
    gap_specs = _build_gap_specs()
    event_specs = _build_event_specs()

    verified_artifacts = [
        _verify_artifact(
            spec,
            timeout_seconds=timeout_seconds,
            max_bytes=max_bytes,
            staging_dir=staging_dir,
        )
        for spec in artifact_specs
    ]
    gap_records = []
    for gap in gap_specs:
        gap_records.append(
            {
                **asdict(gap),
                "probes": [
                    {
                        **asdict(probe),
                        "result": _probe_url(probe.url, timeout_seconds=timeout_seconds),
                    }
                    for probe in gap.probes
                ],
            }
        )
    event_records = []
    for event in event_specs:
        event_records.append(
            {
                **asdict(event),
                "sources": [
                    _verify_event_source(
                        source_url,
                        timeout_seconds=timeout_seconds,
                        max_bytes=max_bytes,
                    )
                    for source_url in event.sources
                ],
            }
        )

    summary = _summarize_artifacts(verified_artifacts)
    unresolved_years = sorted({gap.year for gap in gap_specs})
    covered_years = sorted({spec.year for spec in artifact_specs})
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "as_of": AS_OF_DATE,
        "generated_at": _utc_now(),
        "scope": {
            "publisher": "Central Board of Secondary Education",
            "exam": "CBSE Class XII Board Examination",
            "subjects": ["Mathematics", "Physics"],
            "years": {"from": 2007, "through": 2020},
            "non_paper_event_years": [2021],
            "host_constraint": "primary cbse.gov.in only",
        },
        "summary": {
            **summary,
            "covered_years": covered_years,
            "unresolved_years": unresolved_years,
        },
        "artifacts": verified_artifacts,
        "gaps": gap_records,
        "non_paper_events": event_records,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Verify and report official CBSE Class XII Math/Physics legacy paper URLs."
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--staging-dir",
        type=Path,
        help="optional local directory for verified PDFs/ZIPs/RARs; nothing under it is committed",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES_DEFAULT)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.max_bytes <= 0:
        parser.error("--max-bytes must be positive")

    report = build_report(
        timeout_seconds=args.timeout,
        max_bytes=args.max_bytes,
        staging_dir=args.staging_dir,
    )
    _atomic_json(args.report, report)
    print(json.dumps({"report": str(args.report), "verified_artifacts": report["summary"]["verified_artifacts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
