from __future__ import annotations

import unittest
import hashlib

from build_corpus import (
    _is_english_enough_for_harness,
    _sanitize_cbse_english_occurrence,
    _select_cbse_english_variants,
)
from question_bank.models import validate_question
from question_bank.pipeline import parse_questions_from_text


class CbseEnglishVariantSelectionTests(unittest.TestCase):
    def test_clean_formula_occurrence_beats_corrupt_preamble_with_english_signals(self) -> None:
        questions = parse_questions_from_text(
            "1. \ue031\ue03f\ue028 a + b \ue017\ue03e\ue030.\n"
            "General Instructions: Find the value using the following equation.\n"
            "1. If a + b = 7, find a + b.\n",
            document_id="cbse-2024-main-mathematics-set-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        selected, discarded = _select_cbse_english_variants(
            {"exam": "CBSE Class XII Board Examination"}, questions
        )

        self.assertEqual(discarded, 1)
        self.assertEqual([question["text"] for question in selected], ["If a + b = 7, find a + b."])

    def test_adobe_symbol_private_use_is_not_treated_as_hindi_corruption(self) -> None:
        questions = parse_questions_from_text(
            "1. Find x \uf0ae y.\n"
            "1. Find the following value x \uf0ae y.\n",
            document_id="cbse-2020-main-mathematics-set-1",
            document_sha256="b" * 64,
            extraction_method="test-text",
        )

        selected, discarded = _select_cbse_english_variants(
            {"exam": "CBSE Class XII Board Examination"}, questions
        )

        self.assertEqual(discarded, 1)
        self.assertEqual(selected[0]["text"], "Find the following value x → y.")

    def test_non_cbse_documents_are_not_language_filtered(self) -> None:
        questions = parse_questions_from_text(
            "1. \ue031 corrupt occurrence.\n1. Clean occurrence.\n",
            document_id="example-mathematics",
            document_sha256="c" * 64,
            extraction_method="test-text",
        )

        selected, discarded = _select_cbse_english_variants(
            {"exam": "Example Examination"}, questions
        )

        self.assertEqual(discarded, 0)
        self.assertEqual(selected, questions)

    def test_jee_main_duplicate_number_prefers_english_occurrence(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 1 Question Id : 10001 Question Type : MCQ\n"
            "एक सदिश का मान ज्ञात कीजिए।\n"
            "Question Number : 1 Question Id : 10001 Question Type : MCQ\n"
            "Find the magnitude of the vector.\n",
            document_id="jee-main-2025-01-22-shift-2",
            document_sha256="c" * 64,
            extraction_method="test-text",
            question_pattern=r"^\s*Question\s+Number\s*:\s*(?P<number>\d{1,3})\b.*$",
        )

        selected, discarded = _select_cbse_english_variants(
            {"exam": "JEE Main"}, questions
        )

        self.assertEqual(discarded, 1)
        self.assertEqual([question["text"] for question in selected], ["Find the magnitude of the vector."])

    def test_jee_main_same_number_in_different_subjects_is_not_discarded(self) -> None:
        mathematics = parse_questions_from_text(
            "Mathematics Section A\n"
            "Question Number : 1 Question Type : MCQ\nFind the determinant.\n",
            document_id="jee-main-subject-local-numbering",
            document_sha256="c" * 64,
            extraction_method="test-text",
            question_pattern=r"^\s*Question\s+Number\s*:\s*(?P<number>\d{1,3})\b.*$",
        )
        physics = parse_questions_from_text(
            "Physics Section A\n"
            "Question Number : 1 Question Type : MCQ\nFind the magnetic field.\n",
            document_id="jee-main-subject-local-numbering",
            document_sha256="c" * 64,
            extraction_method="test-text",
            question_pattern=r"^\s*Question\s+Number\s*:\s*(?P<number>\d{1,3})\b.*$",
        )

        selected, discarded = _select_cbse_english_variants(
            {"exam": "JEE Main"}, [*mathematics, *physics]
        )

        self.assertEqual(discarded, 0)
        self.assertEqual(len(selected), 2)

    def test_selected_unique_occurrence_drops_unreadable_hindi_font_lines(self) -> None:
        questions = parse_questions_from_text(
            "1. \ue031\ue03f\ue028 x + y \ue017\ue03e.\n"
            "Find the value of x + y when x = 2 and y = 3.\n",
            document_id="cbse-2018-compartment-mathematics-set-1",
            document_sha256="d" * 64,
            extraction_method="test-text",
        )
        raw_artifact_hashes = questions[0]["source_refs"][0][
            "extraction_artifact_sha256s"
        ]

        selected, discarded = _select_cbse_english_variants(
            {"exam": "CBSE Class XII Board Examination"}, questions
        )

        self.assertEqual(discarded, 0)
        self.assertEqual(selected[0]["text"], "Find the value of x + y when x = 2 and y = 3.")
        self.assertEqual(
            selected[0]["source_refs"][0]["extraction_artifact_sha256s"],
            raw_artifact_hashes,
        )
        self.assertEqual(
            selected[0]["source_refs"][0]["extracted_text_sha256"],
            hashlib.sha256(selected[0]["text"].encode("utf-8")).hexdigest(),
        )
        validate_question(selected[0])

    def test_unreadable_only_occurrence_remains_flaggable_instead_of_being_erased(self) -> None:
        question = parse_questions_from_text(
            "1. \ue031\ue03f\ue028 123 \ue017\ue03e.\n",
            document_id="cbse-2018-compartment-mathematics-set-1",
            document_sha256="e" * 64,
            extraction_method="test-text",
        )[0]

        self.assertIs(_sanitize_cbse_english_occurrence(question), question)

    def test_unique_readable_formula_on_mixed_pua_line_is_preserved(self) -> None:
        question = parse_questions_from_text(
            "1. \ue031\ue03f If A = 3B \ue017\ue03e and |B| = 2.\n"
            "Determine the value of |A|.\n",
            document_id="cbse-2018-compartment-mathematics-set-1",
            document_sha256="f" * 64,
            extraction_method="test-text",
        )[0]

        sanitized = _sanitize_cbse_english_occurrence(question)

        self.assertNotIn("\ue031", sanitized["text"])
        self.assertIn("If A = 3B", sanitized["text"])
        self.assertIn("|B| = 2", sanitized["text"])
        self.assertIn("Determine the value of |A|", sanitized["text"])

    def test_jee_main_unique_mixed_block_drops_garbled_hindi_and_keeps_circuit_stem(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 1 Question Id : 10001 Question Type : MCQ\n"
            "ÃØæ\x81Øæ ·¤èçÁ° ç·¤ SÍæØè ¥ßSÍæ ×ð´ ç·¤âè ¥æÎàæü â´ÏæçÚU\x98æ ·¤æð a.c. dæðÌ âð "
            "â´ØæðçÁÌ ·¤ÚUÙð ÂÚU ÏæÚUæ ÂýßæçãÌ ãæðÌè ãñÐ\n"
            "Explain why current flows through an ideal capacitor in a circuit "
            "connected to an a.c. source but not to a d.c. source.\n",
            document_id="jee-main-2024-04-04-shift-1",
            document_sha256="c" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=r"^\s*Question\s+Number\s*:\s*(?P<number>\d{1,3})\b.*$",
        )
        mixed = questions[0]["text"]
        self.assertFalse(_is_english_enough_for_harness(mixed))

        selected, discarded = _select_cbse_english_variants(
            {"exam": "JEE Main"}, questions
        )

        self.assertEqual(discarded, 0)
        text = selected[0]["text"]
        self.assertNotIn("ÃØæ", text)
        self.assertIn("circuit", text)
        self.assertTrue(_is_english_enough_for_harness(text))
        self.assertNotEqual(selected[0]["question_id"], questions[0]["question_id"])

    def test_hindi_only_mojibake_stays_unsanitized(self) -> None:
        question = parse_questions_from_text(
            "1. âêØæðüÎØ ¥æñÚU âêØæüSÌ ·ð¤ â×Ø âêØü ÜæÜ \x80Øæð´ ÂýÌèÌ ãæðÌæ ãñ? "
            "§â·¤æ ·¤æÚU\x87æ çÜç¹°Ð\n",
            document_id="cbse-2015-main-physics-delhi-set-1",
            document_sha256="d" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
        )[0]

        self.assertIs(_sanitize_cbse_english_occurrence(question), question)

    def test_clean_english_occurrence_is_identity(self) -> None:
        question = parse_questions_from_text(
            "1. Find the magnitude of the current in the given circuit.\n",
            document_id="cbse-2024-main-physics-set-1",
            document_sha256="e" * 64,
            extraction_method="test-text",
        )[0]

        self.assertIs(_sanitize_cbse_english_occurrence(question), question)

    def test_mathematical_italic_equations_are_not_stripped_as_hindi(self) -> None:
        question = parse_questions_from_text(
            "1. Let 𝛼, 𝛽 and 𝛾 be real numbers such that the system of linear "
            "equations 𝑥 + 2𝑦 + 3𝑧 = 𝛼 is consistent.\n",
            document_id="jee-main-2021-02-25-shift-1",
            document_sha256="f" * 64,
            extraction_method="test-text",
        )[0]

        self.assertIs(_sanitize_cbse_english_occurrence(question), question)


if __name__ == "__main__":
    unittest.main()
