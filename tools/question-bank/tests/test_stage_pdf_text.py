from __future__ import annotations


import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from question_bank.models import load_documents, write_jsonl
from stage_pdf_text import (
    FatalStageError,
    StageError,
    _NTA_QUESTION_HEADER_RE,
    _has_disallowed_corruption,
    _is_metadata_heavy_nta_export,
    _is_math_heavy,
    _nta_export_quality,
    _ocr_page,
    _render_pdf_pages,
    _structural_markers,
    _validate_nta_ocr_improvement,
    needs_ocr,
    stage_text,
    text_pages,
)


def _document(document_id: str, *, page_count: int) -> dict[str, object]:
    return {
        "schema_version": "question-bank-document/v2",
        "document_id": document_id,
        "provenance": {
            "publisher": "Example board",
            "source_type": "official",
            "retrieved_at": "2026-08-10T00:00:00Z",
            "notes": None,
        },
        "year": 2026,
        "exam": "Example Exam",
        "session": "main",
        "set": "A",
        "subject": "Mathematics",
        "source_url": f"https://example.invalid/{document_id}.pdf",
        "paper": {
            "stage": "main",
            "paper_number": "1",
            "exam_date": None,
            "shift": None,
            "mode": "offline",
            "language": "English",
            "accessibility_variant": "standard",
        },
        "artifact": {
            "media_type": "application/pdf",
            "page_count": page_count,
            "container_url": None,
            "container_sha256": None,
            "member_path": None,
        },
        "sha256": "a" * 64,
        "status": "acquired",
    }


class StagePdfTextTests(unittest.TestCase):
    def test_text_pages_ignores_only_trailing_form_feed(self) -> None:
        self.assertEqual(text_pages("first\fsecond\f"), ["first", "second"])

    def test_ocr_is_required_for_empty_or_page_mismatched_text(self) -> None:
        self.assertTrue(needs_ocr("", 2, 20))
        self.assertTrue(needs_ocr("enough characters for one page", 2, 20))
        self.assertFalse(needs_ocr("enough characters for one page", 1, 20))

    def test_nta_metadata_heavy_export_is_detected_for_forced_ocr(self) -> None:
        sample = (
            "Question Number : 1 Question Id : 10001 Question Type : MCQ\n"
            "Question Mandatory : No\nCorrect Marks : 4 Wrong Marks : 1\n"
            "Options :\n100001.\n100002.\n100003.\n100004.\n"
        ) * 12
        self.assertTrue(_is_metadata_heavy_nta_export(sample))

    def test_nta_complete_numbering_with_image_only_bodies_is_detected_for_forced_ocr(self) -> None:
        sample = "\n".join(
            [
                "\n".join(
                    [
                        f"Question Number : {number} Question Id : {10000 + number} Question Type : MCQ",
                        "Option Shuffling : Yes Display Question Number : Yes",
                        "Question Mandatory : No Single Line Question Option : No",
                        "Option Orientation : Vertical",
                        f"Question Image : q{number}.png",
                        "Options :",
                        "100001.",
                        "100002.",
                        "100003.",
                        "100004.",
                    ]
                )
                for number in range(1, 76)
            ]
        )

        self.assertTrue(_is_metadata_heavy_nta_export(sample))

    def test_nta_legacy_q_colon_image_only_export_is_detected_for_forced_ocr(self) -> None:
        sample = "\n".join(
            "\n".join(
                [
                    f"Q:{number}",
                    f"Topic Name:{'Mathematics' if number <= 30 else 'Physics'}-Section A",
                    f"ItemCode:{101660 + number}",
                    "Question:",
                    "A",
                    "B",
                    "C",
                    "D",
                ]
            )
            for number in range(1, 91)
        )

        self.assertTrue(_is_metadata_heavy_nta_export(sample))

    def test_nta_legacy_q_colon_headers_after_form_feed_still_count(self) -> None:
        sample = "Q:20\nTopic Name:Mathematics-Section A\nQuestion:\nA\nB\nC\nD\fQ:21\nTopic Name:Mathematics-Section B\nQuestion:\nA\nB\nC\nD\n"
        quality = _nta_export_quality(sample)
        self.assertEqual(quality["unique_question_numbers"], 2)
        self.assertEqual(
            {int(match.group("number")) for match in _NTA_QUESTION_HEADER_RE.finditer(sample)},
            {20, 21},
        )

    def test_nta_ocr_allows_small_unique_number_drop_when_stems_are_recovered(self) -> None:
        native = "\n".join(
            f"Q:{number}\nTopic Name:Physics-Section A\nQuestion:\nA\nB\nC\nD"
            for number in range(1, 91)
        )
        ocr = "\n".join(
            f"Q:{number}\nLet the measured field at point P for case {number} be E."
            for number in range(1, 82)
        )
        _validate_nta_ocr_improvement(native, ocr)

    def test_nta_legacy_q_colon_export_with_real_stems_stays_native(self) -> None:
        sample = "\n".join(
            "\n".join(
                [
                    f"Q:{number}",
                    "Topic Name:Physics-Section A",
                    f"ItemCode:{101660 + number}",
                    f"Question: Calculate the magnetic field at point P for case {number}.",
                    "A First physical answer",
                    "B Second physical answer",
                    "C Third physical answer",
                    "D Fourth physical answer",
                ]
            )
            for number in range(1, 13)
        )

        self.assertFalse(_is_metadata_heavy_nta_export(sample))

    def test_nta_bilingual_metadata_only_export_is_detected_for_forced_ocr(self) -> None:
        sample = "\n".join(
            "\n".join(
                [
                    f"Question Number : {number} Question Id : {language}{number:02d} Question Type : MCQ",
                    "Number : Yes Is Question Mandatory : No",
                    "Response Time : N.A Think Time : N.A Minimum Instruction Time : 0",
                    "Response Type : Numeric",
                    "Evaluation Required For SA : Yes",
                    "Show Word Count : Yes",
                    "Answers Type : Equal",
                    "Text Areas : PlainText",
                    "Possible Answers :",
                    "https://g28.tcsion.com/CAE/pdf-preview 1/66",
                    "4/2/25, 9:41 PM Online Question Paper PDF Preview",
                    "Mathematics Section A",
                    "Option Shuffling : Yes Display Question Number : Yes",
                    "Question Mandatory : No",
                    "Options :",
                    "100001.",
                    "100002.",
                    "100003.",
                    "100004.",
                ]
            )
            for language in (1, 2)
            for number in range(1, 13)
        )

        self.assertTrue(_is_metadata_heavy_nta_export(sample))

    def test_healthy_nta_export_with_substantive_bodies_does_not_force_ocr(self) -> None:
        sample = "\n".join(
            [
                "\n".join(
                    [
                        f"Question Number : {number} Question Id : {10000 + number} Question Type : MCQ",
                        "Option Shuffling : Yes Display Question Number : Yes",
                        "Question Mandatory : No Single Line Question Option : No",
                        "Option Orientation : Vertical",
                        f"Find the value of x + {number} using the given relation.",
                        "100001.",
                        "100002.",
                        "100003.",
                        "100004.",
                    ]
                )
                for number in range(1, 13)
            ]
        )

        self.assertFalse(_is_metadata_heavy_nta_export(sample))

    def test_nta_export_with_missing_global_question_numbers_forces_ocr(self) -> None:
        sample = "\n".join(
            [
                f"Question Number : {number} Question Id : {10000 + number}"
                for number in [*range(1, 11), 75]
            ]
        )

        self.assertTrue(_is_metadata_heavy_nta_export(sample))

    def test_nta_ocr_must_recover_substantive_question_bodies(self) -> None:
        metadata_only = "\n".join(
            f"Question Number : {number} Question Id : {10000 + number} "
            "Question Type : MCQ\nOptions :\n100001.\n100002.\n100003.\n100004."
            for number in range(1, 76)
        )

        with self.assertRaisesRegex(StageError, "substantive question coverage"):
            _validate_nta_ocr_improvement(metadata_only, metadata_only)

    def test_document_mode_forces_ocr_for_metadata_only_nta_export(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            document = _document("doc-nta-bad", page_count=1)
            document["exam"] = "JEE Main"
            write_jsonl(manifest_path, [document])
            (raw_dir / "doc-nta-bad.pdf").write_bytes(b"%PDF-1.4\n")
            native = "\n".join(
                [
                    "\n".join(
                        [
                            f"Question Number : {number} Question Id : {10000 + number} Question Type : MCQ",
                            "Option Shuffling : Yes Display Question Number : Yes",
                            "Question Mandatory : No Single Line Question Option : No",
                            "Option Orientation : Vertical",
                            f"Question Image : q{number}.png",
                            "Options :",
                            "100001.",
                            "100002.",
                            "100003.",
                            "100004.",
                        ]
                    )
                    for number in range(1, 76)
                ]
            )
            recovered = "\n".join(
                f"Question Number : {number}\nFind the value of x + {number}."
                for number in range(1, 76)
            ) + "\f"

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=native),
                patch("stage_pdf_text.ocr_pdf", return_value=recovered) as mock_ocr_pdf,
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=Path("/tmp"),
                    ocr_mode="document",
                )

            self.assertEqual(result["methods"], {"tesseract-ocr-eng-fast-v1": 1})
            self.assertTrue(mock_ocr_pdf.called)
            self.assertEqual(
                (text_dir / "doc-nta-bad.txt").read_text(encoding="utf-8"),
                recovered,
            )

    def test_document_mode_rejects_nta_ocr_that_loses_question_numbers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            document = _document("doc-nta-incomplete-ocr", page_count=1)
            document["exam"] = "JEE Main"
            write_jsonl(manifest_path, [document])
            (raw_dir / "doc-nta-incomplete-ocr.pdf").write_bytes(b"%PDF-1.4\n")
            native = "\n".join(
                f"Question Number : {number} Question Id : {10000 + number} "
                "Question Type : MCQ\nOptions :\n100001.\n100002.\n100003.\n100004."
                for number in range(1, 76)
            )
            incomplete_ocr = "\n".join(
                f"Question Number : {number}\nFind the value of x + {number}."
                for number in range(1, 61)
            ) + "\f"

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=native),
                patch("stage_pdf_text.ocr_pdf", return_value=incomplete_ocr),
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=Path("/tmp"),
                    ocr_mode="document",
                )

            self.assertEqual(result["written"], 0)
            self.assertEqual(result["methods"], {})
            self.assertEqual(len(result["failures"]), 1)
            self.assertIn("lost question-number coverage", result["failures"][0]["error"])
            self.assertFalse((text_dir / "doc-nta-incomplete-ocr.txt").exists())

    def test_document_mode_keeps_healthy_nta_export_native(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            document = _document("doc-nta-good", page_count=1)
            document["exam"] = "JEE Main"
            write_jsonl(manifest_path, [document])
            (raw_dir / "doc-nta-good.pdf").write_bytes(b"%PDF-1.4\n")
            native = "\n".join(
                [
                    "\n".join(
                        [
                            f"Question Number : {number} Question Id : {10000 + number} Question Type : MCQ",
                            "Option Shuffling : Yes Display Question Number : Yes",
                            "Question Mandatory : No Single Line Question Option : No",
                            "Option Orientation : Vertical",
                            f"Find the value of x + {number} using the given relation.",
                            "100001.",
                            "100002.",
                            "100003.",
                            "100004.",
                        ]
                    )
                    for number in range(1, 13)
                ]
            )

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=native),
                patch("stage_pdf_text.ocr_pdf") as mock_ocr_pdf,
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=Path("/tmp"),
                    ocr_mode="document",
                )

            self.assertEqual(result["methods"], {"pdftotext-layout": 1})
            self.assertFalse(mock_ocr_pdf.called)
            self.assertEqual(
                (text_dir / "doc-nta-good.txt").read_text(encoding="utf-8"),
                native,
            )

    def test_document_ocr_preserves_blank_pages(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-ocr", page_count=3)])
            (raw_dir / "doc-ocr.pdf").write_bytes(b"%PDF-1.4\n")

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=""),
                patch(
                    "stage_pdf_text.ocr_pdf",
                    return_value="Question body.\f\fNext page.\f",
                ),
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=Path("/tmp"),
                    ocr_mode="document",
                )

            self.assertEqual(result["methods"], {"tesseract-ocr-eng-fast-v1": 1})
            self.assertEqual(
                text_pages((text_dir / "doc-ocr.txt").read_text()),
                ["Question body.", "", "Next page."],
            )

    def test_ocr_page_accepts_empty_output_only_for_known_blank_native_page(self) -> None:
        class _Result:
            returncode = 0
            stdout = ""
            stderr = ""

        with patch("stage_pdf_text.subprocess.run", return_value=_Result()):
            self.assertEqual(
                _ocr_page(
                    Path("blank.jpg"),
                    tesseract="tesseract",
                    tessdata_dir=None,
                    allow_empty=True,
                ),
                "",
            )
            with self.assertRaisesRegex(StageError, "tesseract produced no text"):
                _ocr_page(
                    Path("unexplained-empty.jpg"),
                    tesseract="tesseract",
                    tessdata_dir=None,
                    allow_empty=False,
                )

    def test_structural_markers_ignore_bare_page_numbers(self) -> None:
        self.assertEqual(
            _structural_markers(
                "\n".join(
                    [
                        "3",
                        "65/2/3        *                                       2                                          {}",
                        "1. Actual question heading",
                        "Q. 2 Actual prefixed heading",
                    ]
                )
            ),
            ["question:1", "question:2"],
        )

    def test_hybrid_replaces_only_corrupt_pages_and_preserves_clean_pages(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-a", page_count=2)])
            (raw_dir / "doc-a.pdf").write_bytes(b"%PDF-1.4\n")
            native = (
                "Q.1 Keep this exact native page.\n"
                "All clean content stays untouched.\f"
                "Bad \ufffd page\n"
                "Q.2 Find 3 + 4.\n"
            )
            ocr_pages = [
                "unused clean page",
                "Bad page\nQ.2 Find 3 + 4.\n",
            ]

            def fake_ocr_pdf_pages(
                _pdf_path,
                *,
                page_numbers,
                expected_pages,
                workers,
                dpi,
                tessdata_dir,
            ):
                self.assertEqual(page_numbers, [2])
                self.assertEqual(expected_pages, 2)
                return {2: ocr_pages[1]}

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=native),
                patch("stage_pdf_text.ocr_pdf_pages", side_effect=fake_ocr_pdf_pages),
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=None,
                    ocr_mode="hybrid",
                )

            self.assertEqual(result["written"], 1)
            self.assertEqual(result["methods"], {"hybrid-ocr-eng-fast-v1": 1})
            staged_text = (text_dir / "doc-a.txt").read_text(encoding="utf-8")
            staged_pages = text_pages(staged_text)
            native_pages = text_pages(native)
            self.assertEqual(staged_pages[0], native_pages[0])
            self.assertEqual(staged_pages[1], ocr_pages[1])

            document = load_documents(manifest_path)[0]
            notes = json.loads(document["provenance"]["notes"])
            self.assertEqual(notes["staged_text"]["method"], "hybrid-ocr-eng-fast-v1")
            self.assertEqual(notes["staged_text"]["review_pages"], [])
            self.assertEqual(
                notes["staged_text"]["page_methods"],
                [
                    {"page_number": 1, "method": "native"},
                    {"page_number": 2, "method": "ocr_replaced"},
                ],
            )

    def test_hybrid_rejected_ocr_keeps_native_page_and_marks_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-b", page_count=1)])
            (raw_dir / "doc-b.pdf").write_bytes(b"%PDF-1.4\n")
            native = (
                "Bad \ufffd page\n"
                "Q.2 1 2 3 4 5 6 7 8 9 10 11 12.\n"
            )
            ocr_pages = {
                1: "Bad page\nQ.2 1 2 3 4 5 6 7 8 9 10 11 13.\n"
            }

            with (
                patch("stage_pdf_text.pdf_to_text", return_value=native),
                patch("stage_pdf_text.ocr_pdf_pages", return_value=ocr_pages),
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=None,
                    ocr_mode="hybrid",
                )

            self.assertEqual(result["written"], 1)
            self.assertEqual(result["methods"], {"pdftotext-layout": 1})
            self.assertEqual(
                (text_dir / "doc-b.txt").read_text(encoding="utf-8"),
                native + "\f",
            )
            document = load_documents(manifest_path)[0]
            notes = json.loads(document["provenance"]["notes"])
            self.assertEqual(notes["staged_text"]["method"], "pdftotext-layout")
            self.assertEqual(notes["staged_text_method"], "pdftotext-layout")
            self.assertEqual(notes["staged_text"]["review_pages"], [1])
            self.assertEqual(
                notes["staged_text"]["page_methods"][0]["method"], "native_review"
            )
            self.assertEqual(
                notes["staged_text"]["page_methods"][0]["reason"],
                "ocr_fidelity_rejected",
            )

    def test_hybrid_page_mismatch_aborts_without_partial_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            documents = [
                _document("doc-good", page_count=1),
                _document("doc-bad", page_count=2),
            ]
            write_jsonl(manifest_path, documents)
            manifest_before = manifest_path.read_bytes()
            (raw_dir / "doc-good.pdf").write_bytes(b"%PDF-1.4\n")
            (raw_dir / "doc-bad.pdf").write_bytes(b"%PDF-1.4\n")

            def fake_pdf_to_text(pdf_path: Path, _executable: str = "pdftotext") -> str:
                if pdf_path.name == "doc-good.pdf":
                    return "Q.1 Clean page.\n"
                return "Q.2 Only one native page.\n"

            with patch("stage_pdf_text.pdf_to_text", side_effect=fake_pdf_to_text):
                with self.assertRaisesRegex(
                    FatalStageError,
                    "page mapping mismatch before hybrid OCR for doc-bad",
                ):
                    stage_text(
                        manifest_path,
                        raw_dir,
                        text_dir,
                        document_ids=None,
                        exam=None,
                        year_before=None,
                        minimum_characters=20,
                        workers=1,
                        dpi=200,
                        tessdata_dir=None,
                        ocr_mode="hybrid",
                    )

            self.assertEqual(manifest_path.read_bytes(), manifest_before)
            self.assertFalse((text_dir / "doc-good.txt").exists())
            self.assertFalse((text_dir / "doc-bad.txt").exists())

    def test_validate_document_failure_never_promotes_text_or_counts_written(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-v", page_count=1)])
            manifest_before = manifest_path.read_bytes()
            (raw_dir / "doc-v.pdf").write_bytes(b"%PDF-1.4\n")

            with patch("stage_pdf_text.pdf_to_text", return_value="Q.1 new text.\n"):
                with patch(
                    "stage_pdf_text.validate_document",
                    side_effect=ValueError("synthetic validate failure"),
                ):
                    result = stage_text(
                        manifest_path,
                        raw_dir,
                        text_dir,
                        document_ids=None,
                        exam=None,
                        year_before=None,
                        minimum_characters=20,
                        workers=1,
                        dpi=200,
                        tessdata_dir=None,
                        ocr_mode="document",
                    )

            self.assertEqual(result["written"], 0)
            self.assertEqual(len(result["failures"]), 1)
            self.assertFalse((text_dir / "doc-v.txt").exists())
            self.assertEqual(manifest_path.read_bytes(), manifest_before)

    def test_mid_promotion_failure_restores_previously_replaced_text_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            documents = [_document("doc-1", page_count=1), _document("doc-2", page_count=1)]
            write_jsonl(manifest_path, documents)
            manifest_before = manifest_path.read_bytes()
            (raw_dir / "doc-1.pdf").write_bytes(b"%PDF-1.4\n")
            (raw_dir / "doc-2.pdf").write_bytes(b"%PDF-1.4\n")
            (text_dir / "doc-1.txt").write_text("old one\f", encoding="utf-8")
            (text_dir / "doc-2.txt").write_text("old two\f", encoding="utf-8")

            def fake_pdf_to_text(pdf_path: Path, _executable: str = "pdftotext") -> str:
                return f"Q.1 {pdf_path.stem} replacement.\n"

            real_replace = os.replace
            replace_calls: list[tuple[str, str]] = []

            def flaky_replace(src, dst):
                replace_calls.append((str(src), str(dst)))
                if str(dst).endswith("doc-2.txt"):
                    raise OSError("synthetic promotion failure")
                return real_replace(src, dst)

            with patch("stage_pdf_text.pdf_to_text", side_effect=fake_pdf_to_text):
                with patch("stage_pdf_text.os.replace", side_effect=flaky_replace):
                    with self.assertRaisesRegex(
                        FatalStageError, "failed to promote staged outputs atomically"
                    ):
                        stage_text(
                            manifest_path,
                            raw_dir,
                            text_dir,
                            document_ids=None,
                            exam=None,
                            year_before=None,
                            minimum_characters=20,
                            workers=1,
                            dpi=200,
                            tessdata_dir=None,
                            ocr_mode="document",
                        )

            self.assertTrue(any(dst.endswith("doc-1.txt") for _, dst in replace_calls))
            self.assertEqual((text_dir / "doc-1.txt").read_text(encoding="utf-8"), "old one\f")
            self.assertEqual((text_dir / "doc-2.txt").read_text(encoding="utf-8"), "old two\f")
            self.assertEqual(manifest_path.read_bytes(), manifest_before)

    def test_manifest_promotion_failure_restores_text_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-m", page_count=1)])
            manifest_before = manifest_path.read_bytes()
            (raw_dir / "doc-m.pdf").write_bytes(b"%PDF-1.4\n")
            (text_dir / "doc-m.txt").write_text("old manifest text\f", encoding="utf-8")

            real_replace = os.replace

            def fail_manifest_replace(src, dst):
                if str(dst) == str(manifest_path):
                    raise OSError("synthetic manifest failure")
                return real_replace(src, dst)

            with patch("stage_pdf_text.pdf_to_text", return_value="Q.1 new text.\n"):
                with patch("stage_pdf_text.os.replace", side_effect=fail_manifest_replace):
                    with self.assertRaisesRegex(
                        FatalStageError, "failed to promote staged outputs atomically"
                    ):
                        stage_text(
                            manifest_path,
                            raw_dir,
                            text_dir,
                            document_ids=None,
                            exam=None,
                            year_before=None,
                            minimum_characters=20,
                            workers=1,
                            dpi=200,
                            tessdata_dir=None,
                            ocr_mode="document",
                        )

            self.assertEqual(
                (text_dir / "doc-m.txt").read_text(encoding="utf-8"),
                "old manifest text\f",
            )
            self.assertEqual(manifest_path.read_bytes(), manifest_before)

    def test_render_failure_cleans_temporary_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            pdf_path = root / "doc.pdf"
            pdf_path.write_bytes(b"%PDF-1.4\n")
            render_root = root / "render-root"
            created_roots: list[Path] = []

            def fake_mkdtemp(*, prefix: str) -> str:
                path = render_root / f"{prefix}{len(created_roots)}"
                path.mkdir(parents=True)
                created_roots.append(path)
                return str(path)

            class _Result:
                returncode = 0

            with patch("stage_pdf_text.shutil.which", return_value="/usr/bin/pdftoppm"):
                with patch("stage_pdf_text.tempfile.mkdtemp", side_effect=fake_mkdtemp):
                    with patch("stage_pdf_text.subprocess.run", return_value=_Result()):
                        with self.assertRaisesRegex(StageError, "rendered 0 images"):
                            _render_pdf_pages(pdf_path, page_numbers=[1], dpi=200)

            self.assertTrue(created_roots)
            self.assertTrue(all(not path.exists() for path in created_roots))

    def test_manifest_temp_failure_cleans_prepared_text_temps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-t", page_count=1)])
            manifest_before = manifest_path.read_bytes()
            (raw_dir / "doc-t.pdf").write_bytes(b"%PDF-1.4\n")

            with patch("stage_pdf_text.pdf_to_text", return_value="Q.1 new text.\n"):
                with patch(
                    "stage_pdf_text._prepare_jsonl_temp",
                    side_effect=OSError("synthetic manifest temp failure"),
                ):
                    with self.assertRaisesRegex(OSError, "synthetic manifest temp failure"):
                        stage_text(
                            manifest_path,
                            raw_dir,
                            text_dir,
                            document_ids=None,
                            exam=None,
                            year_before=None,
                            minimum_characters=20,
                            workers=1,
                            dpi=200,
                            tessdata_dir=None,
                            ocr_mode="document",
                        )

            self.assertEqual(manifest_path.read_bytes(), manifest_before)
            self.assertFalse((text_dir / "doc-t.txt").exists())
            self.assertEqual(list(text_dir.glob(".*.tmp")), [])

    def test_document_mode_preserves_existing_whole_document_ocr_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest_path = root / "manifest.jsonl"
            raw_dir = root / "raw"
            text_dir = root / "text"
            raw_dir.mkdir()
            text_dir.mkdir()
            write_jsonl(manifest_path, [_document("doc-c", page_count=2)])
            (raw_dir / "doc-c.pdf").write_bytes(b"%PDF-1.4\n")

            with (
                patch("stage_pdf_text.pdf_to_text", return_value="one native page only"),
                patch(
                    "stage_pdf_text.ocr_pdf_pages",
                    return_value={1: "OCR page 1", 2: "OCR page 2"},
                ),
            ):
                result = stage_text(
                    manifest_path,
                    raw_dir,
                    text_dir,
                    document_ids=None,
                    exam=None,
                    year_before=None,
                    minimum_characters=20,
                    workers=1,
                    dpi=200,
                    tessdata_dir=None,
                    ocr_mode="document",
                )

            self.assertEqual(result["written"], 1)
            self.assertEqual(
                (text_dir / "doc-c.txt").read_text(encoding="utf-8"),
                "OCR page 1\fOCR page 2\f",
            )
            document = load_documents(manifest_path)[0]
            notes = json.loads(document["provenance"]["notes"])
            self.assertEqual(
                notes["staged_text"]["method"], "tesseract-ocr-eng-fast-v1"
            )
            self.assertEqual(
                notes["staged_text"]["page_methods"],
                [
                    {"page_number": 1, "method": "ocr_document"},
                    {"page_number": 2, "method": "ocr_document"},
                ],
            )

    def test_math_heavy_thresholds_match_spec(self) -> None:
        self.assertTrue(_is_math_heavy(("x=1+2\n" * 20)))
        self.assertTrue(
            _is_math_heavy(
                "1 2 3 =\n"
                "4 5 6 =\n"
                "alpha beta\n"
            )
        )
        self.assertTrue(
            _is_math_heavy(" ".join(str(index) for index in range(12)))
        )
        self.assertFalse(_is_math_heavy("integral derivative vector plane line"))
        self.assertFalse(
            _is_math_heavy(
                "Q.1 Find the value of 3 + 4 and write the answer in words only.\n"
            )
        )

    def test_page_corruption_detector_flags_replacement_private_use_and_high_c1_only(self) -> None:
        self.assertTrue(_has_disallowed_corruption("Bad \ufffd page"))
        self.assertTrue(_has_disallowed_corruption("Bad \ue000 private use"))
        self.assertTrue(_has_disallowed_corruption("\u0081\u0082\u0083 clean-ish text"))
        self.assertFalse(_has_disallowed_corruption("\u0081 one stray c1 marker only"))

    def test_cbse_symbol_pua_does_not_trigger_ocr_after_deterministic_normalization(self) -> None:
        symbol_text = "Find the image of f : A \uf0ae B and let \uf061 = 2."
        self.assertFalse(
            _has_disallowed_corruption(
                symbol_text,
                document_id="cbse-2020-main-mathematics-set-1",
            )
        )
        self.assertTrue(
            _has_disallowed_corruption(
                symbol_text,
                document_id="jee-advanced-2020-paper-1",
            )
        )
        self.assertTrue(
            _has_disallowed_corruption(
                "Unreadable \ue017 custom-font text",
                document_id="cbse-2020-main-mathematics-set-1",
            )
        )


if __name__ == "__main__":
    unittest.main()
