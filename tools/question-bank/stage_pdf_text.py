#!/usr/bin/env python3
"""Create page-delimited native text or OCR for verified manifest PDFs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from question_bank.models import load_documents, validate_document
from question_bank.pipeline import PipelineError, normalize_cbse_symbol_text, pdf_to_text

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
TESSDATA_FAST_ENG_URL = (
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata"
)


class StageError(RuntimeError):
    """Raised when exact page mapping cannot be preserved."""


class FatalStageError(StageError):
    """Raised when staging must abort without committing partial output."""


_ASCII_TOKEN_RE = re.compile(r"[A-Za-z]+(?:['\u2019][A-Za-z]+)?")
_NUMERIC_TOKEN_RE = re.compile(r"(?<![A-Za-z])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?![A-Za-z])")
_QUESTION_HEADER_RE = re.compile(
    r"^\s*(?:"
    r"Q(?:uestion)?\.?\s*(?P<prefixed>\d{1,3}(?:\s*\([A-Za-z]\))?)\s*[.):-]?"
    r"|"
    r"(?P<bare>\d{1,3}(?:\s*\([A-Za-z]\))?)\s*[.):]"
    r")",
    re.IGNORECASE,
)
_SECTION_RE = re.compile(
    r"^\s*SECTION\s*(?:[-:\u2013\u2014]\s*)?([A-E]|\d+|[IVXLCDM]+)\b",
    re.IGNORECASE,
)
_OPTION_RE = re.compile(r"^\s*(?:\(([A-D])\)|([A-D])[.)])\s+", re.IGNORECASE)
_QUESTION_STEM_RE = re.compile(
    r"^\s*Question\s+Stem\s+for\s+Question\s+Nos?\.?\s*",
    re.IGNORECASE,
)
_PARAGRAPH_RE = re.compile(r"^\s*Paragraph\s+for\s+Questions?\b", re.IGNORECASE)
_ANSWER_RE = re.compile(r"^\s*ANSWER\s*:", re.IGNORECASE)
_SECTION_INTRO_RE = re.compile(r"^\s*This section contains\b", re.IGNORECASE)
_MATH_SYMBOL_RE = re.compile(
    r"[=+*/^\u2212\u00d7\u00f7\u221a\u221e\u2264\u2265\u2260\u2248\u2202\u2206\u222b\u2211\u2192\u2190]"
)
_MOJIBAKE_MARKERS = frozenset("\u00c2\u00c3\u00e2\u00f0")
_NTA_QUESTION_HEADER_RE = re.compile(
    r"(?:\bQuestion\s+Number\b|(?:^|(?<=\f))\s*Q)\s*[.:]?\s*(?P<number>\d{1,3})\b",
    re.IGNORECASE | re.MULTILINE,
)
_NTA_METADATA_LINE_RE = re.compile(
    r"^\s*(?:"
    r"Question\s+(?:Paper\s+Name|Number|Mandatory)"
    r"|Question\s+Id"
    r"|Question\s+Type"
    r"|Question\s+Image"
    r"|Option\s+Shuffling"
    r"|Display\s+Question\s+Number"
    r"|Single\s+Line\s+Question\s+Option"
    r"|Option\s+Orientation"
    r"|(?:Yes\s+)?Is\s+Question\s+Mandatory"
    r"|Number(?=\s*:\s*(?:Yes|No)\s+(?:Is\s+)?Question\s+Mandatory\s*:)"
    r"|Correct\s+Marks"
    r"|Wrong\s+Marks"
    r"|Options?"
    r"|Group\s+(?:Number|Id|Maximum\s+Duration|Minimum\s+Duration|Marks)"
    r"|Section\s+(?:Id|Number|type|Marks)"
    r"|Sub-Section\s+(?:Number|Id)"
    r"|Mandatory\s+or\s+Optional"
    r"|Number\s+of\s+Questions(?:\s+to\s+be\s+attempted)?"
    r"|Instruction\s+Time"
    r"|(?:Maximum|Minimum)\s+Instruction\s+Time"
    r"|Question\s+Shuffling\s+Allowed"
    r"|Response\s+(?:Time|Type)"
    r"|Think\s+Time"
    r"|Evaluation\s+Required\s+For\s+SA"
    r"|Show\s+Word\s+Count"
    r"|Answers\s+Type"
    r"|Text\s+Areas"
    r"|Possible\s+Answers"
    r"|Is\s+Section\s+Default\?"
    r"|Enable\s+Mark\s+as\s+Answered\s+Mark\s+for\s+Review\s+and"
    r"|Clear\s+Response"
    r"|Show\s+Attended\s+Group\?"
    r"|Edit\s+Attended\s+Group\?"
    r"|Break\s+time"
    r"|Creation\s+Date"
    r"|Duration"
    r"|Total\s+Marks"
    r"|Display\s+Marks"
    r"|Subject\s+Name"
    r")\s*:",
    re.IGNORECASE,
)
_NTA_OPTION_ID_RE = re.compile(r"^\s*\d{6,12}[.)]?\s*$")
_NTA_METADATA_VALUE_RE = re.compile(r"^\s*(?:Yes|No|Online|Mandatory|Optional)\s*$", re.IGNORECASE)
_NTA_SUBJECT_SECTION_RE = re.compile(
    r"^\s*(?:Mathematics|Physics|Chemistry)\s+Section\s+[A-Z0-9]+\s*$",
    re.IGNORECASE,
)
_NTA_VIEWER_CHROME_RE = re.compile(
    r"^\s*(?:"
    r"https?://g\d+\.tcsion\.com/CAE/pdf-preview(?:\s+\d+/\d+)?"
    r"|\d{1,2}/\d{1,2}/\d{2,4},\s+\d{1,2}:\d{2}\s*(?:AM|PM)"
    r"\s+Online\s+Question\s+Paper\s+PDF\s+Preview"
    r"|Online\s+Question\s+Paper\s+PDF\s+Preview"
    r")\s*$",
    re.IGNORECASE,
)
_NTA_IMAGE_PLACEHOLDER_RE = re.compile(
    r"^\s*(?:question\s+image|image|figure|diagram|graph|chart)(?:\s*[:#-]\s*.*)?\s*$",
    re.IGNORECASE,
)
_NTA_IMAGE_FILENAME_RE = re.compile(
    r"^\s*[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg|tiff?)\s*$",
    re.IGNORECASE,
)
_NTA_LEGACY_METADATA_LINE_RE = re.compile(
    r"^\s*(?:(?:Topic\s+Name|Item\s*Code)\s*:\s*.*|Question\s*:\s*)$",
    re.IGNORECASE,
)


def text_pages(text: str) -> list[str]:
    pages = text.split("\f")
    # A terminal form feed creates one synthetic empty element. Remove only
    # that element so a genuine blank final PDF page keeps its page number.
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def needs_ocr(text: str, expected_pages: int | None, minimum_characters: int) -> bool:
    pages = text_pages(text)
    if expected_pages is not None and len(pages) != expected_pages:
        return True
    return len(text.strip()) < minimum_characters


def _nta_question_blocks(text: str) -> list[str]:
    matches = list(_NTA_QUESTION_HEADER_RE.finditer(text))
    return [
        text[matches[index].start() : matches[index + 1].start() if index + 1 < len(matches) else len(text)]
        for index in range(len(matches))
    ]


def _is_nta_substantive_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _NTA_METADATA_LINE_RE.match(stripped) or _NTA_LEGACY_METADATA_LINE_RE.match(stripped):
        return False
    if _NTA_SUBJECT_SECTION_RE.match(stripped) or _NTA_VIEWER_CHROME_RE.match(stripped):
        return False
    if _NTA_OPTION_ID_RE.match(stripped) or _NTA_METADATA_VALUE_RE.match(stripped):
        return False
    if _NTA_IMAGE_PLACEHOLDER_RE.match(stripped) or _NTA_IMAGE_FILENAME_RE.match(stripped):
        return False
    return any(character.isalpha() for character in stripped) and len(stripped) >= 12


def _is_metadata_heavy_nta_export(text: str) -> bool:
    question_matches = list(_NTA_QUESTION_HEADER_RE.finditer(text))
    question_headers = len(question_matches)
    if question_headers < 10:
        return False
    question_numbers = {
        int(match.group("number")) for match in question_matches
    }
    maximum_question_number = max(question_numbers)
    if (
        maximum_question_number in {75, 90}
        and len(question_numbers) < maximum_question_number
    ):
        return True
    metadata_only_blocks = 0
    metadata_lines = 0
    option_id_lines = 0
    substantive_blocks = 0
    legacy_metadata_only_blocks = 0
    for block in _nta_question_blocks(text):
        block_metadata_lines = 0
        block_option_id_lines = 0
        block_substantive_lines = 0
        block_legacy_metadata_lines = 0
        for raw_line in block.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if _NTA_METADATA_LINE_RE.match(line):
                metadata_lines += 1
                block_metadata_lines += 1
                continue
            if _NTA_LEGACY_METADATA_LINE_RE.match(line):
                metadata_lines += 1
                block_metadata_lines += 1
                block_legacy_metadata_lines += 1
                continue
            if _NTA_SUBJECT_SECTION_RE.match(line) or _NTA_VIEWER_CHROME_RE.match(line):
                metadata_lines += 1
                block_metadata_lines += 1
                continue
            if _NTA_OPTION_ID_RE.match(line) or _NTA_METADATA_VALUE_RE.match(line):
                option_id_lines += 1
                block_option_id_lines += 1
                continue
            if _is_nta_substantive_line(line):
                block_substantive_lines += 1
        if block_substantive_lines:
            substantive_blocks += 1
        elif block_metadata_lines >= 2 or block_option_id_lines >= 4:
            metadata_only_blocks += 1
            if block_legacy_metadata_lines >= 2:
                legacy_metadata_only_blocks += 1
    modern_metadata_only = (
        metadata_lines >= question_headers * 2
        and option_id_lines >= question_headers
        and metadata_only_blocks >= max(10, (question_headers * 3 + 4) // 5)
        and substantive_blocks * 2 <= question_headers
    )
    legacy_metadata_only = (
        legacy_metadata_only_blocks >= max(10, (question_headers * 3 + 4) // 5)
        and substantive_blocks * 2 <= question_headers
    )
    return modern_metadata_only or legacy_metadata_only


def _nta_export_quality(text: str) -> dict[str, int]:
    matches = list(_NTA_QUESTION_HEADER_RE.finditer(text))
    question_numbers: set[int] = set()
    substantive_numbers: set[int] = set()
    for index, match in enumerate(matches):
        number = int(match.group("number"))
        question_numbers.add(number)
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start() : end]
        if any(_is_nta_substantive_line(line) for line in block.splitlines()):
            substantive_numbers.add(number)
    return {
        "unique_question_numbers": len(question_numbers),
        "substantive_question_numbers": len(substantive_numbers),
    }


def _validate_nta_ocr_improvement(native_text: str, ocr_text: str) -> None:
    native_quality = _nta_export_quality(native_text)
    ocr_quality = _nta_export_quality(ocr_text)
    native_coverage = native_quality["unique_question_numbers"]
    ocr_coverage = ocr_quality["unique_question_numbers"]
    minimum_unique = (native_coverage * 90 + 99) // 100
    if ocr_coverage < minimum_unique:
        raise StageError(
            "NTA OCR lost question-number coverage: "
            f"{ocr_coverage} < {native_coverage}"
        )
    minimum_substantive = (ocr_coverage * 95 + 99) // 100
    ocr_substantive = ocr_quality["substantive_question_numbers"]
    if ocr_substantive < minimum_substantive:
        raise StageError(
            "NTA OCR substantive question coverage is insufficient: "
            f"{ocr_substantive} < {minimum_substantive}"
        )
    if ocr_substantive <= native_quality["substantive_question_numbers"]:
        raise StageError("NTA OCR did not improve substantive question coverage")


def _is_mojibake_or_c1(character: str) -> bool:
    return character in _MOJIBAKE_MARKERS or 0x80 <= ord(character) <= 0x9F


def _is_private_use_or_replacement(character: str) -> bool:
    return character == "\ufffd" or unicodedata.category(character) in {"Co", "Cs"}


def _has_disallowed_corruption(text: str, *, document_id: str | None = None) -> bool:
    inspected_text = (
        normalize_cbse_symbol_text(text, document_id=document_id)
        if document_id is not None
        else text
    )
    visible = [character for character in inspected_text if not character.isspace()]
    if not visible:
        return False
    if any(_is_private_use_or_replacement(character) for character in visible):
        return True
    suspicious = sum(_is_mojibake_or_c1(character) for character in visible)
    return suspicious >= 3 and suspicious / len(visible) >= 0.05


def _ascii_unique_tokens(text: str) -> set[str]:
    return {token.casefold() for token in _ASCII_TOKEN_RE.findall(text)}


def _numeric_tokens(text: str) -> set[str]:
    return set(_NUMERIC_TOKEN_RE.findall(text))


def _structural_markers(text: str) -> list[str]:
    markers: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _QUESTION_STEM_RE.match(line):
            markers.append("question-stem-heading")
            continue
        if _PARAGRAPH_RE.match(line):
            markers.append("paragraph-heading")
            continue
        if _SECTION_INTRO_RE.match(line):
            markers.append("section-intro")
            continue
        section_match = _SECTION_RE.match(line)
        if section_match is not None:
            markers.append(f"section:{section_match.group(1).upper()}")
            continue
        question_match = _QUESTION_HEADER_RE.match(line)
        if question_match is not None:
            question_number = question_match.group("prefixed") or question_match.group(
                "bare"
            )
            markers.append(
                f"question:{re.sub(r'\\s+', '', question_number).upper()}"
            )
            continue
        option_match = _OPTION_RE.match(line)
        if option_match is not None:
            option = option_match.group(1) or option_match.group(2)
            markers.append(f"option:{option.upper()}")
            continue
        if _ANSWER_RE.match(line):
            markers.append("answer")
    return markers


def _token_recall(expected: set[str], observed: set[str]) -> float:
    if not expected:
        return 1.0
    return len(expected & observed) / len(expected)


def _is_math_heavy(text: str) -> bool:
    visible = [character for character in text if not character.isspace()]
    if not visible:
        return False
    numeric_tokens = _numeric_tokens(text)
    ascii_tokens = _ascii_unique_tokens(text)
    matrix_like_lines = 0
    for line in text.splitlines():
        numeric_count = len(_NUMERIC_TOKEN_RE.findall(line))
        if numeric_count >= 3 and any(
            marker in line for marker in ("[", "]", "|", "=", "→", "^")
        ):
            matrix_like_lines += 1
    math_density = (
        len(numeric_tokens) + len(_MATH_SYMBOL_RE.findall(text))
    ) / len(visible)
    return (
        math_density >= 0.35
        or (len(numeric_tokens) >= 12 and len(numeric_tokens) >= len(ascii_tokens))
        or matrix_like_lines >= 2
    )


def _evaluate_ocr_page(native_text: str, ocr_text: str) -> tuple[bool, dict[str, Any]]:
    details = {
        "structural_markers_match": _structural_markers(native_text)
        == _structural_markers(ocr_text),
        "ascii_unique_token_recall": _token_recall(
            _ascii_unique_tokens(native_text), _ascii_unique_tokens(ocr_text)
        ),
        "math_heavy": _is_math_heavy(native_text),
        "numeric_token_recall": _token_recall(
            _numeric_tokens(native_text), _numeric_tokens(ocr_text)
        ),
        "ocr_has_disallowed_corruption": _has_disallowed_corruption(ocr_text),
    }
    minimum_ascii_recall = 0.995 if details["math_heavy"] else 0.985
    accepted = (
        not details["ocr_has_disallowed_corruption"]
        and details["structural_markers_match"]
        and details["ascii_unique_token_recall"] >= minimum_ascii_recall
        and (
            not details["math_heavy"]
            or details["numeric_token_recall"] == 1.0
        )
    )
    return accepted, details


def _tessdata_metadata(tessdata_dir: Path | None) -> dict[str, str] | None:
    if tessdata_dir is None:
        return None
    traineddata = tessdata_dir / "eng.traineddata"
    metadata = {"path": str(tessdata_dir), "source_url": TESSDATA_FAST_ENG_URL}
    if traineddata.is_file():
        digest = hashlib.sha256()
        with traineddata.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        metadata["sha256"] = digest.hexdigest()
    return metadata


def _resolve_tessdata_dir(tessdata_dir: Path | None) -> Path | None:
    if tessdata_dir is not None:
        return tessdata_dir
    system_dir = Path("/usr/share/tessdata")
    if (system_dir / "eng.traineddata").is_file():
        return system_dir
    cache_dir = DATA_ROOT / ".cache" / "tessdata-fast"
    traineddata_path = cache_dir / "eng.traineddata"
    if not traineddata_path.is_file():
        cache_dir.mkdir(parents=True, exist_ok=True)
        with urlopen(TESSDATA_FAST_ENG_URL) as response:
            traineddata_path.write_bytes(response.read())
    return cache_dir


def _atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def _prepare_text_temp(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        return temporary_path
    except BaseException:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        raise


def _prepare_jsonl_temp(path: Path, records: list[dict[str, Any]]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            for record in records:
                output.write(
                    json.dumps(
                        record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    )
                )
                output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        return temporary_path
    except BaseException:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
        raise


def _restore_text_update(update: dict[str, Any]) -> None:
    path = update["path"]
    if update["original_exists"]:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".restore", dir=path.parent
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(update["original_bytes"])
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_path, path)
        except BaseException:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
            raise
    elif path.exists():
        path.unlink()


def _promote_staged_outputs(
    text_updates: list[dict[str, Any]],
    manifest_path: Path,
    manifest_temp_path: Path,
) -> None:
    promoted_updates: list[dict[str, Any]] = []
    try:
        for update in text_updates:
            os.replace(update["temp_path"], update["path"])
            promoted_updates.append(update)
        os.replace(manifest_temp_path, manifest_path)
    except BaseException as exc:
        rollback_errors: list[str] = []
        for update in reversed(promoted_updates):
            try:
                _restore_text_update(update)
            except OSError as rollback_exc:
                rollback_errors.append(f"{update['path']}: {rollback_exc}")
        if rollback_errors:
            raise FatalStageError(
                "failed to restore staged outputs after promotion error: "
                + "; ".join(rollback_errors)
            ) from exc
        raise FatalStageError("failed to promote staged outputs atomically") from exc
    finally:
        for update in text_updates:
            temporary_path = update["temp_path"]
            if temporary_path.exists():
                temporary_path.unlink()
        if manifest_temp_path.exists():
            manifest_temp_path.unlink()


def _ocr_page(
    image_path: Path,
    *,
    tesseract: str,
    tessdata_dir: Path | None,
    allow_empty: bool = False,
) -> str:
    command = [tesseract, str(image_path), "stdout", "-l", "eng", "--psm", "6"]
    if tessdata_dir is not None:
        command.extend(["--tessdata-dir", str(tessdata_dir)])
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        raise StageError(
            f"tesseract failed for {image_path.name}: "
            f"{completed.stderr.strip() or completed.returncode}"
        )
    text = completed.stdout.strip()
    if not text:
        retry = list(command)
        if "--psm" in retry:
            psm_index = retry.index("--psm")
            retry[psm_index + 1] = "4"
        else:
            retry.extend(["--psm", "4"])
        completed = subprocess.run(
            retry,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            raise StageError(
                f"tesseract failed for {image_path.name}: "
                f"{completed.stderr.strip() or completed.returncode}"
            )
        text = completed.stdout.strip()
    if not text and not allow_empty:
        raise StageError(f"tesseract produced no text for {image_path.name}")
    return text


def _render_pdf_pages(
    pdf_path: Path,
    *,
    page_numbers: list[int],
    dpi: int,
) -> dict[int, Path]:
    pdftoppm = shutil.which("pdftoppm")
    if pdftoppm is None:
        raise StageError("OCR requires `pdftoppm`")
    rendered: dict[int, Path] = {}
    temporary_roots: list[Path] = []
    try:
        for page_number in page_numbers:
            root = Path(tempfile.mkdtemp(prefix="heytutor-ocr-page-"))
            temporary_roots.append(root)
            prefix = root / "page"
            completed = subprocess.run(
                [
                    pdftoppm,
                    "-f",
                    str(page_number),
                    "-l",
                    str(page_number),
                    "-r",
                    str(dpi),
                    "-jpeg",
                    "-jpegopt",
                    "quality=88",
                    str(pdf_path),
                    str(prefix),
                ],
                check=False,
                capture_output=True,
            )
            if completed.returncode != 0:
                raise StageError(f"pdftoppm failed for {pdf_path.name} page {page_number}")
            images = sorted(root.glob("page-*.jpg"))
            if len(images) != 1:
                raise StageError(
                    f"rendered {len(images)} images for {pdf_path.name} page {page_number}"
                )
            rendered[page_number] = images[0]
        return rendered
    except BaseException:
        for root in temporary_roots:
            shutil.rmtree(root, ignore_errors=True)
        raise


def ocr_pdf_pages(
    pdf_path: Path,
    *,
    page_numbers: list[int] | None,
    expected_pages: int | None,
    workers: int,
    dpi: int,
    tessdata_dir: Path | None,
    allow_empty_page_numbers: set[int] | None = None,
) -> dict[int, str]:
    tesseract = shutil.which("tesseract")
    if tesseract is None:
        raise StageError("OCR requires `tesseract`")
    if page_numbers is None:
        if expected_pages is None:
            raise StageError("expected_pages is required for full-document OCR")
        selected_page_numbers = list(range(1, expected_pages + 1))
    else:
        selected_page_numbers = sorted(dict.fromkeys(page_numbers))
    if not selected_page_numbers:
        return {}
    # Render and OCR in chunks so a 100+ page scan cannot keep every page
    # image in memory at once.
    chunk_size = max(8, workers * 2)
    texts: dict[int, str] = {}
    for offset in range(0, len(selected_page_numbers), chunk_size):
        chunk = selected_page_numbers[offset : offset + chunk_size]
        temporary_directories: list[Path] = []
        try:
            rendered = _render_pdf_pages(pdf_path, page_numbers=chunk, dpi=dpi)
            temporary_directories.extend(path.parent for path in rendered.values())
            with ThreadPoolExecutor(max_workers=workers) as executor:
                chunk_texts = list(
                    executor.map(
                        lambda page_number: (
                            page_number,
                            _ocr_page(
                                rendered[page_number],
                                tesseract=tesseract,
                                tessdata_dir=tessdata_dir,
                                allow_empty=(
                                    allow_empty_page_numbers is not None
                                    and page_number in allow_empty_page_numbers
                                ),
                            ),
                        ),
                        chunk,
                    )
                )
            texts.update(chunk_texts)
        finally:
            for root in temporary_directories:
                shutil.rmtree(root, ignore_errors=True)
    return texts


def ocr_pdf(
    pdf_path: Path,
    *,
    expected_pages: int | None,
    workers: int,
    dpi: int,
    tessdata_dir: Path | None,
    allow_empty_page_numbers: set[int] | None = None,
) -> str:
    pages = ocr_pdf_pages(
            pdf_path,
            page_numbers=None,
            expected_pages=expected_pages,
            workers=workers,
            dpi=dpi,
            tessdata_dir=tessdata_dir,
            allow_empty_page_numbers=allow_empty_page_numbers,
        )
    return "\f".join(pages[page_number] for page_number in sorted(pages)) + "\f"


def _updated_notes(
    existing_notes: str | None,
    *,
    method: str,
    ocr_mode: str,
    dpi: int,
    page_methods: list[dict[str, Any]],
    review_pages: list[int],
    tessdata_dir: Path | None,
) -> str:
    notes = json.loads(existing_notes or "{}")
    notes["staged_text"] = {
        "method": method,
        "ocr_mode": ocr_mode,
        "dpi": dpi,
        "page_methods": page_methods,
        "review_pages": review_pages,
        "tessdata": _tessdata_metadata(tessdata_dir),
    }
    notes["staged_text_method"] = method
    return json.dumps(notes, ensure_ascii=False, sort_keys=True)


def stage_text(
    manifest_path: Path,
    raw_dir: Path,
    text_dir: Path,
    *,
    document_ids: set[str] | None,
    exam: str | None,
    year_before: int | None,
    minimum_characters: int,
    workers: int,
    dpi: int,
    tessdata_dir: Path | None,
    ocr_mode: str,
) -> dict[str, Any]:
    documents = load_documents(manifest_path)
    staged_documents = copy.deepcopy(documents)
    methods = Counter()
    processed: list[str] = []
    reused: list[str] = []
    failures: list[dict[str, str]] = []
    pending_writes: list[dict[str, Any]] = []
    resolved_tessdata_dir: Path | None = None
    for index, document in enumerate(staged_documents):
        document_id = document["document_id"]
        if document_ids is not None and document_id not in document_ids:
            continue
        if exam is not None and document["exam"] != exam:
            continue
        if year_before is not None and document["year"] >= year_before:
            continue
        pdf_path = raw_dir / f"{document_id}.pdf"
        text_path = text_dir / f"{document_id}.txt"
        try:
            if not pdf_path.is_file():
                raise StageError("raw PDF is missing")
            try:
                native = pdf_to_text(pdf_path)
            except PipelineError:
                native = ""
            expected_pages = document["artifact"]["page_count"]
            if ocr_mode == "hybrid":
                native_pages = text_pages(native)
                if expected_pages is not None and len(native_pages) != expected_pages:
                    raise FatalStageError(
                        f"page mapping mismatch before hybrid OCR for {document_id}: "
                        f"{len(native_pages)} != {expected_pages}"
                    )
                corrupt_pages = [
                    page_number
                    for page_number, page_text in enumerate(native_pages, start=1)
                    if _has_disallowed_corruption(
                        page_text, document_id=document_id
                    )
                ]
                page_methods = [
                    {"page_number": page_number, "method": "native"}
                    for page_number in range(1, len(native_pages) + 1)
                ]
                review_pages: list[int] = []
                if corrupt_pages:
                    if resolved_tessdata_dir is None:
                        resolved_tessdata_dir = _resolve_tessdata_dir(tessdata_dir)
                    ocr_pages = ocr_pdf_pages(
                        pdf_path,
                        page_numbers=corrupt_pages,
                        expected_pages=expected_pages,
                        workers=workers,
                        dpi=dpi,
                        tessdata_dir=resolved_tessdata_dir,
                    )
                    if sorted(ocr_pages) != corrupt_pages:
                        raise FatalStageError(
                            f"page mapping mismatch after hybrid OCR for {document_id}: "
                            f"rendered {sorted(ocr_pages)} != {corrupt_pages}"
                        )
                    text_parts = list(native_pages)
                    replacement_count = 0
                    for page_number in corrupt_pages:
                        accepted, fidelity = _evaluate_ocr_page(
                            native_pages[page_number - 1], ocr_pages[page_number]
                        )
                        if accepted:
                            text_parts[page_number - 1] = ocr_pages[page_number]
                            replacement_count += 1
                            page_methods[page_number - 1] = {
                                "page_number": page_number,
                                "method": "ocr_replaced",
                            }
                        else:
                            review_pages.append(page_number)
                            page_methods[page_number - 1] = {
                                "page_number": page_number,
                                "method": "native_review",
                                "reason": "ocr_fidelity_rejected",
                                "fidelity": fidelity,
                            }
                    text = "\f".join(text_parts) + "\f"
                    method = (
                        "hybrid-ocr-eng-fast-v1"
                        if replacement_count
                        else "pdftotext-layout"
                    )
                else:
                    text = native
                    method = "pdftotext-layout"
            else:
                force_ocr = (
                    document["exam"] == "JEE Main"
                    and _is_metadata_heavy_nta_export(native)
                )
                if force_ocr or needs_ocr(native, expected_pages, minimum_characters):
                    if resolved_tessdata_dir is None:
                        resolved_tessdata_dir = _resolve_tessdata_dir(tessdata_dir)
                    native_pages = text_pages(native)
                    known_blank_native_pages = (
                        {
                            page_number
                            for page_number, page_text in enumerate(
                                native_pages, start=1
                            )
                            if not page_text.strip()
                        }
                        if expected_pages is not None
                        and len(native_pages) == expected_pages
                        else set()
                    )
                    text = ocr_pdf(
                        pdf_path,
                        expected_pages=expected_pages,
                        workers=workers,
                        dpi=dpi,
                        tessdata_dir=resolved_tessdata_dir,
                        allow_empty_page_numbers=known_blank_native_pages,
                    )
                    if force_ocr:
                        _validate_nta_ocr_improvement(native, text)
                    method = "tesseract-ocr-eng-fast-v1"
                    page_methods = [
                        {"page_number": page_number, "method": "ocr_document"}
                        for page_number in range(1, len(text_pages(text)) + 1)
                    ]
                    review_pages = []
                else:
                    text = native
                    method = "pdftotext-layout"
                    page_methods = [
                        {"page_number": page_number, "method": "native"}
                        for page_number in range(1, len(text_pages(text)) + 1)
                    ]
                    review_pages = []
            if expected_pages is not None and len(text_pages(text)) != expected_pages:
                raise FatalStageError(
                    f"page mapping mismatch after {method}: "
                    f"{len(text_pages(text))} != {expected_pages}"
                )
            should_write = not (
                text_path.is_file() and text_path.read_text(encoding="utf-8") == text
            )
            document["provenance"]["notes"] = _updated_notes(
                document["provenance"]["notes"],
                method=method,
                ocr_mode=ocr_mode,
                dpi=dpi,
                page_methods=page_methods,
                review_pages=review_pages,
                tessdata_dir=resolved_tessdata_dir,
            )
            validate_document(document)
            if should_write:
                pending_writes.append(
                    {
                        "path": text_path,
                        "temp_path": _prepare_text_temp(text_path, text),
                        "original_exists": text_path.exists(),
                        "original_bytes": text_path.read_bytes()
                        if text_path.exists()
                        else b"",
                    }
                )
                processed.append(document_id)
            else:
                reused.append(document_id)
            methods[method] += 1
        except FatalStageError:
            raise
        except (OSError, ValueError, PipelineError, StageError) as exc:
            failures.append({"document_id": document_id, "error": str(exc)})
            staged_documents[index] = copy.deepcopy(documents[index])
    try:
        manifest_temp_path = _prepare_jsonl_temp(manifest_path, staged_documents)
    except BaseException:
        for update in pending_writes:
            temporary_path = update["temp_path"]
            if temporary_path.exists():
                temporary_path.unlink()
        raise
    _promote_staged_outputs(pending_writes, manifest_path, manifest_temp_path)
    return {
        "operation": "stage-pdf-text",
        "selected_documents": len(processed) + len(reused) + len(failures),
        "written": len(processed),
        "reused": len(reused),
        "methods": dict(sorted(methods.items())),
        "failures": failures,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DATA_ROOT / "manifest.jsonl")
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--text-dir", type=Path, required=True)
    parser.add_argument("--document-id", action="append", dest="document_ids")
    parser.add_argument("--exam")
    parser.add_argument("--year-before", type=int)
    parser.add_argument("--minimum-characters", type=int, default=200)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--tessdata-dir", type=Path)
    parser.add_argument("--ocr-mode", choices=("document", "hybrid"), default="document")
    parser.add_argument("--report", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.minimum_characters < 1 or args.workers < 1 or args.dpi < 72:
        raise SystemExit("minimum characters/workers must be positive and dpi at least 72")
    result = stage_text(
        args.manifest,
        args.raw_dir,
        args.text_dir,
        document_ids=set(args.document_ids) if args.document_ids else None,
        exam=args.exam,
        year_before=args.year_before,
        minimum_characters=args.minimum_characters,
        workers=args.workers,
        dpi=args.dpi,
        tessdata_dir=args.tessdata_dir,
        ocr_mode=args.ocr_mode,
    )
    if args.report is not None:
        _atomic_text(args.report, json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 1 if result["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
