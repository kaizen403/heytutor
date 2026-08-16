"""Acquisition, extraction, classification, and SQLite build operations."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import (
    DOCUMENT_SCHEMA_VERSION,
    QUESTION_SCHEMA_VERSION,
    ValidationError,
    canonical_question_text,
    deduplicate_questions,
    load_documents,
    load_json,
    load_questions,
    question_content_sha256,
    sha256_file,
    validate_corpus,
    validate_document,
    validate_question,
    write_jsonl,
)

DEFAULT_QUESTION_PATTERN = (
    r"^\s*(?P<prefix>Q(?:uestion)?\.?\s*)?"
    r"(?P<number>[1-9]\d{0,2}(?:\s*\([A-Za-z]\))?)"
    r"(?(prefix)\s*[.):]?|\s*[.):])"
    r"(?:\s+(?P<body>.*?))?\s*$"
)

_ANSWER_LINE_RE = re.compile(
    r"^[ \t]*(?:(?:answer|ans(?:wer)?\.?)\s*[:=-]\s*(?P<answer>.+?)"
    r"|(?P<zero_marks>Zero\s+Marks\s+to\s+all))\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_ANSWER_SUMMARY_FOOTER_RE = re.compile(
    r"\bAnswers?\s+for\s+the\s+above\s+questions?\b",
    re.IGNORECASE,
)
_ANSWER_TAIL_FOOTER_RE = re.compile(
    r"\bANSWER\s*:\s*(.{101,})", re.IGNORECASE | re.DOTALL
)
_PAGE_FOOTER_LINE_RE = re.compile(
    r"\bPage\s+\d+(?:\s+of\s+\d+)?\b|P\.?\s*T\.?\s*O\.?",
    re.IGNORECASE,
)
_PAPER_CODE_TOKEN_RE = re.compile(
    r"(?<!\w)"
    r"[~.\[\]()]*"
    r"(?:"
    r"\d{1,3}(?:/[A-Za-z0-9]{1,4})+(?:-\d{1,3})?"
    r"|"
    r"\d{1,3}\s*\([A-Za-z]\)"
    r")"
    r"[~.\[\]()]*"
    r"(?!\w)"
)
_PRINTER_NOISE_TOKEN_RE = re.compile(
    r"(?<!\w)(?:JJJJ|AANRN|ANRNRN)(?!\w)",
    re.IGNORECASE,
)
_BARE_SUBJECT_HEADER_RE = re.compile(
    r"^\s*[\[(|_]?\s*(?P<subject>PHYSICS|CHEMISTRY|MATHEMATICS)\s*[|\])]*\s*$"
)
_TITLE_CASE_BARE_SUBJECT_HEADER_RE = re.compile(
    r"^\s*[\[(|_]?\s*(?P<subject>Physics|Chemistry|Mathematics)\s*[|\])]*\s*$"
)
_PREFIXED_SUBJECT_HEADER_RE = re.compile(
    r"^\s*[\[(|]?\s*"
    r"(?:PART|SUBJECT)\s*[-:\u2013\u2014]?\s*(?:[IVXL\d]+\s*[-:\u2013\u2014]?\s*)?"
    r"(?P<subject>PHYSICS|CHEMISTRY|MATHEMATICS)\s*"
    r"(?:(?:[-:\u2013\u2014]\s*)?(?:SECTION|PART|PAPER|JEE|PARAGRAPH)\b.*)?"
    r"\s*[|\])]*\s*$",
    re.IGNORECASE,
)
_SUFFIXED_SUBJECT_HEADER_RE = re.compile(
    r"^\s*[\[(|]?\s*(?P<subject>PHYSICS|CHEMISTRY|MATHEMATICS)\s*"
    r"(?:[-:\u2013\u2014]\s*)?"
    r"(?:SECTION\s*[-:\u2013\u2014]?\s*(?P<section>[A-E]|\d+|[IVXL]+)\b.*"
    r"|(?:PART|PAPER|JEE|PARAGRAPH)\b.*)"
    r"\s*[|\])]*\s*$",
    re.IGNORECASE,
)
_JEE_SUBJECT_HEADER_RE = re.compile(
    r"^\s*JEE\s*\(\s*Advanced\s*\)\s*\d{4}\b.*?"
    r"\b(?P<subject>PHYSICS|CHEMISTRY|MATHEMATICS)\b.*?"
    r"\bPAPER\s*\d+\s*$",
    re.IGNORECASE,
)
_SECTION_BOUNDARY_RE = re.compile(
    r"^\s*SECTION\s*(?:(?:[-\u2013\u2014|:~:])\s*)*"
    r"(?P<section>[A-E]|\d+|[IVXLl|]+)\s*[\)}\]]?"
    r"(?:\s*(?:(?:[-\u2013\u2014|:~:])\s*)*"
    r"(?:\((?=[^)}]*(?:Marks?|Type|Option|Correct|Paragraph|Comprehension|Matching|Integer))[^)}]*[)}]"
    r"|(?:Single|Multiple|Integer|Paragraph|Comprehension|Matching|Only|One)\b.*"
    r"|(?:Question\s+(?:number|no\.)|Q\s*\.)\b.*"
    r"|\d+\s*[x\u00d7]\s*\d+\s*=\s*\d+))?\s*\.?\s*$",
    re.IGNORECASE,
)

# Some older CBSE PDFs expose glyphs from Adobe's standard Symbol encoding as
# private-use characters (U+F000 + the original one-byte font code). Keep this
# table local and explicit: relying on a host font installation would make
# extraction non-reproducible, while treating every PUA character as Symbol
# would corrupt the many CBSE custom fonts which use E0xx (and other PUA).
_ADOBE_SYMBOL_BYTE_TO_UNICODE: dict[int, str] = {
    0x20: " ", 0x21: "!", 0x22: "∀", 0x23: "#", 0x24: "∃",
    0x25: "%", 0x26: "&", 0x27: "∋", 0x28: "(", 0x29: ")",
    0x2A: "∗", 0x2B: "+", 0x2C: ",", 0x2D: "−", 0x2E: ".",
    0x2F: "/", **{code: chr(code) for code in range(0x30, 0x3A)},
    0x3A: ":", 0x3B: ";", 0x3C: "<", 0x3D: "=", 0x3E: ">",
    0x3F: "?", 0x40: "≅", 0x41: "Α", 0x42: "Β", 0x43: "Χ",
    0x44: "Δ", 0x45: "Ε", 0x46: "Φ", 0x47: "Γ", 0x48: "Η",
    0x49: "Ι", 0x4A: "ϑ", 0x4B: "Κ", 0x4C: "Λ", 0x4D: "Μ",
    0x4E: "Ν", 0x4F: "Ο", 0x50: "Π", 0x51: "Θ", 0x52: "Ρ",
    0x53: "Σ", 0x54: "Τ", 0x55: "Υ", 0x56: "ς", 0x57: "Ω",
    0x58: "Ξ", 0x59: "Ψ", 0x5A: "Ζ", 0x5B: "[", 0x5C: "∴",
    0x5D: "]", 0x5E: "⊥", 0x5F: "_", 0x60: "¯", 0x61: "α",
    0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ",
    0x67: "γ", 0x68: "η", 0x69: "ι", 0x6A: "ϕ", 0x6B: "κ",
    0x6C: "λ", 0x6D: "μ", 0x6E: "ν", 0x6F: "ο", 0x70: "π",
    0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ",
    0x76: "ϖ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7A: "ζ",
    0x7B: "{", 0x7C: "|", 0x7D: "}", 0x7E: "∼", 0xA0: "€", 0xA1: "ϒ",
    0xA2: "′", 0xA3: "≤", 0xA4: "⁄", 0xA5: "∞", 0xA6: "ƒ",
    0xA7: "♣", 0xA8: "♦", 0xA9: "♥", 0xAA: "♠", 0xAB: "↔",
    0xAC: "←", 0xAD: "↑", 0xAE: "→", 0xAF: "↓", 0xB0: "°",
    0xB1: "±", 0xB2: "″", 0xB3: "≥", 0xB4: "×", 0xB5: "∝",
    0xB6: "∂", 0xB7: "•", 0xB8: "÷", 0xB9: "≠", 0xBA: "≡",
    0xBB: "≈", 0xBC: "…", 0xBD: "⏐", 0xBE: "⎯", 0xBF: "↵",
    0xC0: "ℵ", 0xC1: "ℑ", 0xC2: "ℜ", 0xC3: "℘", 0xC4: "⊗",
    0xC5: "⊕", 0xC6: "∅", 0xC7: "∩", 0xC8: "∪", 0xC9: "⊃",
    0xCA: "⊇", 0xCB: "⊄", 0xCC: "⊂", 0xCD: "⊆", 0xCE: "∈",
    0xCF: "∉", 0xD0: "∠", 0xD1: "∇", 0xD2: "®", 0xD3: "©",
    0xD4: "™", 0xD5: "∏", 0xD6: "√", 0xD7: "⋅", 0xD8: "¬",
    0xD9: "∧", 0xDA: "∨", 0xDB: "⇔", 0xDC: "⇐", 0xDD: "⇑",
    0xDE: "⇒", 0xDF: "⇓", 0xE0: "◊", 0xE1: "⟨", 0xE2: "®",
    0xE3: "©", 0xE4: "™", 0xE5: "∑", 0xE6: "⎛", 0xE7: "⎜",
    0xE8: "⎝", 0xE9: "⎡", 0xEA: "⎢", 0xEB: "⎣", 0xEC: "⎧",
    0xED: "⎨", 0xEE: "⎩", 0xEF: "⎪", 0xF1: "⟩", 0xF2: "∫",
    0xF3: "⌠", 0xF4: "⎮", 0xF5: "⌡", 0xF6: "⎞", 0xF7: "⎟",
    0xF8: "⎠", 0xF9: "⎤", 0xFA: "⎥", 0xFB: "⎦", 0xFC: "⎫",
    0xFD: "⎬", 0xFE: "⎭",
}

# A second private-use range is used by several older CBSE custom Symbol-like
# fonts for mathematical delimiter pieces. These values come from observed
# PDF glyph sequences, not a broad PUA or Wingdings heuristic.
_CBSE_DELIMITER_PUA_TO_UNICODE: dict[int, str] = {
    0xF8EB: "⎛", 0xF8EC: "⎜", 0xF8ED: "⎝",
    0xF8EE: "⎡", 0xF8EF: "⎢", 0xF8F0: "⎣",
    0xF8F1: "⎧", 0xF8F2: "⎨", 0xF8F3: "⎩",
    0xF8F4: "⏐", 0xF8F5: "⎮",
    0xF8F6: "⎞", 0xF8F7: "⎟", 0xF8F8: "⎠",
    0xF8F9: "⎤", 0xF8FA: "⎥", 0xF8FB: "⎦",
    0xF8FC: "⎫", 0xF8FD: "⎬", 0xF8FE: "⎭",
}


def normalize_cbse_symbol_text(text: str, *, document_id: str) -> str:
    """Decode known Symbol-font PUA only for CBSE document extraction."""

    if not document_id.casefold().startswith("cbse-"):
        return text

    def replace(character: str) -> str:
        codepoint = ord(character)
        if 0xF000 <= codepoint <= 0xF0FF:
            return _ADOBE_SYMBOL_BYTE_TO_UNICODE.get(codepoint - 0xF000, character)
        return _CBSE_DELIMITER_PUA_TO_UNICODE.get(codepoint, character)

    return "".join(replace(character) for character in text)


_NTA_METADATA_LABEL_RE = re.compile(
    r"^\s*(?:Section\s+(?:Id|Number|type|Marks)|Mandatory\s+or\s+Optional"
    r"|Number\s+of\s+Questions(?:\s+to\s+be\s+attempted)?"
    r"|(?:Maximum\s+|Minimum\s+)?Instruction\s+Time|Sub-Section\s+(?:Number|Id)"
    r"|Question\s+Shuffling\s+Allowed|Is\s+Section\s+Default\?"
    r"|Response\s+Type|Evaluation\s+Required\s+For\s+SA|Show\s+Word\s+Count"
    r"|Answers\s+Type|Text\s+Areas|Possible\s+Answers"
    r"|Question\s+(?:Paper\s+Name|Mandatory)"
    r"|Correct\s+Marks|Wrong\s+Marks|Calculator|Response\s+Time|Think\s+Time"
    r"|Time\s*:\s*N\.?A\.?\s+Think\s+Time\s*:\s*N\.?A\.?"
    r"\s+(?:Minimum\s+)?Instruction\s+Time\s*:\s*\d+"
    r"|(?:Display\s+Question\s+)?Number\s*:\s*(?:Yes|No)"
    r"\s+(?:Is\s+)?Question\s+Mandatory\s*:\s*(?:Yes|No)"
    r"|:?\s*(?:Yes\s+)?(?:Is\s+)?Question\s+Mandatory\s*:\s*(?:Yes|No)"
    r"(?:\s+Single\s+Line\s+Question\s+Option\s*:\s*(?:Yes|No)"
    r"\s+Option\s+Orientation\s*:\s*(?:Vertical|Horizontal))?)\s*:?.*$",
    re.IGNORECASE,
)
_NTA_SECTION_VALUE_RE = re.compile(
    r"^\s*(?:\d+|Online|Mandatory|Optional|Yes|No)\s*$", re.IGNORECASE
)
_NTA_OPTION_ID_LINE_RE = re.compile(r"^\s*\d{6,12}[.)]?\s*$")
_NTA_TOPIC_NAME_RE = re.compile(r"^\s*Topic Name\s*:", re.IGNORECASE)
_NTA_ITEMCODE_RE = re.compile(r"^\s*[IT]temCode\s*:\s*(?P<code>\d{4,12})\s*$", re.IGNORECASE)
_NTA_GARBLED_Q_HEADER_RE = re.compile(r"^Q(?!uestion\b)\S{0,8}$", re.IGNORECASE)
_NTA_ITEMCODE_SERIES_GAP = 2
_NTA_VIEWER_CHROME_RE = re.compile(
    r"^\s*(?:"
    r"https?://g\d+\.tcsion\.com/CAE/pdf-preview(?:\s+\d+/\d+)?"
    r"(?:\s+(?=[A-Z0-9]{1,16}\s*$)(?=[A-Z0-9]*\d)[A-Z0-9]+)?"
    r"|\d{1,2}/\d{1,2}/\d{2,4},\s+\d{1,2}:\d{2}\s*(?:AM|PM)"
    r"\s+Online\s+Question\s+Paper\s+PDF\s+Preview"
    r"|Online\s+Question\s+Paper\s+PDF\s+Preview"
    r")\s*$",
    re.IGNORECASE,
)
_END_BOUNDARY_RE = re.compile(
    r"^\s*(?:END\s+OF\s+(?:THE\s+)?QUESTION\s+PAPER|END\s+OF\s+PAPER)\s*[.!-]*\s*$",
    re.IGNORECASE,
)
_COMMA_QUESTION_HEADING_RE = re.compile(
    r"^\s*(?P<number>[1-9]\d{0,2})\s*,(?:\s+(?P<body>.*?))?\s*$"
)
_SECTION_INSTRUCTION_TAIL_RE = re.compile(
    r"^\s*This\s+section\s+contains\b.*$", re.IGNORECASE | re.DOTALL
)
_SECTION_TAIL_LINE_RE = re.compile(
    r"^\s*(?:"
    r"This\s+section\s+contains\b.*"
    r"|"
    r"\((?:Single|Multiple|Integer|Matrix-Match|Paragraph|Comprehension|Matching)"
    r"(?:\s+Answer(?:\(s\))?)?\s+Type\)"
    r"|"
    r"(?:Single|Multiple|Integer|Matrix-Match|Paragraph|Comprehension|Matching)"
    r"(?:\s+Answer(?:\(s\))?)?\s+Type\b.*"
    r")\s*$",
    re.IGNORECASE,
)
_SHARED_STEM_HEADER_RE = re.compile(
    r"^\s*Question\s+Stem\s+for\s+Question\s+Nos?\.?\s+"
    r"(?P<start>\d{1,3})\s*(?:and|to|[-\u2013\u2014])\s*(?P<end>\d{1,3})"
    r"(?:\s*:\s*(?P<body>.*?))?\s*$",
    re.IGNORECASE,
)
_PARAGRAPH_RANGE_HEADER_RE = re.compile(
    r"^\s*Paragraph\s+for\s+Question(?:s)?\s+(?:Nos?\.?\s+)?"
    r"(?P<start>\d{1,3})\s*(?:and|to|[-\u2013\u2014])\s*(?P<end>\d{1,3})\s*$",
    re.IGNORECASE,
)
# JEE PDFs commonly print reaction/reagent sequences as bare numbered lines
# inside a real ``Q.`` block.  They are intentionally narrower than headings:
# short fragments (formulae, comma/slash-separated reagents, or step words)
# without a question-style prefix are evidence of an internal list.
_QUESTION_PREFIX_RE = re.compile(r"^\s*Q(?:uestion)?\.?\s*", re.IGNORECASE)
_QUESTION_START_RE = re.compile(
    r"^(?:the|a|an|which|what|find|calculate|consider|let|in|for|among|given|"
    r"determine|select|choose|evaluate|if|when|one|two|on|correct|identify|"
    r"the following)\b",
    re.IGNORECASE,
)
_COMPACT_STEP_RE = re.compile(
    r"^(?:[A-Za-z][A-Za-z0-9]*(?:\s*[,/+\-−]\s*[A-Za-z0-9]+)*"
    r"(?:\s*\([^)]{1,24}\))?)$"
)
_STEP_WORD_RE = re.compile(
    r"\b(?:excess|heat|then|dil\.?|reflux|light|hcl|h2o|koh|pdc|pd/c)\b",
    re.IGNORECASE,
)
_DOCUMENT_STATUS_RANK = {"planned": 0, "acquired": 1, "extracted": 2, "reviewed": 3}


def _looks_like_internal_numbered_step(line: str, body: str) -> bool:
    """Recognize bare, fragment-like numbered steps inside a JEE question.

    This deliberately does not identify chemistry by a fixed reagent list.  The
    evidence is structural and reusable across OCR variants: no explicit
    question prefix, a short non-sentence fragment, and either compact token
    syntax or a step/reagent word.  Full prose headings (including bare OCR
    headings such as ``2. Find x``) remain eligible.
    """

    if _QUESTION_PREFIX_RE.match(line):
        return False
    candidate = re.sub(r"\s+", " ", body).strip()
    if not candidate or len(candidate) > 140:
        return False
    if candidate.endswith((".", "?", ":")) or _QUESTION_START_RE.match(candidate):
        return False
    if _COMPACT_STEP_RE.fullmatch(candidate) or _STEP_WORD_RE.search(candidate):
        return True

    # ``pdftotext -layout`` keeps two reaction columns on one physical line.
    # Inspect the column fragments independently, removing their own step
    # number (and roman sub-step) before applying the same compact-token test.
    fragments = [fragment.strip() for fragment in re.split(r"\s{3,}", body) if fragment.strip()]
    compact_fragments = [
        re.sub(r"^(?:\d+[.)]\s*|i{1,3}[.)]\s*)", "", fragment, flags=re.IGNORECASE)
        for fragment in fragments
    ]
    return len(compact_fragments) >= 2 and any(
        _COMPACT_STEP_RE.fullmatch(fragment) or _STEP_WORD_RE.search(fragment)
        for fragment in compact_fragments
    )


class PipelineError(RuntimeError):
    """Raised when an acquisition or transformation step cannot finish safely."""


def _advance_document_status(document: dict[str, Any], status: str) -> None:
    current = document["status"]
    if current == "failed" or _DOCUMENT_STATUS_RANK[status] > _DOCUMENT_STATUS_RANK.get(current, -1):
        document["status"] = status


def _looks_like_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as source:
            return b"%PDF-" in source.read(1024)
    except FileNotFoundError:
        return False


def pdf_page_count(pdf_path: Path, executable: str = "pdfinfo") -> int | None:
    resolved_executable = shutil.which(executable)
    if resolved_executable is None:
        return None
    completed = subprocess.run(
        [resolved_executable, str(pdf_path)],
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


def _download_pdf(
    source_url: str,
    destination: Path,
    max_bytes: int,
    timeout_seconds: float,
    expected_hash: str | None,
) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(source_url, headers={"User-Agent": "HeyTutor-question-bank/1"})
    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".download", dir=destination.parent
        )
        temporary_path = Path(temporary_name)
        digest = hashlib.sha256()
        total = 0
        prefix = bytearray()
        with os.fdopen(descriptor, "wb") as output:
            try:
                response = urlopen(request, timeout=timeout_seconds)
            except (HTTPError, URLError) as exc:
                raise PipelineError(f"download failed for {source_url}: {exc}") from exc
            with response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise PipelineError(
                            f"download exceeded --max-bytes ({max_bytes}) for {source_url}"
                        )
                    if len(prefix) < 1024:
                        prefix.extend(chunk[: 1024 - len(prefix)])
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        if b"%PDF-" not in prefix:
            raise PipelineError(f"downloaded content is not a PDF: {source_url}")
        actual_hash = digest.hexdigest()
        if expected_hash is not None and expected_hash != actual_hash:
            raise PipelineError(
                f"SHA-256 mismatch for {destination.stem}: expected {expected_hash}, got {actual_hash}"
            )
        os.replace(temporary_path, destination)
        temporary_path = None
        return actual_hash
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def acquire_documents(
    manifest_path: Path,
    raw_dir: Path,
    document_ids: list[str],
    *,
    overwrite: bool = False,
    dry_run: bool = False,
    max_bytes: int = 200 * 1024 * 1024,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Acquire only explicitly named PDFs and pin their SHA-256 in the manifest."""

    documents = load_documents(manifest_path)
    document_by_id = {document["document_id"]: document for document in documents}
    missing = sorted(set(document_ids) - document_by_id.keys())
    if missing:
        raise PipelineError(f"document ids are absent from the manifest: {', '.join(missing)}")

    results: list[dict[str, Any]] = []
    for document_id in dict.fromkeys(document_ids):
        document = document_by_id[document_id]
        if document["artifact"]["member_path"] is not None:
            raise PipelineError(
                f"{document_id} is an archive member; materialize and verify its container first"
            )
        destination = raw_dir / f"{document_id}.pdf"
        if dry_run:
            results.append(
                {
                    "document_id": document_id,
                    "action": "download" if overwrite or not destination.exists() else "reuse",
                    "destination": str(destination),
                    "source_url": document["source_url"],
                }
            )
            continue

        if destination.exists() and not overwrite:
            if not _looks_like_pdf(destination):
                raise PipelineError(f"existing file is not a PDF: {destination}")
            actual_hash = sha256_file(destination)
            action = "reused"
        else:
            actual_hash = _download_pdf(
                document["source_url"],
                destination,
                max_bytes=max_bytes,
                timeout_seconds=timeout_seconds,
                expected_hash=document["sha256"],
            )
            action = "downloaded"

        expected_hash = document["sha256"]
        if expected_hash is not None and expected_hash != actual_hash:
            raise PipelineError(
                f"SHA-256 mismatch for {document_id}: expected {expected_hash}, got {actual_hash}"
            )
        document["sha256"] = actual_hash
        page_count = pdf_page_count(destination)
        if page_count is not None:
            document["artifact"]["page_count"] = page_count
        document["provenance"]["retrieved_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        _advance_document_status(document, "acquired")
        validate_document(document)
        write_jsonl(manifest_path, documents)
        results.append(
            {
                "document_id": document_id,
                "action": action,
                "destination": str(destination),
                "sha256": actual_hash,
            }
        )
    return {"operation": "acquire", "documents": results, "dry_run": dry_run}


def pdf_to_text(pdf_path: Path, executable: str = "pdftotext") -> str:
    resolved_executable = shutil.which(executable)
    if resolved_executable is None:
        raise PipelineError(
            f"{executable!r} is not installed; provide OCR/form-feed text with --text-file instead"
        )
    completed = subprocess.run(
        [resolved_executable, "-layout", str(pdf_path), "-"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"exit code {completed.returncode}"
        raise PipelineError(f"pdftotext failed for {pdf_path}: {detail}")
    if not completed.stdout.strip():
        raise PipelineError(
            f"pdftotext produced no text for {pdf_path}; use OCR and pass its form-feed text via --text-file"
        )
    return completed.stdout


def _clean_extracted_text(lines: list[str]) -> str:
    text = "\n".join(line.rstrip() for line in lines).replace("\x00", "").strip()
    return re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", text)


def _is_bare_subject_header_line(line: str) -> bool:
    return bool(
        _BARE_SUBJECT_HEADER_RE.match(line)
        or _TITLE_CASE_BARE_SUBJECT_HEADER_RE.match(line)
    )


def _is_any_subject_header_line(line: str) -> bool:
    return bool(
        _BARE_SUBJECT_HEADER_RE.match(line)
        or _TITLE_CASE_BARE_SUBJECT_HEADER_RE.match(line)
        or _PREFIXED_SUBJECT_HEADER_RE.match(line)
        or _SUFFIXED_SUBJECT_HEADER_RE.match(line)
        or _JEE_SUBJECT_HEADER_RE.match(line)
    )


def _is_section_header_line(line: str) -> bool:
    stripped = line.strip()
    return bool(
        _SECTION_BOUNDARY_RE.match(stripped)
        or _END_BOUNDARY_RE.match(stripped)
        or _is_any_subject_header_line(stripped)
        or _SECTION_TAIL_LINE_RE.match(stripped)
        or _PARAGRAPH_RANGE_HEADER_RE.match(stripped)
        or _SHARED_STEM_HEADER_RE.match(stripped)
    )


def _is_section_instruction_tail(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    stripped_lines = [line.strip() for line in stripped.splitlines() if line.strip()]
    if all(_is_section_header_line(line) for line in stripped_lines):
        return True
    if _ANSWER_LINE_RE.search(stripped):
        return False
    return bool(re.search(r"\bThis\s+section\s+contains\b", stripped, re.IGNORECASE))


def _strip_answer_footer(text: str) -> str:
    """Remove answer-key spillover that was merged into the question body."""

    summary_match = _ANSWER_SUMMARY_FOOTER_RE.search(text)
    if summary_match is not None and summary_match.start() >= 40:
        stripped = text[: summary_match.start()].rstrip()
        return stripped or text

    tail_match = _ANSWER_TAIL_FOOTER_RE.search(text)
    if tail_match is not None:
        cut = tail_match.start()
        if cut >= max(80, len(text) // 3):
            stripped = text[:cut].rstrip()
            return stripped or text

    return text


def _strip_page_footer_noise(text: str) -> str:
    """Drop standalone page/footer noise without removing question content."""

    def is_structural_footer_line(line: str) -> bool:
        if _PAGE_FOOTER_LINE_RE.search(line) is None:
            return False

        residue = _PAGE_FOOTER_LINE_RE.sub(" ", line)
        residue = _PAPER_CODE_TOKEN_RE.sub(" ", residue)
        residue = _PRINTER_NOISE_TOKEN_RE.sub(" ", residue)
        residue = re.sub(r"\b\d+\b", " ", residue)
        residue = re.sub(r"[\W_]+", "", residue, flags=re.UNICODE)
        return residue == ""

    cleaned_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if is_structural_footer_line(line):
            continue
        cleaned_lines.append(line)

    return "\n".join(cleaned_lines).strip()


def _text_pages(text: str) -> list[str]:
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def _iter_following_lines(
    pages: list[str], page_index: int, line_index: int
):
    for line in pages[page_index].splitlines()[line_index + 1 :]:
        yield line
    for later_page in pages[page_index + 1 :]:
        yield from later_page.splitlines()


def _peek_nta_topic_itemcode(
    pages: list[str], page_index: int, line_index: int
) -> tuple[bool, int | None]:
    """Return whether Topic Name follows, plus a nearby ItemCode/TtemCode."""

    following: list[str] = []
    for candidate in _iter_following_lines(pages, page_index, line_index):
        if candidate.strip():
            following.append(candidate)
            if len(following) >= 2:
                break
    if not following or not _NTA_TOPIC_NAME_RE.match(following[0]):
        return False, None
    if len(following) < 2:
        return True, None
    item_match = _NTA_ITEMCODE_RE.match(following[1])
    if item_match is None:
        return True, None
    return True, int(item_match.group("code"))


def _nta_itemcode_implied_number(
    itemcode: int,
    itemcode_base: tuple[int, int] | None,
    last_itemcode: int | None,
) -> int | None:
    """Map a sequential 2022 ItemCode onto the question number from the first parsed code."""

    if itemcode_base is None:
        return None
    base_code, base_number = itemcode_base
    implied = base_number + (itemcode - base_code)
    if implied < 1 or implied > 99:
        return None
    if itemcode < base_code:
        return None
    if last_itemcode is not None and not (
        1 <= itemcode - last_itemcode <= _NTA_ITEMCODE_SERIES_GAP
    ):
        return None
    return implied


def parse_questions_with_diagnostics(
    text: str,
    *,
    document_id: str,
    document_sha256: str,
    extraction_method: str,
    page_offset: int = 0,
    question_pattern: str = DEFAULT_QUESTION_PATTERN,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Split page text and return evidence about content the splitter did not assign."""

    try:
        heading_re = re.compile(question_pattern, re.IGNORECASE)
    except re.error as exc:
        raise PipelineError(f"invalid --question-pattern: {exc}") from exc
    named_groups = heading_re.groupindex
    uses_named_groups = "number" in named_groups
    is_nta_export = "Question" in question_pattern and "Number" in question_pattern
    is_jee_advanced_paper = document_id.startswith("jee-advanced-") and not is_nta_export
    # Deferred blank headings are a property of answer-annotated legacy
    # exports, not of every JEE Advanced PDF. Enabling this heuristic on normal
    # question-only papers incorrectly groups ordinary standalone headings.
    supports_deferred_answer_blocks = (
        is_jee_advanced_paper and bool(_ANSWER_LINE_RE.search(text))
    )
    supports_shared_question_stems = is_jee_advanced_paper
    supports_internal_numbered_steps = is_jee_advanced_paper
    if not uses_named_groups and heading_re.groups < 1:
        raise PipelineError(
            "--question-pattern must capture a question number (and optionally the first text line)"
        )

    # Preserve the raw extraction artifact hash for provenance, but normalize
    # known CBSE Symbol-font glyphs before splitting and question hashing.
    artifact_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    text = normalize_cbse_symbol_text(text, document_id=document_id)
    pages = _text_pages(text)

    candidates: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    unassigned_lines: list[dict[str, Any]] = []
    suspicious_heading_lines: list[dict[str, Any]] = []
    blocking_issues: list[dict[str, Any]] = []
    page_heading_counts: dict[int, int] = {}
    current_subject: str | None = None
    current_section: str | None = None
    boundary_lines: list[dict[str, Any]] = []
    subject_header_counts: dict[str, int] = {}
    question_subject_counts: dict[str, int] = {}
    deferred_blank_headings: list[dict[str, Any]] = []
    shared_stem: dict[str, Any] | None = None
    internal_numbered_step_mode = False
    last_emitted_question_number: int | None = None
    nta_itemcode_base: tuple[int, int] | None = None
    nta_last_itemcode: int | None = None
    allow_subject_number_restart = False
    loose_heading_re = re.compile(r"^\s*(?:(?:Q(?:uestion)?\.?)\s*)?\d{1,3}\b", re.IGNORECASE)

    def _shared_stem_text(metadata: dict[str, Any]) -> str:
        cached = metadata.get("text")
        if isinstance(cached, str):
            return cached
        text_value = _strip_page_footer_noise(
            _strip_answer_footer(_clean_extracted_text(metadata["lines"]))
        )
        metadata["text"] = text_value
        return text_value

    def _is_safe_comma_heading_candidate(candidate: re.Match[str]) -> bool:
        number = int(candidate.group("number"))
        if number > 99:
            return False
        if shared_stem is None:
            return True
        expected_numbers = shared_stem["expected_numbers"]
        matched_numbers = shared_stem["matched_numbers"]
        next_expected = expected_numbers[len(matched_numbers)]
        return candidate.group("number") == next_expected

    def _in_empty_deferred_run() -> bool:
        return (
            supports_deferred_answer_blocks
            and current is not None
            and not _clean_extracted_text(current["lines"])
        )

    def _in_open_deferred_run() -> bool:
        return supports_deferred_answer_blocks and current is not None and (
            bool(deferred_blank_headings) or not _clean_extracted_text(current["lines"])
        )

    def _deferred_block_ready_to_close() -> bool:
        if current is None or not deferred_blank_headings:
            return False
        extracted_text = _clean_extracted_text(
            [
                *(
                    line
                    for metadata in deferred_blank_headings
                    for line in metadata["lines"]
                ),
                *current["lines"],
            ]
        )
        if not extracted_text:
            return False
        numbered_count = len(deferred_blank_headings) + 1
        answer_matches = list(_ANSWER_LINE_RE.finditer(extracted_text))
        trailing_text = (
            extracted_text[answer_matches[-1].end() :].strip()
            if answer_matches
            else ""
        )
        if len(answer_matches) > numbered_count:
            after_nth = extracted_text[answer_matches[numbered_count - 1].end() :].strip()
            return bool(after_nth and _ANSWER_LINE_RE.search(after_nth))
        if len(answer_matches) == numbered_count:
            return _is_section_instruction_tail(trailing_text)
        if len(answer_matches) == numbered_count - 1:
            return len(trailing_text) >= 20 and not _is_section_instruction_tail(
                trailing_text
            )
        return False

    def clear_shared_stem(reason: str, *, found_question: str | None = None) -> None:
        nonlocal shared_stem
        if shared_stem is None:
            return
        range_label = shared_stem["range_label"]
        expected_numbers = shared_stem["expected_numbers"]
        matched_numbers = shared_stem["matched_numbers"]
        next_expected = (
            expected_numbers[len(matched_numbers)]
            if len(matched_numbers) < len(expected_numbers)
            else None
        )
        detail = f"shared stem {range_label} {reason}"
        if next_expected is not None:
            detail += f"; next expected question {next_expected}"
        if found_question is not None:
            detail += f"; found question {found_question}"
        issue = {
            "page_number": shared_stem["page_number"],
            "kind": "shared_stem_range_mismatch",
            "text": detail[:240],
        }
        suspicious_heading_lines.append({"page_number": issue["page_number"], "text": issue["text"]})
        blocking_issues.append(issue)
        shared_stem = None

    def emit_candidate(
        metadata: dict[str, Any], extracted_text: str, answer: str | None
    ) -> None:
        nonlocal last_emitted_question_number
        content_hash = question_content_sha256(extracted_text)
        subject_context = metadata["subject_context"]
        subject_key = subject_context or "unknown"
        question_subject_counts[subject_key] = question_subject_counts.get(subject_key, 0) + 1
        record = {
            "schema_version": QUESTION_SCHEMA_VERSION,
            "question_id": f"q_{content_hash}",
            "text": extracted_text,
            "content_sha256": content_hash,
            "topic": None,
            "subtopic": None,
            "difficulty": None,
            "answer": answer,
            "status": "extracted",
            "source_refs": [
                {
                    "document_id": document_id,
                    "document_sha256": document_sha256,
                    "page_number": metadata["page_number"],
                    "page_end": metadata["page_end"],
                    "question_number": metadata["question_number"],
                    "subject_context": subject_context,
                    "extraction_method": extraction_method,
                    "extracted_text_sha256": hashlib.sha256(
                        extracted_text.encode("utf-8")
                    ).hexdigest(),
                    "extraction_artifact_sha256s": [artifact_hash],
                }
            ],
        }
        validate_question(record)
        candidates.append(record)
        emitted_number = metadata["question_number"]
        if emitted_number.isdigit():
            last_emitted_question_number = int(emitted_number)

    def finish_current() -> None:
        nonlocal current, deferred_blank_headings, internal_numbered_step_mode
        if current is None:
            internal_numbered_step_mode = False
            return
        extracted_text = _clean_extracted_text(current["lines"])
        if deferred_blank_headings and extracted_text:
            numbered_metadata = [*deferred_blank_headings, current]
            answer_matches = list(_ANSWER_LINE_RE.finditer(extracted_text))
            trailing_text = (
                extracted_text[answer_matches[-1].end() :].strip()
                if answer_matches
                else ""
            )
            missing_only_final_answer = (
                len(answer_matches) == len(numbered_metadata) - 1
                and len(trailing_text) >= 20
                and not _is_section_instruction_tail(trailing_text)
            )
            extra_complete_question = False
            if len(answer_matches) > len(numbered_metadata):
                after_nth = extracted_text[
                    answer_matches[len(numbered_metadata) - 1].end() :
                ].strip()
                extra_complete_question = bool(
                    after_nth and _ANSWER_LINE_RE.search(after_nth)
                )
            can_split_deferred_block = (
                missing_only_final_answer
                or extra_complete_question
                or (
                    len(answer_matches) == len(numbered_metadata)
                    and _is_section_instruction_tail(trailing_text)
                )
            )
            if can_split_deferred_block:
                split_records: list[tuple[dict[str, Any], str, str | None]] = []
                start = 0
                for metadata_index, (metadata, answer_match) in enumerate(
                    zip(numbered_metadata, answer_matches)
                ):
                    prefix_lines = (
                        metadata["lines"]
                        if metadata_index < len(deferred_blank_headings)
                        else []
                    )
                    body = _clean_extracted_text(
                        [
                            *prefix_lines,
                            *extracted_text[
                                start : answer_match.start()
                            ].splitlines(),
                        ]
                    )
                    body = _strip_page_footer_noise(_strip_answer_footer(body))
                    if not body:
                        split_records = []
                        break
                    split_metadata = dict(metadata)
                    split_metadata["page_end"] = current["page_end"]
                    split_metadata["subject_context"] = (
                        current["subject_context"] or metadata["subject_context"]
                    )
                    split_records.append(
                        (
                            split_metadata,
                            body,
                            (
                                answer_match.group("answer")
                                or answer_match.group("zero_marks")
                            ).strip(),
                        )
                    )
                    start = answer_match.end()
                if missing_only_final_answer and len(split_records) == len(answer_matches):
                    final_metadata = dict(numbered_metadata[-1])
                    final_metadata["page_end"] = current["page_end"]
                    final_metadata["subject_context"] = (
                        current["subject_context"]
                        or numbered_metadata[-1]["subject_context"]
                    )
                    final_body = _strip_page_footer_noise(
                        _strip_answer_footer(trailing_text)
                    )
                    if final_body:
                        split_records.append((final_metadata, final_body, None))
                if len(split_records) == len(numbered_metadata):
                    for metadata, body, answer in split_records:
                        emit_candidate(metadata, body, answer)
                    if extra_complete_question:
                        leftover = extracted_text[
                            answer_matches[len(numbered_metadata) - 1].end() :
                        ].strip()
                        if leftover:
                            unassigned_lines.append(
                                {
                                    "page_number": current["page_end"],
                                    "text": leftover[:240],
                                }
                            )
                    deferred_blank_headings = []
                    current = None
                    internal_numbered_step_mode = False
                    return

            suspicious_heading_lines.extend(
                {
                    "page_number": metadata["page_number"],
                    "text": f"deferred question {metadata['question_number']}",
                }
                for metadata in deferred_blank_headings
            )
            blocking_issues.extend(
                {
                    "page_number": metadata["page_number"],
                    "kind": "unresolved_deferred_question",
                    "text": f"deferred question {metadata['question_number']}",
                }
                for metadata in deferred_blank_headings
            )
            grouped_metadata = [*deferred_blank_headings, current]
            grouped_numbers = [
                metadata["question_number"] for metadata in grouped_metadata
            ]
            numeric_numbers = (
                [int(number) for number in grouped_numbers]
                if all(number.isdigit() for number in grouped_numbers)
                else []
            )
            if numeric_numbers and numeric_numbers == list(
                range(numeric_numbers[0], numeric_numbers[-1] + 1)
            ):
                current["question_number"] = (
                    f"{numeric_numbers[0]}-{numeric_numbers[-1]}"
                )
            else:
                current["question_number"] = ",".join(grouped_numbers)
            current["page_number"] = min(
                metadata["page_number"] for metadata in grouped_metadata
            )
            extracted_text = _clean_extracted_text(
                [
                    *(
                        line
                        for metadata in deferred_blank_headings
                        for line in metadata["lines"]
                    ),
                    *current["lines"],
                ]
            )
            deferred_blank_headings = []
        answer_matches = list(_ANSWER_LINE_RE.finditer(extracted_text))
        answer: str | None = None
        if answer_matches:
            answer_match = answer_matches[-1]
            answer = (
                answer_match.group("answer") or answer_match.group("zero_marks")
            ).strip()
            extracted_text = (
                extracted_text[: answer_match.start()] + extracted_text[answer_match.end() :]
            ).strip()
        extracted_text = _strip_answer_footer(extracted_text)
        extracted_text = _strip_page_footer_noise(extracted_text)
        if not extracted_text:
            if deferred_blank_headings:
                suspicious_heading_lines.extend(
                    {
                        "page_number": metadata["page_number"],
                        "text": f"deferred question {metadata['question_number']}",
                    }
                    for metadata in deferred_blank_headings
                )
                blocking_issues.extend(
                    {
                        "page_number": metadata["page_number"],
                        "kind": "unresolved_deferred_question",
                        "text": f"deferred question {metadata['question_number']}",
                    }
                    for metadata in deferred_blank_headings
                )
                deferred_blank_headings = []
            current = None
            internal_numbered_step_mode = False
            return
        emit_candidate(current, extracted_text, answer)
        current = None
        internal_numbered_step_mode = False

    for page_index, page in enumerate(pages, start=1):
        page_number = page_index + page_offset
        if page_number < 1:
            raise PipelineError("page_offset yields a page number below 1")
        page_lines = page.splitlines()
        for line_index, line in enumerate(page_lines):
            if current is None:
                internal_numbered_step_mode = False
            shared_stem_match = (
                _SHARED_STEM_HEADER_RE.match(line)
                if supports_shared_question_stems
                else None
            )
            paragraph_range_match = (
                _PARAGRAPH_RANGE_HEADER_RE.match(line)
                if supports_deferred_answer_blocks
                else None
            )
            if paragraph_range_match is not None:
                start_number = int(paragraph_range_match.group("start"))
                end_number = int(paragraph_range_match.group("end"))
                expected_numbers = (
                    [str(number) for number in range(start_number, end_number + 1)]
                    if start_number < end_number
                    else []
                )
                open_numbers = [
                    *(
                        metadata["question_number"]
                        for metadata in deferred_blank_headings
                    ),
                    *([current["question_number"]] if current is not None else []),
                ]
                if expected_numbers and open_numbers == expected_numbers:
                    if current is not None:
                        current["lines"].append(line)
                        current["page_end"] = page_number
                    boundary_lines.append(
                        {
                            "kind": "paragraph_range",
                            "page_number": page_number,
                            "text": line.strip()[:240],
                        }
                    )
                    continue
                if expected_numbers and _deferred_block_ready_to_close():
                    finish_current()
                if current is not None:
                    current["lines"].append(line)
                    current["page_end"] = page_number
                elif line.strip():
                    unassigned_lines.append(
                        {"page_number": page_number, "text": line.strip()[:240]}
                    )
                boundary_lines.append(
                    {
                        "kind": "paragraph_range",
                        "page_number": page_number,
                        "text": line.strip()[:240],
                    }
                )
                continue
            if shared_stem_match is not None:
                finish_current()
                if shared_stem is not None:
                    clear_shared_stem("was replaced before its full range was matched")
                start_number = int(shared_stem_match.group("start"))
                end_number = int(shared_stem_match.group("end"))
                if start_number >= end_number:
                    issue = {
                        "page_number": page_number,
                        "kind": "shared_stem_invalid_range",
                        "text": (
                            f"shared stem range {start_number}-{end_number} is not increasing"
                        )[:240],
                    }
                    suspicious_heading_lines.append(
                        {"page_number": issue["page_number"], "text": issue["text"]}
                    )
                    blocking_issues.append(issue)
                    continue
                inline_body = (shared_stem_match.group("body") or "").strip()
                shared_stem = {
                    "page_number": page_number,
                    "page_end": page_number,
                    "subject_context": current_subject,
                    "expected_numbers": [
                        str(number) for number in range(start_number, end_number + 1)
                    ],
                    "matched_numbers": [],
                    "range_label": f"{start_number}-{end_number}",
                    "lines": [inline_body] if inline_body else [],
                }
                boundary_lines.append(
                    {
                        "kind": "shared_stem",
                        "page_number": page_number,
                        "text": line.strip()[:240],
                    }
                )
                continue
            subject_match = (
                _BARE_SUBJECT_HEADER_RE.match(line)
                or _PREFIXED_SUBJECT_HEADER_RE.match(line)
                or _SUFFIXED_SUBJECT_HEADER_RE.match(line)
                or _JEE_SUBJECT_HEADER_RE.match(line)
            )
            if subject_match is None and current is None:
                subject_match = _TITLE_CASE_BARE_SUBJECT_HEADER_RE.match(line)
            if subject_match:
                if shared_stem is not None:
                    clear_shared_stem("crossed a subject boundary before its full range was matched")
                subject = subject_match.group("subject").capitalize()
                header_section = subject_match.groupdict().get("section")
                if header_section is not None:
                    header_section = header_section.upper()
                attaches_to_current_export_header = (
                    current is not None
                    and current["allows_trailing_subject_header"]
                    and current["question_number"] in {"1", "26", "51"}
                    and header_section is not None
                )
                if attaches_to_current_export_header:
                    current["subject_context"] = subject
                    current["lines"] = []
                    current["skipping_export_section_values"] = True
                elif subject != current_subject or (
                    header_section is not None
                    and current_section is not None
                    and header_section != current_section
                ):
                    skip_flush = _in_empty_deferred_run() and _is_bare_subject_header_line(
                        line
                    )
                    if skip_flush and current is not None:
                        current["subject_context"] = subject
                        for metadata in deferred_blank_headings:
                            if not metadata.get("subject_context"):
                                metadata["subject_context"] = subject
                    else:
                        finish_current()
                    if subject != current_subject:
                        current_section = None
                        allow_subject_number_restart = True
                current_subject = subject
                if header_section is not None:
                    current_section = header_section
                subject_header_counts[subject] = subject_header_counts.get(subject, 0) + 1
                boundary_lines.append(
                    {
                        "kind": "subject",
                        "page_number": page_number,
                        "text": line.strip()[:240],
                    }
                )
                continue
            if is_nta_export and _NTA_METADATA_LABEL_RE.match(line):
                continue
            if is_nta_export and _NTA_OPTION_ID_LINE_RE.match(line):
                continue
            if is_nta_export and _NTA_VIEWER_CHROME_RE.match(line):
                continue
            if (
                current is not None
                and current["skipping_export_section_values"]
                and _NTA_SECTION_VALUE_RE.match(line)
            ):
                continue
            if current is not None and current["skipping_export_section_values"]:
                current["skipping_export_section_values"] = False
            section_match = _SECTION_BOUNDARY_RE.match(line)
            end_match = _END_BOUNDARY_RE.match(line)
            if section_match or end_match:
                if shared_stem is not None:
                    clear_shared_stem(
                        "crossed a section boundary before its full range was matched"
                        if section_match
                        else "ended before its full range was matched"
                    )
                if end_match:
                    finish_current()
                    current_subject = None
                    current_section = None
                else:
                    section = section_match.group("section").upper()
                    if section != current_section:
                        finish_current()
                    current_section = section
                boundary_lines.append(
                    {
                        "kind": "end" if end_match else "section",
                        "page_number": page_number,
                        "text": line.strip()[:240],
                    }
                )
                continue
            match = heading_re.match(line)
            if is_nta_export:
                topic_follows, itemcode = _peek_nta_topic_itemcode(
                    pages, page_index - 1, line_index
                )
                if topic_follows:
                    predecessor = None
                    current_number = (
                        current["question_number"] if current is not None else None
                    )
                    if isinstance(current_number, str) and current_number.isdigit():
                        predecessor = int(current_number)
                    elif last_emitted_question_number is not None:
                        predecessor = last_emitted_question_number
                    parsed_number = None
                    if match is not None:
                        raw_number = (
                            match.group("number")
                            if uses_named_groups
                            else match.group(1)
                        )
                        if raw_number and raw_number.isdigit():
                            parsed_number = int(raw_number)
                    garbled = match is None and bool(
                        _NTA_GARBLED_Q_HEADER_RE.match(line.strip())
                    )
                    expected_number = predecessor + 1 if predecessor is not None else None
                    dropped_digit = (
                        parsed_number is not None
                        and expected_number is not None
                        and parsed_number != expected_number
                        and parsed_number < expected_number
                        and str(expected_number).endswith(str(parsed_number))
                    )
                    itemcode_number = (
                        _nta_itemcode_implied_number(
                            itemcode, nta_itemcode_base, nta_last_itemcode
                        )
                        if itemcode is not None
                        else None
                    )
                    if itemcode_number is not None:
                        if garbled or parsed_number != itemcode_number:
                            match = heading_re.match(f"Q:{itemcode_number}")
                    elif predecessor is not None and (garbled or dropped_digit):
                        match = heading_re.match(f"Q:{predecessor + 1}")
                    used_number = None
                    if match is not None:
                        used_raw = (
                            match.group("number")
                            if uses_named_groups
                            else match.group(1)
                        )
                        if used_raw and used_raw.isdigit():
                            used_number = int(used_raw)
                    if itemcode is not None and used_number is not None:
                        if nta_itemcode_base is None or (
                            nta_last_itemcode is not None
                            and itemcode < nta_last_itemcode
                        ):
                            nta_itemcode_base = (itemcode, used_number)
                        nta_last_itemcode = itemcode
            comma_heading = None
            if match is None and supports_deferred_answer_blocks:
                possible_comma_heading = _COMMA_QUESTION_HEADING_RE.match(line)
                if (
                    possible_comma_heading is not None
                    and _is_safe_comma_heading_candidate(possible_comma_heading)
                ):
                    comma_body = possible_comma_heading.group("body") or ""
                    if comma_body.strip():
                        comma_heading = possible_comma_heading
                    else:
                        next_nonempty = next(
                            (
                                candidate
                                for candidate in page_lines[line_index + 1 :]
                                if candidate.strip()
                            ),
                            None,
                        )
                        next_match = heading_re.match(next_nonempty or "")
                        if next_match is not None:
                            next_body = (
                                next_match.groupdict().get("body")
                                if uses_named_groups
                                else (
                                    next_match.group(2)
                                    if heading_re.groups >= 2
                                    else ""
                                )
                            )
                            if not (next_body or "").strip():
                                comma_heading = possible_comma_heading
                        elif _in_open_deferred_run() and current is not None:
                            current_number = current["question_number"]
                            comma_number = possible_comma_heading.group("number")
                            if (
                                current_number.isdigit()
                                and comma_number.isdigit()
                                and int(comma_number) == int(current_number) + 1
                            ):
                                comma_heading = possible_comma_heading
                            elif _is_any_subject_header_line(next_nonempty or ""):
                                comma_heading = possible_comma_heading
            if match or comma_heading:
                if comma_heading is not None:
                    question_number = comma_heading.group("number")
                    first_line = comma_heading.group("body") or ""
                elif uses_named_groups:
                    question_number = match.group("number")
                    first_line = match.groupdict().get("body") or ""
                else:
                    question_number = match.group(1)
                    first_line = match.group(2) if heading_re.groups >= 2 else ""
                if supports_internal_numbered_steps and current is not None:
                    current_number = current["question_number"]
                    normalized_candidate_number = re.sub(r"\s+", "", question_number)
                    is_expected_successor = (
                        current_number.isdigit()
                        and normalized_candidate_number.isdigit()
                        and int(normalized_candidate_number) == int(current_number) + 1
                    )
                    if internal_numbered_step_mode:
                        if _looks_like_internal_numbered_step(line, first_line):
                            current["lines"].append(line)
                            current["page_end"] = page_number
                            continue
                        internal_numbered_step_mode = False
                    elif (
                        not is_expected_successor
                        and _looks_like_internal_numbered_step(line, first_line)
                    ):
                        current["lines"].append(line)
                        current["page_end"] = page_number
                        internal_numbered_step_mode = True
                        continue
                if (
                    shared_stem is None
                    and _in_open_deferred_run()
                    and current is not None
                ):
                    current_number = current["question_number"]
                    normalized_candidate_number = re.sub(r"\s+", "", question_number)
                    is_deferred_successor = (
                        current_number.isdigit()
                        and normalized_candidate_number.isdigit()
                        and int(normalized_candidate_number) == int(current_number) + 1
                    )
                    candidate_body = (first_line or "").strip()
                    looks_like_new_question = bool(
                        _QUESTION_PREFIX_RE.match(line)
                        or (
                            candidate_body and _QUESTION_START_RE.match(candidate_body)
                        )
                    )
                    is_plausible_forward_number = (
                        current_number.isdigit()
                        and normalized_candidate_number.isdigit()
                        and 1
                        <= int(normalized_candidate_number) - int(current_number)
                        <= 5
                    )
                    if (
                        not is_deferred_successor
                        and not is_plausible_forward_number
                        and not looks_like_new_question
                    ):
                        current["lines"].append(line)
                        current["page_end"] = page_number
                        continue
                normalized_question_number = re.sub(r"\s+", "", question_number)
                if (
                    supports_deferred_answer_blocks
                    and current is None
                    and not deferred_blank_headings
                    and not (first_line or "").strip()
                    and normalized_question_number.isdigit()
                    and last_emitted_question_number is not None
                    and int(normalized_question_number) + 5 < last_emitted_question_number
                    and not allow_subject_number_restart
                ):
                    if line.strip():
                        unassigned_lines.append(
                            {"page_number": page_number, "text": line.strip()[:240]}
                        )
                    continue
                shared_stem_prefix: list[str] = []
                shared_stem_page_number: int | None = None
                shared_stem_subject_context: str | None = None
                if shared_stem is not None:
                    expected_numbers = shared_stem["expected_numbers"]
                    matched_numbers = shared_stem["matched_numbers"]
                    next_expected = expected_numbers[len(matched_numbers)]
                    if normalized_question_number == next_expected:
                        stem_text = _shared_stem_text(shared_stem)
                        if not stem_text:
                            clear_shared_stem(
                                "did not capture any reusable text before the declared range"
                            )
                        else:
                            shared_stem_prefix = [stem_text, ""]
                            shared_stem_page_number = shared_stem["page_number"]
                            shared_stem_subject_context = shared_stem["subject_context"]
                            matched_numbers.append(normalized_question_number)
                            if len(matched_numbers) == len(expected_numbers):
                                shared_stem = None
                    elif matched_numbers:
                        clear_shared_stem(
                            "ended before its full range was matched",
                            found_question=normalized_question_number,
                        )
                    elif normalized_question_number.isdigit():
                        clear_shared_stem(
                            "did not start on the declared first question",
                            found_question=normalized_question_number,
                        )
                current_text = (
                    _clean_extracted_text(current["lines"])
                    if current is not None
                    else ""
                )
                should_defer_current = (
                    supports_deferred_answer_blocks
                    and current is not None
                    and not (first_line or "").strip()
                    and (
                        not current_text
                        or _ANSWER_LINE_RE.search(current_text) is None
                    )
                )
                if should_defer_current:
                    deferred_blank_headings.append(current)
                    current = None
                else:
                    finish_current()
                page_heading_counts[page_number] = page_heading_counts.get(page_number, 0) + 1
                allow_subject_number_restart = False
                current = {
                    "question_number": normalized_question_number,
                    "page_number": shared_stem_page_number or page_number,
                    "page_end": page_number,
                    "subject_context": shared_stem_subject_context or current_subject,
                    "allows_trailing_subject_header": line.lstrip().casefold().startswith(
                        "question number"
                    ),
                    "skipping_export_section_values": False,
                    "lines": [*shared_stem_prefix, first_line or ""],
                }
            elif (
                shared_stem is not None
                and current is None
                and (line.strip() or line.strip().casefold() == "question stem")
            ):
                if line.strip().casefold() != "question stem":
                    shared_stem["lines"].append(line)
                shared_stem["page_end"] = page_number
            elif current is not None:
                current["lines"].append(line)
                current["page_end"] = page_number
                if not is_nta_export and loose_heading_re.match(line):
                    suspicious_heading_lines.append(
                        {"page_number": page_number, "text": line.strip()[:240]}
                    )
            elif line.strip() and not is_nta_export:
                unassigned_lines.append(
                    {"page_number": page_number, "text": line.strip()[:240]}
                )
    if shared_stem is not None:
        clear_shared_stem("ended without matching the declared question range")
    finish_current()
    diagnostics = {
        "text_page_count": len(pages),
        "matched_headings": sum(page_heading_counts.values()),
        "pages_with_headings": sorted(page_heading_counts),
        "pages_without_headings": [
            page_number + page_offset
            for page_number in range(1, len(pages) + 1)
            if page_number + page_offset not in page_heading_counts
        ],
        "unassigned_nonempty_lines": len(unassigned_lines),
        "unassigned_characters": sum(len(item["text"]) for item in unassigned_lines),
        "unassigned_pages": sorted({item["page_number"] for item in unassigned_lines}),
        "unassigned_samples": unassigned_lines[:20],
        "suspicious_heading_lines": suspicious_heading_lines[:50],
        "boundary_count": len(boundary_lines),
        "boundary_samples": boundary_lines[:50],
        "subject_header_counts": dict(sorted(subject_header_counts.items())),
        "question_subject_counts": dict(sorted(question_subject_counts.items())),
        "blocking_issues": blocking_issues[:50],
        "review_required": bool(unassigned_lines or suspicious_heading_lines),
    }
    return candidates, diagnostics


def parse_questions_from_text(
    text: str,
    *,
    document_id: str,
    document_sha256: str,
    extraction_method: str,
    page_offset: int = 0,
    question_pattern: str = DEFAULT_QUESTION_PATTERN,
) -> list[dict[str, Any]]:
    """Compatibility wrapper returning only parsed records."""

    questions, _diagnostics = parse_questions_with_diagnostics(
        text,
        document_id=document_id,
        document_sha256=document_sha256,
        extraction_method=extraction_method,
        page_offset=page_offset,
        question_pattern=question_pattern,
    )
    return questions


def extract_document(
    manifest_path: Path,
    questions_path: Path,
    raw_dir: Path,
    document_id: str,
    *,
    pdf_path: Path | None = None,
    text_path: Path | None = None,
    pdftotext_executable: str = "pdftotext",
    extraction_method: str | None = None,
    page_offset: int = 0,
    question_pattern: str = DEFAULT_QUESTION_PATTERN,
) -> dict[str, Any]:
    documents = load_documents(manifest_path)
    document_by_id = {document["document_id"]: document for document in documents}
    document = document_by_id.get(document_id)
    if document is None:
        raise PipelineError(f"document id is absent from the manifest: {document_id}")
    expected_hash = document["sha256"]
    if expected_hash is None:
        raise PipelineError(f"manifest has no SHA-256 for {document_id}; acquire and hash the PDF first")

    source_pdf = pdf_path or raw_dir / f"{document_id}.pdf"
    if not _looks_like_pdf(source_pdf):
        raise PipelineError(f"source is missing or not a PDF: {source_pdf}")
    actual_hash = sha256_file(source_pdf)
    if actual_hash != expected_hash:
        raise PipelineError(
            f"source PDF hash does not match the manifest for {document_id}: {actual_hash}"
        )

    if text_path is not None:
        try:
            text = text_path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise PipelineError(f"missing extracted text file: {text_path}") from exc
        method = extraction_method or "provided-form-feed-text"
    else:
        text = pdf_to_text(source_pdf, pdftotext_executable)
        method = extraction_method or "pdftotext-layout"

    text_page_count = len(_text_pages(text))
    document_page_count = document["artifact"]["page_count"]
    if document_page_count is not None:
        expected_text_pages = document_page_count - page_offset
        if expected_text_pages < 1 or text_page_count != expected_text_pages:
            raise PipelineError(
                f"extracted text maps to {text_page_count} pages with offset {page_offset}, "
                f"but {document_id} requires exactly {expected_text_pages} text pages "
                f"for its {document_page_count} PDF pages"
            )

    candidates, diagnostics = parse_questions_with_diagnostics(
        text,
        document_id=document_id,
        document_sha256=expected_hash,
        extraction_method=method,
        page_offset=page_offset,
        question_pattern=question_pattern,
    )
    if not candidates:
        raise PipelineError(
            "no question headings matched; inspect the extracted text and adjust --question-pattern"
        )
    if diagnostics["blocking_issues"]:
        issue_summary = "; ".join(issue["text"] for issue in diagnostics["blocking_issues"][:3])
        raise PipelineError(
            f"blocking extraction issues for {document_id}: {issue_summary}"
        )

    existing_questions = load_questions(questions_path)
    merged_questions, duplicate_count = deduplicate_questions([*existing_questions, *candidates])
    validate_corpus(documents, merged_questions)
    write_jsonl(questions_path, merged_questions)

    _advance_document_status(document, "extracted")
    validate_corpus(documents, merged_questions)
    write_jsonl(manifest_path, documents)
    return {
        "operation": "extract",
        "document_id": document_id,
        "candidates": len(candidates),
        "merged_duplicates": duplicate_count,
        "total_questions": len(merged_questions),
        "extraction_method": method,
        "diagnostics": diagnostics,
    }


def _load_classification_rules(path: Path) -> list[dict[str, Any]]:
    value = load_json(path)
    if not isinstance(value, dict) or set(value) != {"schema_version", "rules"}:
        raise ValidationError(
            f"{path}: expected exactly schema_version and rules fields"
        )
    if value["schema_version"] != "question-bank-classification-rules/v1":
        raise ValidationError(f"{path}.schema_version: unsupported rules version")
    if not isinstance(value["rules"], list):
        raise ValidationError(f"{path}.rules: expected an array")

    rule_ids: set[str] = set()
    rules: list[dict[str, Any]] = []
    allowed = {
        "id",
        "subject",
        "topic",
        "subtopic",
        "difficulty",
        "keywords_any",
        "keywords_all",
        "priority",
    }
    for index, rule in enumerate(value["rules"]):
        rule_path = f"{path}.rules[{index}]"
        if not isinstance(rule, dict) or set(rule) != allowed:
            raise ValidationError(f"{rule_path}: expected exactly {', '.join(sorted(allowed))}")
        if not isinstance(rule["id"], str) or not rule["id"].strip() or rule["id"] in rule_ids:
            raise ValidationError(f"{rule_path}.id: expected a unique non-empty string")
        rule_ids.add(rule["id"])
        for field in ("topic", "subtopic"):
            if not isinstance(rule[field], str) or not rule[field].strip():
                raise ValidationError(f"{rule_path}.{field}: expected a non-empty string")
        if rule["subject"] is not None and (
            not isinstance(rule["subject"], str) or not rule["subject"].strip()
        ):
            raise ValidationError(f"{rule_path}.subject: expected a non-empty string or null")
        if rule["difficulty"] not in {None, "easy", "medium", "hard"}:
            raise ValidationError(f"{rule_path}.difficulty: expected easy, medium, hard, or null")
        for field in ("keywords_any", "keywords_all"):
            if not isinstance(rule[field], list) or not all(
                isinstance(keyword, str) and keyword.strip() for keyword in rule[field]
            ):
                raise ValidationError(f"{rule_path}.{field}: expected an array of non-empty strings")
        if not rule["keywords_any"] and not rule["keywords_all"]:
            raise ValidationError(f"{rule_path}: at least one keyword is required")
        if not isinstance(rule["priority"], int) or isinstance(rule["priority"], bool):
            raise ValidationError(f"{rule_path}.priority: expected an integer")
        rules.append(rule)
    return rules


def _matching_rule(
    question: dict[str, Any], rules: list[dict[str, Any]], subjects: set[str]
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    haystack = canonical_question_text(question["text"])
    matches: list[tuple[tuple[int, int], dict[str, Any]]] = []
    for rule in rules:
        if rule["subject"] is not None and rule["subject"].casefold() not in subjects:
            continue
        keywords_any = [canonical_question_text(keyword) for keyword in rule["keywords_any"]]
        keywords_all = [canonical_question_text(keyword) for keyword in rule["keywords_all"]]
        if keywords_all and not all(keyword in haystack for keyword in keywords_all):
            continue
        matched_any = sum(keyword in haystack for keyword in keywords_any)
        if keywords_any and matched_any == 0:
            continue
        rank = (rule["priority"], len(keywords_all) + matched_any)
        matches.append((rank, rule))
    if not matches:
        return None, []
    matches.sort(key=lambda item: (item[0], item[1]["id"]), reverse=True)
    top_rank = matches[0][0]
    top_matches = [rule for rank, rule in matches if rank == top_rank]
    outcomes = {
        (rule["topic"], rule["subtopic"], rule["difficulty"]) for rule in top_matches
    }
    if len(outcomes) > 1:
        return None, [
            {
                "rule_id": rule["id"],
                "topic": rule["topic"],
                "subtopic": rule["subtopic"],
                "difficulty": rule["difficulty"],
            }
            for rule in sorted(top_matches, key=lambda item: item["id"])
        ]
    return sorted(top_matches, key=lambda rule: rule["id"])[0], []


def _document_subject_tokens(subject: str) -> set[str]:
    tokens = {subject.casefold().strip()}
    tokens.update(
        part.casefold().strip()
        for part in re.split(r"[,/;+&]", subject)
        if part.strip()
    )
    return tokens


def classify_questions(
    manifest_path: Path,
    questions_path: Path,
    rules_path: Path,
    *,
    overwrite: bool = False,
) -> dict[str, Any]:
    documents = load_documents(manifest_path)
    questions = load_questions(questions_path)
    validate_corpus(documents, questions)
    document_by_id = {document["document_id"]: document for document in documents}
    rules = _load_classification_rules(rules_path)

    classified = 0
    ambiguity_details: list[dict[str, Any]] = []
    unmatched = 0
    context_required = 0
    for question in questions:
        if overwrite and question["status"] != "reviewed":
            question["topic"] = None
            question["subtopic"] = None
            question["difficulty"] = None
            if question["status"] == "classified":
                question["status"] = "extracted"
        subjects: set[str] = set()
        missing_combined_context = False
        for source_ref in question["source_refs"]:
            subject = source_ref["subject_context"]
            if subject is None:
                document_subject = document_by_id[source_ref["document_id"]]["subject"]
                subject_parts = [
                    part.strip()
                    for part in re.split(r"[,/;+&]", document_subject)
                    if part.strip()
                ]
                if len(subject_parts) != 1:
                    missing_combined_context = True
                    continue
                subject = subject_parts[0]
            subjects.update(_document_subject_tokens(subject))
        if not subjects and missing_combined_context:
            context_required += 1
        rule, competing_rules = _matching_rule(question, rules, subjects)
        if competing_rules:
            ambiguity_details.append(
                {"question_id": question["question_id"], "competing_rules": competing_rules}
            )
            continue
        if rule is None:
            unmatched += 1
            continue
        changed = False
        for field in ("topic", "subtopic", "difficulty"):
            value = rule[field]
            if value is not None and (overwrite or question[field] is None):
                if question[field] != value:
                    question[field] = value
                    changed = True
        if changed:
            if question["status"] == "extracted":
                question["status"] = "classified"
            classified += 1

    validate_corpus(documents, questions)
    write_jsonl(questions_path, sorted(questions, key=lambda item: item["question_id"]))
    return {
        "operation": "classify",
        "rules": len(rules),
        "classified": classified,
        "ambiguous": len(ambiguity_details),
        "ambiguities": ambiguity_details,
        "unmatched": unmatched,
        "context_required": context_required,
        "total_questions": len(questions),
    }


_SQLITE_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE documents (
    document_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    provenance_json TEXT NOT NULL,
    year INTEGER NOT NULL,
    exam TEXT NOT NULL,
    session TEXT NOT NULL,
    set_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    source_url TEXT NOT NULL,
    paper_json TEXT NOT NULL,
    artifact_json TEXT NOT NULL,
    sha256 TEXT,
    status TEXT NOT NULL
);

CREATE TABLE questions (
    question_id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    text TEXT NOT NULL,
    content_sha256 TEXT NOT NULL UNIQUE,
    topic TEXT,
    subtopic TEXT,
    difficulty TEXT,
    answer TEXT,
    status TEXT NOT NULL
);

CREATE TABLE question_sources (
    question_id TEXT NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(document_id),
    document_sha256 TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    question_number TEXT NOT NULL,
    subject_context TEXT,
    extraction_method TEXT NOT NULL,
    extracted_text_sha256 TEXT NOT NULL,
    extraction_artifact_sha256s_json TEXT NOT NULL,
    PRIMARY KEY (
        question_id,
        document_id,
        page_number,
        page_end,
        question_number,
        extraction_method,
        extracted_text_sha256
    )
);

CREATE INDEX documents_exam_year_subject_idx ON documents(exam, year, subject);
CREATE INDEX questions_taxonomy_idx ON questions(topic, subtopic, difficulty);
CREATE INDEX question_sources_document_idx ON question_sources(document_id, page_number);
"""


def build_sqlite_database(
    manifest_path: Path, questions_path: Path, database_path: Path
) -> dict[str, Any]:
    documents = load_documents(manifest_path)
    questions = load_questions(questions_path)
    validate_corpus(documents, questions)

    database_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{database_path.name}.", suffix=".tmp", dir=database_path.parent
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(temporary_path)
        with connection:
            connection.executescript(_SQLITE_SCHEMA)
            connection.executemany(
                """
                INSERT INTO documents (
                    document_id, schema_version, provenance_json, year, exam, session,
                    set_name, subject, source_url, paper_json, artifact_json, sha256, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        document["document_id"],
                        document["schema_version"],
                        json.dumps(document["provenance"], ensure_ascii=False, sort_keys=True),
                        document["year"],
                        document["exam"],
                        document["session"],
                        document["set"],
                        document["subject"],
                        document["source_url"],
                        json.dumps(document["paper"], ensure_ascii=False, sort_keys=True),
                        json.dumps(document["artifact"], ensure_ascii=False, sort_keys=True),
                        document["sha256"],
                        document["status"],
                    )
                    for document in documents
                ],
            )
            connection.executemany(
                """
                INSERT INTO questions (
                    question_id, schema_version, text, content_sha256, topic,
                    subtopic, difficulty, answer, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        question["question_id"],
                        question["schema_version"],
                        question["text"],
                        question["content_sha256"],
                        question["topic"],
                        question["subtopic"],
                        question["difficulty"],
                        question["answer"],
                        question["status"],
                    )
                    for question in questions
                ],
            )
            connection.executemany(
                """
                INSERT INTO question_sources (
                    question_id, document_id, document_sha256, page_number, page_end,
                    question_number, subject_context, extraction_method, extracted_text_sha256,
                    extraction_artifact_sha256s_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        question["question_id"],
                        source_ref["document_id"],
                        source_ref["document_sha256"],
                        source_ref["page_number"],
                        source_ref["page_end"],
                        source_ref["question_number"],
                        source_ref["subject_context"],
                        source_ref["extraction_method"],
                        source_ref["extracted_text_sha256"],
                        json.dumps(source_ref["extraction_artifact_sha256s"]),
                    )
                    for question in questions
                    for source_ref in question["source_refs"]
                ],
            )
            connection.executemany(
                "INSERT INTO metadata (key, value) VALUES (?, ?)",
                [
                    ("schema_version", "question-bank-sqlite/v2"),
                    ("document_schema_version", DOCUMENT_SCHEMA_VERSION),
                    ("question_schema_version", QUESTION_SCHEMA_VERSION),
                    (
                        "question_release_status",
                        "reviewed"
                        if questions and all(
                            question["status"] == "reviewed" for question in questions
                        )
                        else "candidate_only",
                    ),
                    (
                        "unreviewed_question_count",
                        str(
                            sum(
                                question["status"] != "reviewed"
                                for question in questions
                            )
                        ),
                    ),
                ],
            )
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise PipelineError(f"SQLite integrity check failed: {integrity}")
        connection.close()
        connection = None
        os.replace(temporary_path, database_path)
    finally:
        if connection is not None:
            connection.close()
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass

    return {
        "operation": "build-db",
        "database": str(database_path),
        "documents": len(documents),
        "questions": len(questions),
        "source_references": sum(len(question["source_refs"]) for question in questions),
    }
