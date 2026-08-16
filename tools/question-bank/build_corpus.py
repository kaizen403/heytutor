#!/usr/bin/env python3
"""Batch-extract, classify, audit, and index a staged question corpus."""

from __future__ import annotations

import argparse
import copy
import hashlib
import itertools
import json
import os
import re
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from question_bank.models import (
    deduplicate_questions,
    load_documents,
    load_questions,
    question_content_sha256,
    sha256_file,
    validate_corpus,
    validate_question,
    write_jsonl,
)
from question_bank.pipeline import (
    DEFAULT_QUESTION_PATTERN,
    build_sqlite_database,
    classify_questions,
    parse_questions_with_diagnostics,
    pdf_to_text,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
NTA_QUESTION_PATTERN = (
    r"^\s*(?:Question\s+Number\s*[:.]?\s*|Q\s*[:.]\s*)(?P<number>\d{1,3})\b"
    r".*$"
)
_NTA_OPTIONS_HEADER_RE = re.compile(r"(?im)^\s*Options?\s*:\s*$")
_ENGLISH_SIGNAL_WORDS = {
    "calculate",
    "derive",
    "determine",
    "equation",
    "find",
    "following",
    "given",
    "show",
    "state",
    "the",
    "value",
    "what",
    "which",
}
_SUBJECT_EVIDENCE = {
    "Mathematics": (
        "function", "matrix", "polynomial", "integral", "derivative", "triangle",
        "circle", "parabola", "ellipse", "complex", "real roots", "probability",
        "coordinate", "equation", "sequence", "determinant", "vector", "plane", "point",
    ),
    "Physics": (
        "mass", "velocity", "acceleration", "force", "magnetic", "electric", "current",
        "circuit", "resistance", "capacitor", "inductor", "charge", "field", "light",
        "lens", "momentum", "energy", "temperature", "pressure",
    ),
    "Chemistry": (
        "molecule", "compound", "reaction", "aqueous", "acid", "base", "moles", "atom",
        "element", "organic", "hydrolysis", "catalyst", "concentration", "chemical", "bond",
        "oxidation", "reduction", "ester", "species", "metal",
    ),
}
_END_PAPER_RE = re.compile(
    r"^\s*END\s+OF\s+(?:THE\s+)?QUESTION\s+PAPER\s*[.!-]*\s*$",
    re.IGNORECASE | re.MULTILINE,
)


class BuildError(RuntimeError):
    """Raised when the batch cannot preserve a document's provenance."""


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


def _page_count(text: str) -> int:
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return len(pages)


def _stored_text_method(document: dict[str, Any]) -> str | None:
    notes = document["provenance"]["notes"]
    if not notes:
        return None
    try:
        value = json.loads(notes)
    except json.JSONDecodeError:
        return None
    method = value.get("staged_text_method") if isinstance(value, dict) else None
    return method if isinstance(method, str) and method else None


def _detect_text_method(document: dict[str, Any], pdf_path: Path, text: str) -> str:
    stored = _stored_text_method(document)
    if stored and not stored.startswith("pdftotext"):
        return stored
    try:
        native_text = pdf_to_text(pdf_path)
    except Exception:
        return "tesseract-ocr-eng-fast-v1"
    native_hash = hashlib.sha256(native_text.encode("utf-8")).hexdigest()
    staged_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if native_hash == staged_hash:
        return stored or "pdftotext-layout"
    return "tesseract-ocr-eng-fast-v1"


def _question_pattern_for_document(
    document: dict[str, Any], requested_pattern: str
) -> str:
    if requested_pattern == DEFAULT_QUESTION_PATTERN and document["exam"] == "JEE Main":
        return NTA_QUESTION_PATTERN
    return requested_pattern


def _english_candidate_score(question: dict[str, Any]) -> tuple[int, float]:
    tokens = re.findall(r"[a-z]+", question["text"].casefold())
    signals = sum(token in _ENGLISH_SIGNAL_WORDS for token in tokens)
    ascii_letters = sum(character.isascii() and character.isalpha() for character in question["text"])
    alphabetic = sum(character.isalpha() for character in question["text"])
    return signals, ascii_letters / max(alphabetic, 1)


def _cbse_non_english_corruption_count(question: dict[str, Any]) -> int:
    """Count extraction artifacts that cannot be legitimate Adobe math symbols.

    Some CBSE bilingual booklets expose Hindi glyphs as E000-EFFF private-use
    characters.  F000/F8xx private-use characters are deliberately excluded:
    older Mathematics PDFs use those ranges for Symbol-font operators and
    scalable delimiters, so treating all private-use glyphs alike would select
    the wrong language occurrence.
    """

    return sum(
        character == "\ufffd"
        or 0x80 <= ord(character) <= 0x9F
        or 0xE000 <= ord(character) <= 0xEFFF
        for character in question["text"]
    )


_CBSE_ENGLISH_CONTENT_CUE_RE = re.compile(
    r"\b(?:calculate|derive|determine|differentiate|equation|evaluate|find|"
    r"integrate|prove|show|solve|state|value|what|which)\b",
    re.IGNORECASE,
)
_CBSE_READABLE_RESIDUE_TOKEN_RE = re.compile(
    r"[A-Za-z]+|\d+(?:\.\d+)?|[=+*/|^<>]"
)


def _cbse_readable_residue_tokens(text: str) -> set[str]:
    return {
        token.casefold()
        for token in _CBSE_READABLE_RESIDUE_TOKEN_RE.findall(text)
    }


def _strip_cbse_unreadable_pua_lines(text: str) -> str:
    """Remove corrupt glyphs without discarding unique readable formula text."""

    lines = text.splitlines()
    clean_lines = [
        line
        for line in lines
        if not any(0xE000 <= ord(character) <= 0xEFFF for character in line)
    ]
    clean_tokens = _cbse_readable_residue_tokens("\n".join(clean_lines))
    sanitized_lines: list[str] = []
    for line in lines:
        if not any(0xE000 <= ord(character) <= 0xEFFF for character in line):
            sanitized_lines.append(line)
            continue
        residue = re.sub(
            r"[ \t]+",
            " ",
            "".join(
                character
                for character in line
                if not 0xE000 <= ord(character) <= 0xEFFF
            ),
        ).strip()
        residue_tokens = _cbse_readable_residue_tokens(residue)
        if residue_tokens and not residue_tokens.issubset(clean_tokens):
            sanitized_lines.append(residue)
    return "\n".join(sanitized_lines).strip()


def _sanitize_cbse_english_occurrence(question: dict[str, Any]) -> dict[str, Any]:
    """Drop unreadable Hindi custom-font lines only when English remains usable.

    Official English CBSE booklets often interleave a Hindi rendering whose
    legacy font extracts into E000-EFFF PUA.  The raw staged artifact remains
    untouched; this removes only those unreadable lines from the selected
    English occurrence and updates all content-derived hashes.
    """

    original_text = question["text"]
    if not any(0xE000 <= ord(character) <= 0xEFFF for character in original_text):
        return question
    cleaned_text = _strip_cbse_unreadable_pua_lines(original_text)
    if not cleaned_text:
        return question
    removed_ratio = (len(original_text) - len(cleaned_text)) / len(original_text)
    ascii_words = re.findall(r"[A-Za-z]{2,}", cleaned_text)
    alphabetic = sum(character.isalpha() for character in cleaned_text)
    ascii_alphabetic = sum(
        character.isascii() and character.isalpha() for character in cleaned_text
    )
    has_usable_english = (
        _CBSE_ENGLISH_CONTENT_CUE_RE.search(cleaned_text) is not None
        or len(ascii_words) >= 5
    )
    if (
        not has_usable_english
        or ascii_alphabetic < 4
        or ascii_alphabetic / max(alphabetic, 1) < 0.65
        or removed_ratio >= 0.9
    ):
        return question

    sanitized = copy.deepcopy(question)
    sanitized["text"] = cleaned_text
    content_hash = question_content_sha256(cleaned_text)
    sanitized["content_sha256"] = content_hash
    sanitized["question_id"] = f"q_{content_hash}"
    extracted_text_hash = hashlib.sha256(cleaned_text.encode("utf-8")).hexdigest()
    for source_ref in sanitized["source_refs"]:
        source_ref["extracted_text_sha256"] = extracted_text_hash
    validate_question(sanitized)
    return sanitized


def _infer_three_subject_page_segments(text: str) -> dict[str, Any] | None:
    """Infer three whole-paper subject blocks only when evidence is decisive."""

    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    ranges: list[tuple[int, int, str]] = []
    start_page = 1
    segment_text: list[str] = []
    for page_number, page in enumerate(pages, start=1):
        segment_text.append(page)
        if _END_PAPER_RE.search(page):
            ranges.append((start_page, page_number, "\n".join(segment_text)))
            start_page = page_number + 1
            segment_text = []
    if segment_text and any(part.strip() for part in segment_text):
        ranges.append((start_page, len(pages), "\n".join(segment_text)))
    if len(ranges) != 3:
        return None

    scores: list[dict[str, int]] = []
    for _start, _end, segment in ranges:
        haystack = segment.casefold()
        scores.append(
            {
                subject: sum(
                    len(re.findall(rf"\b{re.escape(keyword)}\b", haystack))
                    for keyword in keywords
                )
                for subject, keywords in _SUBJECT_EVIDENCE.items()
            }
        )
    ranked: list[tuple[int, tuple[str, ...]]] = []
    for assignment in itertools.permutations(_SUBJECT_EVIDENCE):
        ranked.append(
            (sum(scores[index][subject] for index, subject in enumerate(assignment)), assignment)
        )
    ranked.sort(reverse=True)
    best_total, assignment = ranked[0]
    second_total = ranked[1][0]
    if best_total - second_total < 20:
        return None
    if any(scores[index][subject] < 15 for index, subject in enumerate(assignment)):
        return None
    return {
        "method": "three-end-delimited-segments-lexical-assignment/v1",
        "assignment_margin": best_total - second_total,
        "segments": [
            {
                "page_start": start,
                "page_end": end,
                "subject": assignment[index],
                "scores": scores[index],
            }
            for index, (start, end, _segment) in enumerate(ranges)
        ],
    }


def _apply_subject_segment_inference(
    document: dict[str, Any], text: str, questions: list[dict[str, Any]]
) -> dict[str, Any] | None:
    subject_parts = {
        part.strip()
        for part in re.split(r"[,/;+&]", document["subject"])
        if part.strip()
    }
    if (
        document["exam"] != "JEE Advanced"
        or subject_parts != set(_SUBJECT_EVIDENCE)
        or any(
            source_ref["subject_context"] is not None
            for question in questions
            for source_ref in question["source_refs"]
        )
    ):
        return None
    inference = _infer_three_subject_page_segments(text)
    if inference is None:
        return None
    for question in questions:
        for source_ref in question["source_refs"]:
            matching = [
                segment
                for segment in inference["segments"]
                if segment["page_start"] <= source_ref["page_number"]
                and source_ref["page_end"] <= segment["page_end"]
            ]
            if len(matching) == 1:
                source_ref["subject_context"] = matching[0]["subject"]
    return inference


def _apply_nta_subject_numbering(
    document: dict[str, Any], questions: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Assign PCM context from NTA's document-global question numbering."""

    subject_parts = {
        part.strip()
        for part in re.split(r"[,/;+&]", document["subject"])
        if part.strip()
    }
    if (
        document["exam"] != "JEE Main"
        or subject_parts != set(_SUBJECT_EVIDENCE)
        or not questions
    ):
        return None
    numbers: list[int] = []
    for question in questions:
        number = question["source_refs"][0]["question_number"]
        if not number.isdigit():
            return None
        numbers.append(int(number))
    maximum = max(numbers)
    if maximum == 75:
        block_size = 25
    elif maximum == 90:
        block_size = 30
    else:
        return None
    subjects = ("Mathematics", "Physics", "Chemistry")
    counts = Counter()
    for question, number in zip(questions, numbers):
        if number < 1 or number > block_size * len(subjects):
            return None
        subject = subjects[(number - 1) // block_size]
        for source_ref in question["source_refs"]:
            source_ref["subject_context"] = subject
        counts[subject] += 1
    return {
        "method": "nta-global-question-numbering/v1",
        "maximum_question_number": maximum,
        "subject_block_size": block_size,
        "question_subject_counts": dict(sorted(counts.items())),
    }


def _select_cbse_english_variants(
    document: dict[str, Any], questions: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    """Choose one English occurrence per subject and displayed question number."""

    if document["exam"] not in {"CBSE Class XII Board Examination", "JEE Main"}:
        return questions, 0
    grouped: dict[tuple[str | None, str], list[tuple[int, dict[str, Any]]]] = {}
    for index, question in enumerate(questions):
        source_ref = question["source_refs"][0]
        key = (source_ref["subject_context"], source_ref["question_number"])
        grouped.setdefault(key, []).append((index, question))
    selected: list[tuple[int, dict[str, Any]]] = []
    discarded = 0
    for occurrences in grouped.values():
        if len(occurrences) == 1:
            index, question = occurrences[0]
            winner = (
                _sanitize_cbse_english_occurrence(question)
                if document["exam"] == "CBSE Class XII Board Examination"
                else question
            )
            selected.append((index, winner))
            continue
        # Standard CBSE bilingual booklets print Hindi first and English second;
        # the lexical score handles OCR ordering anomalies, while the occurrence
        # index provides that documented order as the deterministic tie-breaker.
        winner = max(
            occurrences,
            key=lambda item: (
                -_cbse_non_english_corruption_count(item[1]),
                *_english_candidate_score(item[1]),
                item[0],
            ),
        )
        selected_question = (
            _sanitize_cbse_english_occurrence(winner[1])
            if document["exam"] == "CBSE Class XII Board Examination"
            else winner[1]
        )
        selected.append((winner[0], selected_question))
        discarded += len(occurrences) - 1
    return [question for _, question in sorted(selected)], discarded


def _expected_nta_unique_question_count(document: dict[str, Any]) -> int | None:
    if document["exam"] != "JEE Main":
        return None
    year = document["year"]
    if year == 2020 or year >= 2025:
        return 75
    if year == 2019 or 2021 <= year <= 2024:
        return 90
    return None


def _validate_nta_unique_question_coverage(
    document: dict[str, Any], questions: list[dict[str, Any]]
) -> None:
    expected = _expected_nta_unique_question_count(document)
    if expected is None:
        return
    unique_numbers = {
        question["source_refs"][0]["question_number"] for question in questions
    }
    if len(unique_numbers) != expected:
        raise BuildError(
            f"NTA unique question coverage mismatch: {len(unique_numbers)} != {expected}"
        )
    substantive = 0
    for question in questions:
        stem = _NTA_OPTIONS_HEADER_RE.split(question["text"], maxsplit=1)[0]
        visible = re.sub(r"[^A-Za-z0-9]+", "", stem)
        if len(visible) >= 8:
            substantive += 1
    minimum_substantive = (expected * 95 + 99) // 100
    if substantive < minimum_substantive:
        raise BuildError(
            "NTA substantive question coverage mismatch: "
            f"{substantive} < {minimum_substantive}"
        )


def _summary_counts(
    questions: list[dict[str, Any]], documents_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    by_topic = Counter()
    by_subtopic = Counter()
    by_exam = Counter()
    by_year = Counter()
    for question in questions:
        by_topic[question["topic"] or "unclassified"] += 1
        by_subtopic[question["subtopic"] or "unclassified"] += 1
        occurrences = {
            source_ref["document_id"] for source_ref in question["source_refs"]
        }
        for document_id in occurrences:
            document = documents_by_id[document_id]
            by_exam[document["exam"]] += 1
            by_year[str(document["year"])] += 1
    return {
        "by_topic": dict(sorted(by_topic.items())),
        "by_subtopic": dict(sorted(by_subtopic.items())),
        "source_occurrences_by_exam": dict(sorted(by_exam.items())),
        "source_occurrences_by_year": dict(sorted(by_year.items())),
    }


def build_corpus(
    manifest_path: Path,
    raw_dir: Path,
    text_dir: Path,
    rules_path: Path,
    all_questions_path: Path,
    target_questions_path: Path,
    database_path: Path,
    *,
    question_pattern: str = DEFAULT_QUESTION_PATTERN,
    allow_segmentation_review: bool = False,
) -> dict[str, Any]:
    documents = load_documents(manifest_path)
    candidates: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    review_documents: list[dict[str, Any]] = []
    subject_context_audit: list[dict[str, Any]] = []
    subject_context_counts = Counter()
    extraction_methods = Counter()
    discarded_language_variants = 0
    succeeded_ids: set[str] = set()

    for document in documents:
        document_id = document["document_id"]
        pdf_path = raw_dir / f"{document_id}.pdf"
        text_path = text_dir / f"{document_id}.txt"
        try:
            if not pdf_path.is_file():
                raise BuildError("raw PDF is missing")
            actual_hash = sha256_file(pdf_path)
            if actual_hash != document["sha256"]:
                raise BuildError(
                    f"PDF hash mismatch: manifest={document['sha256']} actual={actual_hash}"
                )
            if not text_path.is_file():
                raise BuildError("page-delimited extraction text is missing")
            text = text_path.read_text(encoding="utf-8")
            text_pages = _page_count(text)
            pdf_pages = document["artifact"]["page_count"]
            if pdf_pages is not None and text_pages != pdf_pages:
                raise BuildError(
                    f"page mapping mismatch: PDF={pdf_pages}, extraction={text_pages}"
                )
            method = _detect_text_method(document, pdf_path, text)
            parsed, diagnostics = parse_questions_with_diagnostics(
                text,
                document_id=document_id,
                document_sha256=document["sha256"],
                extraction_method=method,
                question_pattern=_question_pattern_for_document(
                    document, question_pattern
                ),
            )
            if not parsed:
                raise BuildError("no question headings matched")
            subject_inference = _apply_nta_subject_numbering(document, parsed)
            if subject_inference is None:
                subject_inference = _apply_subject_segment_inference(
                    document, text, parsed
                )
            if subject_inference is not None:
                diagnostics["subject_context_inference"] = subject_inference
                inferred_counts = Counter(
                    question["source_refs"][0]["subject_context"] or "unknown"
                    for question in parsed
                )
                diagnostics["question_subject_counts"] = dict(sorted(inferred_counts.items()))
            parsed, discarded = _select_cbse_english_variants(document, parsed)
            _validate_nta_unique_question_coverage(document, parsed)
            discarded_language_variants += discarded
            selected_subject_counts = Counter(
                question["source_refs"][0]["subject_context"] or "unknown"
                for question in parsed
            )
            diagnostics["question_subject_counts"] = dict(
                sorted(selected_subject_counts.items())
            )
            for question in parsed:
                context = question["source_refs"][0]["subject_context"]
                subject_context_counts[context or "unknown"] += 1
            document_subject_parts = [
                part.strip()
                for part in re.split(r"[,/;+&]", document["subject"])
                if part.strip()
            ]
            if len(document_subject_parts) > 1 or diagnostics["subject_header_counts"]:
                subject_context_audit.append(
                    {
                        "document_id": document_id,
                        "boundary_count": diagnostics["boundary_count"],
                        "boundary_samples": diagnostics["boundary_samples"][:10],
                        "subject_header_counts": diagnostics["subject_header_counts"],
                        "question_subject_counts": diagnostics["question_subject_counts"],
                        "subject_context_inference": diagnostics.get(
                            "subject_context_inference"
                        ),
                    }
                )
            candidates.extend(parsed)
            succeeded_ids.add(document_id)
            extraction_methods[method] += 1
            if diagnostics["review_required"]:
                review_documents.append(
                    {
                        "document_id": document_id,
                        "matched_headings": diagnostics["matched_headings"],
                        "unassigned_nonempty_lines": diagnostics[
                            "unassigned_nonempty_lines"
                        ],
                        "unassigned_pages": diagnostics["unassigned_pages"],
                        "suspicious_heading_count": len(
                            diagnostics["suspicious_heading_lines"]
                        ),
                    }
                )
        except (BuildError, OSError, ValueError) as exc:
            failures.append({"document_id": document_id, "error": str(exc)})

    if review_documents and not allow_segmentation_review:
        raise BuildError(
            f"{len(review_documents)} documents require segmentation review; "
            "rerun with --allow-segmentation-review "
            "to build an explicitly provisional database"
        )

    deduplicated, duplicate_count = deduplicate_questions(candidates)
    for document in documents:
        if document["document_id"] in succeeded_ids:
            document["status"] = "extracted"
        elif document["status"] != "reviewed":
            document["status"] = "failed"
    validate_corpus(documents, deduplicated)
    write_jsonl(manifest_path, sorted(documents, key=lambda item: item["document_id"]))
    write_jsonl(all_questions_path, deduplicated)

    classification = classify_questions(
        manifest_path, all_questions_path, rules_path, overwrite=True
    )
    classified_questions = load_questions(all_questions_path)
    target_questions = [
        question
        for question in classified_questions
        if question["topic"]
        in {
            "Three-Dimensional Geometry",
            "Electromagnetic Induction and Alternating Currents",
        }
    ]
    validate_corpus(documents, target_questions)
    write_jsonl(target_questions_path, target_questions)
    database = build_sqlite_database(manifest_path, target_questions_path, database_path)
    documents_by_id = {document["document_id"]: document for document in documents}

    return {
        "operation": "build-corpus",
        "release_status": "candidate_only"
        if any(question["status"] != "reviewed" for question in target_questions)
        or failures
        or review_documents
        else "reviewed",
        "segmentation_review_accepted": allow_segmentation_review,
        "documents": len(documents),
        "documents_extracted": len(succeeded_ids),
        "documents_failed": len(failures),
        "failures": failures,
        "documents_requiring_segmentation_review": len(review_documents),
        "segmentation_review": review_documents,
        "extraction_methods": dict(sorted(extraction_methods.items())),
        "discarded_bilingual_question_variants": discarded_language_variants,
        "subject_context": {
            "candidate_counts": dict(sorted(subject_context_counts.items())),
            "documents": subject_context_audit,
        },
        "raw_question_candidates": len(candidates),
        "exact_duplicate_candidates_merged": duplicate_count,
        "deduplicated_questions": len(deduplicated),
        "target_questions": len(target_questions),
        "classification": classification,
        "target_summary": _summary_counts(target_questions, documents_by_id),
        "database": database,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DATA_ROOT / "manifest.jsonl")
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--text-dir", type=Path, required=True)
    parser.add_argument(
        "--rules", type=Path, default=DATA_ROOT / "classification-rules.json"
    )
    parser.add_argument("--all-questions", type=Path, required=True)
    parser.add_argument("--target-questions", type=Path, required=True)
    parser.add_argument(
        "--database", type=Path, default=DATA_ROOT / "build" / "question-bank.sqlite"
    )
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--question-pattern", default=DEFAULT_QUESTION_PATTERN)
    parser.add_argument(
        "--allow-segmentation-review",
        action="store_true",
        help=(
            "build a candidate-only database even when splitter diagnostics require review"
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = build_corpus(
            args.manifest,
            args.raw_dir,
            args.text_dir,
            args.rules,
            args.all_questions,
            args.target_questions,
            args.database,
            question_pattern=args.question_pattern,
            allow_segmentation_review=args.allow_segmentation_review,
        )
        _atomic_json(args.report, result)
        print(json.dumps({**result, "report": str(args.report)}, indent=2, sort_keys=True))
        return 0
    except (BuildError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=os.sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
