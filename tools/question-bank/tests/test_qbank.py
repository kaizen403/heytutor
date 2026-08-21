from __future__ import annotations


import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from build_corpus import (
    NTA_QUESTION_PATTERN,
    _apply_nta_subject_numbering,
    _infer_three_subject_page_segments,
    _select_cbse_english_variants,
)
from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    ValidationError,
    deduplicate_questions,
    find_near_duplicate_questions,
    load_documents,
    load_questions,
    migrate_questions_v2_to_v3,
    validate_corpus,
    write_jsonl,
)
from question_bank.pipeline import (
    PipelineError,
    acquire_documents,
    build_sqlite_database,
    classify_questions,
    extract_document,
    parse_questions_with_diagnostics,
    parse_questions_from_text,
    normalize_cbse_symbol_text,
    _text_pages,
)


def document_record(
    document_id: str, content_hash: str | None, *, status: str = "acquired"
) -> dict[str, object]:
    return {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "document_id": document_id,
        "provenance": {
            "publisher": "Example examination board",
            "source_type": "official",
            "retrieved_at": "2025-01-01T00:00:00Z" if status != "planned" else None,
            "notes": None,
        },
        "year": 2025,
        "exam": "Example Exam",
        "session": "May",
        "set": "A",
        "subject": "Physics",
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
            "page_count": None,
            "container_url": None,
            "container_sha256": None,
            "member_path": None,
        },
        "sha256": content_hash,
        "status": status,
    }


class QuestionBankTests(unittest.TestCase):
    def test_text_page_mapping_preserves_a_real_blank_final_page(self) -> None:
        self.assertEqual(_text_pages("first\fsecond\f"), ["first", "second"])
        self.assertEqual(_text_pages("first\fsecond\f\f"), ["first", "second", ""])

    def test_jee_internal_reagent_steps_do_not_split_real_questions(self) -> None:
        questions = parse_questions_from_text(
            "1. Consider the following reaction sequence.\n"
            "1. O3 (excess)\n"
            "2. NH2OH (excess)\n"
            "2. Find the final product of the sequence.\n",
            document_id="jee-advanced-2021-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["1", "2"],
        )
        self.assertIn("1. O3 (excess)", questions[0]["text"])
        self.assertIn("2. NH2OH (excess)", questions[0]["text"])

    def test_jee_sequential_prose_and_formula_headings_are_never_reagent_steps(self) -> None:
        questions = parse_questions_from_text(
            "3. A preceding question ends here.\n"
            "4. Inthe given circuit, calculate the charge. Then\n"
            "5. Ifthe particle travels at the speed of light, find its energy.\n"
            "6. Kf(x) = integral dt for all x, then\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="b" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["3", "4", "5", "6"],
        )

    def test_jee_question_only_paper_does_not_defer_blank_standalone_headings(self) -> None:
        questions, diagnostics = parse_questions_with_diagnostics(
            "1.\nFind the first requested value.\n"
            "2.\nFind the second requested value.\n",
            document_id="jee-advanced-2021-paper-1-english",
            document_sha256="c" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["1", "2"],
        )
        self.assertEqual(diagnostics["blocking_issues"], [])

    def test_cbse_symbol_normalization_is_scope_gated_and_preserves_unknown_pua(self) -> None:
        source = "\uf061=\uf062"
        source += " E0=\ue017 unknown=\uf0ff custom=\uf8e7"

        normalized = normalize_cbse_symbol_text(
            source, document_id="cbse-2020-main-mathematics"
        )
        self.assertEqual(normalized, "α=β E0=\ue017 unknown=\uf0ff custom=\uf8e7")
        self.assertEqual(
            normalize_cbse_symbol_text(source, document_id="jee-advanced-2020-paper-1"),
            source,
        )

    def test_cbse_symbol_normalization_decodes_greek_and_operators_without_wingdings_rules(self) -> None:
        encoded = "\uf061\uf02b\uf062\uf03d\uf0b1\uf0a5\uf0ce\uf0cf\uf0d5\uf0e5\uf0a0\uf0ae"
        self.assertEqual(
            normalize_cbse_symbol_text(encoded, document_id="cbse-2020-main-mathematics"),
            "α+β=±∞∈∉∏∑€→",
        )
        # F0FF is not in the Adobe Symbol table; do not guess a Wingdings/custom
        # meaning merely because it is in the same private-use block.
        self.assertEqual(
            normalize_cbse_symbol_text("\uf0ff", document_id="cbse-2020-main-mathematics"),
            "\uf0ff",
        )

    def test_cbse_symbol_normalization_decodes_matrix_and_piecewise_delimiters(self) -> None:
        encoded = "\uf8eb a \uf8f6\uf8ee b \uf8f9\uf8f1 x \uf8f2 y \uf8f3 \uf8fc \uf8f4 \uf8f5"
        self.assertEqual(
            normalize_cbse_symbol_text(encoded, document_id="cbse-2016-main-mathematics"),
            "⎛ a ⎞⎡ b ⎤⎧ x ⎨ y ⎩ ⎫ ⏐ ⎮",
        )

    def test_symbol_normalization_happens_before_question_hashing(self) -> None:
        encoded = parse_questions_from_text(
            "1. Find \uf061 \uf02b 1 \uf03d 2.",
            document_id="cbse-2020-main-mathematics",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]
        unicode_text = parse_questions_from_text(
            "1. Find α + 1 = 2.",
            document_id="cbse-2020-main-mathematics",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]
        self.assertEqual(encoded["text"], "Find α + 1 = 2.")
        self.assertEqual(encoded["content_sha256"], unicode_text["content_sha256"])
        self.assertEqual(encoded["question_id"], unicode_text["question_id"])

    def test_three_end_delimited_subject_inference_requires_decisive_blocks(self) -> None:
        mathematics = "function matrix polynomial integral derivative " * 4
        physics = "mass velocity force magnetic current circuit " * 4
        chemistry = "molecule compound reaction aqueous acid atom " * 4
        text = (
            mathematics
            + "\nEND OF THE QUESTION PAPER\f"
            + physics
            + "\nEND OF THE QUESTION PAPER\f"
            + chemistry
            + "\nEND OF THE QUESTION PAPER\f"
        )

        inference = _infer_three_subject_page_segments(text)

        self.assertIsNotNone(inference)
        self.assertEqual(
            [segment["subject"] for segment in inference["segments"]],
            ["Mathematics", "Physics", "Chemistry"],
        )
        self.assertIsNone(
            _infer_three_subject_page_segments(
                "function\nEND OF THE QUESTION PAPER\f"
                "force\nEND OF THE QUESTION PAPER\f"
                "acid\nEND OF THE QUESTION PAPER\f"
            )
        )

    def test_parser_preserves_page_and_inline_answer_provenance(self) -> None:
        questions = parse_questions_from_text(
            "Cover page\nQ. 1)\nCalculate the acceleration.\nShow your work.\nAnswer: 4 m/s^2\f"
            "2. State Newton's second law.\n",
            document_id="example-2025-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0]["answer"], "4 m/s^2")
        self.assertNotIn("Answer:", questions[0]["text"])
        self.assertEqual(questions[0]["source_refs"][0]["page_number"], 1)
        self.assertEqual(questions[0]["source_refs"][0]["page_end"], 1)
        self.assertEqual(questions[1]["source_refs"][0]["page_number"], 2)
        self.assertEqual(questions[1]["source_refs"][0]["question_number"], "2")
        self.assertIsNone(questions[1]["source_refs"][0]["subject_context"])

    def test_parser_strips_answer_summary_footer_spillover(self) -> None:
        questions = parse_questions_from_text(
            "1. Electromagnetic waves travel in vacuum.\n"
            "Answers for the above questions: A, B, C.\n",
            document_id="example-2025-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertNotIn("Answers for the above questions", questions[0]["text"])
        self.assertEqual(questions[0]["text"], "Electromagnetic waves travel in vacuum.")

    def test_parser_preserves_grouped_question_stems(self) -> None:
        questions = parse_questions_from_text(
            "1. Question Stem for Question Nos. 17 and 18: A common passage follows.\n"
            "Use the graph to answer both parts.\n"
            "2. Answer Q.17 and Q.18 by appropriately matching the two columns.\n",
            document_id="example-2025-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 2)
        self.assertIn("Question Stem for Question Nos. 17 and 18", questions[0]["text"])
        self.assertIn("Answer Q.17 and Q.18", questions[1]["text"])

    def test_jee_shared_stem_is_duplicated_into_each_question(self) -> None:
        questions = parse_questions_from_text(
            "Q.6 Previous standalone prompt.\n"
            "Question Stem for Question Nos. 7 and 8\n"
            "Question Stem\n"
            "A common passage follows.\n"
            "It spans multiple lines.\n"
            "Q.7 First part?\n"
            "Q.8 Second part?\n",
            document_id="jee-advanced-2021-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        by_number = {item["source_refs"][0]["question_number"]: item for item in questions}
        self.assertEqual(by_number["6"]["text"], "Previous standalone prompt.")
        self.assertTrue(by_number["7"]["text"].startswith("A common passage follows."))
        self.assertIn("It spans multiple lines.", by_number["7"]["text"])
        self.assertTrue(by_number["8"]["text"].startswith("A common passage follows."))
        self.assertIn("Second part?", by_number["8"]["text"])
        self.assertNotIn("Question Stem for Question Nos. 7 and 8", by_number["6"]["text"])
        self.assertEqual(by_number["7"]["source_refs"][0]["page_number"], 1)
        self.assertEqual(by_number["8"]["source_refs"][0]["page_number"], 1)

    def test_jee_shared_stem_preserves_page_break_provenance(self) -> None:
        questions = parse_questions_from_text(
            "Question Stem for Question Nos. 7 and 8\n"
            "Shared setup on page one.\f"
            "Q.7 First part on page two.\n"
            "Q.8 Second part on page two.\n",
            document_id="jee-advanced-2021-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        by_number = {item["source_refs"][0]["question_number"]: item for item in questions}
        self.assertEqual(by_number["7"]["source_refs"][0]["page_number"], 1)
        self.assertEqual(by_number["7"]["source_refs"][0]["page_end"], 2)
        self.assertEqual(by_number["8"]["source_refs"][0]["page_number"], 1)
        self.assertEqual(by_number["8"]["source_refs"][0]["page_end"], 2)
        self.assertIn("Shared setup on page one.", by_number["7"]["text"])
        self.assertIn("Shared setup on page one.", by_number["8"]["text"])

    def test_jee_shared_stem_incomplete_range_is_reported(self) -> None:
        questions, diagnostics = parse_questions_with_diagnostics(
            "Question Stem for Question Nos. 7 and 8\n"
            "Shared setup.\n"
            "Q.7 First part.\n"
            "Q.9 Unrelated next question.\n",
            document_id="jee-advanced-2021-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        by_number = {item["source_refs"][0]["question_number"]: item for item in questions}
        self.assertIn("Shared setup.", by_number["7"]["text"])
        self.assertEqual(by_number["9"]["text"], "Unrelated next question.")
        self.assertTrue(diagnostics["blocking_issues"])
        self.assertTrue(
            any(
                "shared stem 7-8 ended before its full range was matched" in item["text"]
                for item in diagnostics["suspicious_heading_lines"]
            )
        )
        self.assertTrue(
            any(
                item["kind"] == "shared_stem_range_mismatch"
                for item in diagnostics["blocking_issues"]
            )
        )

    def test_jee_shared_stem_repeated_ranges_reset_across_subjects(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "Question Stem for Question Nos. 7 and 8\n"
            "Physics setup.\n"
            "Q.7 Physics part one.\n"
            "Q.8 Physics part two.\n"
            "MATHEMATICS\n"
            "Question Stem for Question Nos. 7 and 8\n"
            "Mathematics setup.\n"
            "Q.7 Mathematics part one.\n"
            "Q.8 Mathematics part two.\n",
            document_id="jee-advanced-2026-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        physics_questions = [
            item for item in questions if item["source_refs"][0]["subject_context"] == "Physics"
        ]
        mathematics_questions = [
            item for item in questions if item["source_refs"][0]["subject_context"] == "Mathematics"
        ]
        self.assertEqual(len(physics_questions), 2)
        self.assertEqual(len(mathematics_questions), 2)
        self.assertTrue(all("Physics setup." in item["text"] for item in physics_questions))
        self.assertTrue(
            all("Mathematics setup." in item["text"] for item in mathematics_questions)
        )

    def test_jee_shared_stem_ignores_large_comma_number_inside_stem_text(self) -> None:
        questions, diagnostics = parse_questions_with_diagnostics(
            "Question Stem for Question Nos. 9 and 10\n"
            "A soft plastic bottle is described with X and Y denoting measured values,\n"
            "119, respectively).\n"
            "Q.9 The value of X is ___.\n"
            "Q.10 The value of Y is ___.\n",
            document_id="jee-advanced-2021-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        by_number = {item["source_refs"][0]["question_number"]: item for item in questions}
        self.assertEqual(sorted(by_number), ["10", "9"])
        self.assertNotIn("119", by_number)
        self.assertIn("119, respectively).", by_number["9"]["text"])
        self.assertIn("119, respectively).", by_number["10"]["text"])
        self.assertEqual(diagnostics["blocking_issues"], [])

    def test_parser_strips_page_footer_noise_between_question_parts(self) -> None:
        questions = parse_questions_from_text(
            "1. A housing society wants to commission a swimming pool for its residents.\n"
            "(i) Write cost C(h) as a function in terms of h.\n"
            "~65/1/2-11~       JJJJ                       Page 19 of 23                                 P.T.O.\n"
            "(ii) Find the critical point.\n"
            ,
            document_id="example-2025-maths-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertIn("(ii) Find the critical point.", questions[0]["text"])
        self.assertNotIn("Page 19", questions[0]["text"])
        self.assertNotIn("P.T.O.", questions[0]["text"])
        self.assertNotIn("65/1/2-11", questions[0]["text"])
        self.assertNotIn("JJJJ", questions[0]["text"])

    def test_parser_preserves_legitimate_page_reference_line(self) -> None:
        questions = parse_questions_from_text(
            "1. What is written on Page 19 of the booklet?\n",
            document_id="example-2025-maths-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertIn("What is written on Page 19 of the booklet?", questions[0]["text"])

    def test_parser_preserves_legitimate_pto_abbreviation_line(self) -> None:
        questions = parse_questions_from_text(
            "1. Expand the abbreviation P.T.O. in this context.\n",
            document_id="example-2025-maths-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertIn("Expand the abbreviation P.T.O. in this context.", questions[0]["text"])

    def test_combined_paper_subject_boundaries_gate_classification(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions_path = root / "questions.jsonl"
            rules_path = root / "classification-rules.json"
            document = document_record("example-2025-pcm-paper", "a" * 64)
            document["subject"] = "Physics, Chemistry, Mathematics"
            questions = parse_questions_from_text(
                "PHYSICS\n"
                "1. Calculate the acceleration of the charged particle.\n"
                "PHYSICS\n"
                "Use the field shown in the figure.\n"
                "SECTION 2\n"
                "2. State the applicable law.\n"
                "MATHEMATICS\n"
                "1. Calculate the acceleration of convergence of this sequence.\n",
                document_id=document["document_id"],
                document_sha256=document["sha256"],
                extraction_method="test-text",
            )
            write_jsonl(manifest, [document])
            write_jsonl(questions_path, questions)
            rules_path.write_text(
                json.dumps(
                    {
                        "schema_version": "question-bank-classification-rules/v1",
                        "rules": [
                            {
                                "id": "physics-acceleration",
                                "subject": "Physics",
                                "topic": "Mechanics",
                                "subtopic": "Kinematics",
                                "difficulty": None,
                                "keywords_any": ["acceleration"],
                                "keywords_all": [],
                                "priority": 100,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            result = classify_questions(manifest, questions_path, rules_path)
            classified = load_questions(questions_path)

            self.assertEqual(len(classified), 3)
            self.assertEqual(
                sorted(item["source_refs"][0]["subject_context"] for item in classified),
                ["Mathematics", "Physics", "Physics"],
            )
            physics_acceleration = next(
                item for item in classified if "charged particle" in item["text"]
            )
            mathematics_acceleration = next(
                item for item in classified if "convergence" in item["text"]
            )
            self.assertIn("field shown", physics_acceleration["text"])
            self.assertEqual(physics_acceleration["topic"], "Mechanics")
            self.assertIsNone(mathematics_acceleration["topic"])
            self.assertEqual(result["classified"], 1)

    def test_jee_subject_header_layouts_are_recognized(self) -> None:
        questions = parse_questions_from_text(
            "[PART I: CHEMISTRY |\n"
            "1. Identify the compound.\n"
            "(PART Il: MATHEMATICS\n"
            "1. Find the direction cosines.\n"
            "JEE (Advanced) 2024        Physics        Paper 1\n"
            "Q.1 Find the induced emf.\n",
            document_id="jee-advanced-2024-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        by_text = {item["text"]: item for item in questions}
        self.assertEqual(
            by_text["Identify the compound."]["source_refs"][0]["subject_context"],
            "Chemistry",
        )
        self.assertEqual(
            by_text["Find the direction cosines."]["source_refs"][0]["subject_context"],
            "Mathematics",
        )
        self.assertEqual(
            by_text["Find the induced emf."]["source_refs"][0]["subject_context"],
            "Physics",
        )

        page_header = parse_questions_from_text(
            "JEE (Advanced) 2023 Paper 1\nMathematics\nQ.1 Find the plane.",
            document_id="jee-advanced-2023-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )
        self.assertEqual(
            page_header[0]["source_refs"][0]["subject_context"], "Mathematics"
        )

        title_case_questions = parse_questions_from_text(
            "Physics Section A\n"
            "Question Number : 2 Question Type : MCQ\nFind the induced emf.\n"
            "Mathematics Section A\n"
            "Question Number : 3 Question Type : MCQ\nFind the direction cosines.\n",
            document_id="jee-main-2026-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )
        self.assertEqual(
            [
                item["source_refs"][0]["subject_context"]
                for item in title_case_questions
            ],
            ["Physics", "Mathematics"],
        )

        nta_export_order = parse_questions_from_text(
            "Question Number : 1 Question Type : MCQ\n"
            "Question Paper Name : B.Tech\n"
            "Mathematics Section A\n"
            "6911211\n1\nOnline\nMandatory\n20\n20\n80\n0\n1\n6911211\nYes\nNo\n"
            "Find the direction cosines.\n",
            document_id="jee-main-2026-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )
        self.assertEqual(len(nta_export_order), 1)
        self.assertIn("direction cosines", nta_export_order[0]["text"])
        self.assertNotIn("Question Paper Name", nta_export_order[0]["text"])
        self.assertNotIn("6911211", nta_export_order[0]["text"])
        self.assertEqual(
            nta_export_order[0]["source_refs"][0]["subject_context"],
            "Mathematics",
        )

        inherited_context = parse_questions_from_text(
            "Physics Section B\n"
            "Question Number : 50 Question Type : SA\nFind the AC power.\n"
            "Section Id :\nSection Number :\nSection type :\n"
            "Question Number : 51 Question Type : MCQ\n"
            "Yes Is Question Mandatory : No\n"
            "Chemistry Section A\n123\n5\nOnline\nMandatory\n20\n20\n80\n0\n1\n123\nYes\nNo\n"
            "Count the moles.\n",
            document_id="jee-main-2026-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )
        self.assertEqual(len(inherited_context), 2)
        self.assertEqual(
            [item["source_refs"][0]["subject_context"] for item in inherited_context],
            ["Physics", "Chemistry"],
        )
        self.assertNotIn("Section Id", inherited_context[0]["text"])
        self.assertEqual(inherited_context[1]["text"], "Count the moles.")

    def test_section_word_in_question_does_not_truncate_target_text(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "SECTION A\n"
            "1. Define coefficient of self inductance for a coil of cross-\n"
            "section A having N turns.\n"
            "SECTION A\n"
            "Calculate the self-inductance of the coil.\n"
            "Chemistry\n"
            "is merely a word in this question.\n",
            document_id="cbse-2023-physics-set-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertIn("cross-\nsection A having N turns", questions[0]["text"])
        self.assertIn("Calculate the self-inductance", questions[0]["text"])
        self.assertIn("Chemistry", questions[0]["text"])
        self.assertEqual(
            questions[0]["source_refs"][0]["subject_context"], "Physics"
        )

    def test_ocr_section_header_variants_split_questions(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\nSECTION - II} (Integer Type)\n"
            "1. First question body.\n"
            "SECTION -— 3 : (Paragraph Type)\n"
            "2. Second question body.\n"
            "SECTION 4 (Maximum Marks: 18}\n"
            "3. Third question body.\n",
            document_id="jee-advanced-2019-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["text"] for question in questions],
            ["First question body.", "Second question body.", "Third question body."],
        )

    def test_deferred_question_numbers_are_paired_with_answer_delimited_bodies(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "44,\n\n45.\n\n46.\n\n"
            "MATHEMATICS\n"
            "Let A be the first matrix.\n(A) 1 (B) 2\nANSWER: A\n"
            "Let z be the second complex number.\n(A) i (B) -i\nANSWER: B\n"
            "Evaluate the third integral.\n(A) 0 (B) 1\nANSWER: A\n"
            "This section contains two paragraph questions.\n"
            "SECTION II: Paragraph Type\n"
            "47. A normally numbered question follows.\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["44", "45", "46", "47"],
        )
        self.assertEqual(
            [question["answer"] for question in questions],
            ["A", "B", "A", None],
        )
        self.assertEqual(
            [question["text"] for question in questions],
            [
                "Let A be the first matrix.\n(A) 1 (B) 2",
                "Let z be the second complex number.\n(A) i (B) -i",
                "Evaluate the third integral.\n(A) 0 (B) 1",
                "A normally numbered question follows.",
            ],
        )
        self.assertTrue(
            all(
                question["source_refs"][0]["subject_context"] == "Mathematics"
                for question in questions
            )
        )

    def test_deferred_question_numbers_split_before_section_tail(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "58.\n59.\n60.\n"
            "First body line.\nANSWER: D\n"
            "Second body line.\nANSWER: A\n"
            "Third body line.\nANSWER: B\n"
            "_MATHEMATICS\n"
            "SECTION - IV (Total Marks : 28)\n"
            "(Matrix-Match Type)\n"
            "61. A normally numbered question follows.\n",
            document_id="jee-advanced-2011-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["58", "59", "60", "61"],
        )
        self.assertEqual(
            [question["answer"] for question in questions],
            ["D", "A", "B", None],
        )
        self.assertEqual(
            [question["text"] for question in questions[:3]],
            ["First body line.", "Second body line.", "Third body line."],
        )

    def test_deferred_question_numbers_do_not_split_without_exact_answer_count(self) -> None:
        questions = parse_questions_from_text(
            "ANSWER: source-format marker\n"
            "MATHEMATICS\n"
            "44.\n45.\n"
            "A single unresolved body follows without an answer delimiter.\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]["source_refs"][0]["question_number"], "44-45")
        self.assertIn("unresolved body", questions[0]["text"])

    def test_deferred_block_accepts_only_the_final_answer_as_missing(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "47.\n48.\n"
            "Find the first limit.\n(A) 1 (B) 2\nANSWER: A\n"
            "Evaluate the second integral.\n(A) 0 (B) 1\n"
            "SECTION II: Multiple Correct Answers\n"
            "49. A normally numbered question follows.\n",
            document_id="jee-advanced-2011-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["47", "48", "49"],
        )
        self.assertEqual([question["answer"] for question in questions], ["A", None, None])
        self.assertEqual(questions[1]["text"], "Evaluate the second integral.\n(A) 0 (B) 1")

    def test_deferred_block_preserves_body_prefix_before_later_blank_numbers(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "17, Six charges are placed at the vertices of a regular hexagon as\n"
            "18.\n"
            "19.\n"
            "shown in the figure. Which field is correct?\nANSWER: A\n"
            "A cylinder rolls down an incline. Which speed is larger?\nZero Marks to all\n"
            "Two planets have equal density. Compare their gravity.\nANSWER: C\n"
            "20. A normally numbered question follows.\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["17", "18", "19", "20"],
        )
        self.assertEqual(
            questions[0]["text"],
            "Six charges are placed at the vertices of a regular hexagon as\n"
            "shown in the figure. Which field is correct?",
        )
        self.assertEqual(
            [question["answer"] for question in questions[:3]],
            ["A", "Zero Marks to all", "C"],
        )

    def test_deferred_block_preserves_historical_two_digit_comma_heading_recovery(self) -> None:
        questions = parse_questions_from_text(
            "ANSWER: source-format marker\n"
            "MATHEMATICS\n"
            "24, Evaluate the determinant.\n"
            "25. A normally numbered question follows.\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["24", "25"],
        )
        self.assertEqual(questions[0]["text"], "Evaluate the determinant.")

    def test_deferred_block_splits_before_ocr_tilde_section(self) -> None:
        questions = parse_questions_from_text(
            "CHEMISTRY\n"
            "13.\n14.\n15.\n16.\n17.\n18.\n"
            "First integer body.\nANSWER: 4\n"
            "Second integer body.\nANSWER: 6\n"
            "Third integer body.\nANSWER: 7\n"
            "Fourth integer body.\nANSWER: 8\n"
            "Fifth integer body.\nANSWER: 8\n"
            "Sixth integer body.\nANSWER: 6\n"
            "CHEMISTRY\n"
            "SECTION ~— IV (Total Marks : 16)\n"
            "(Matrix-Match Type)\n"
            "19. Match the transformations in column I.\n",
            document_id="jee-advanced-2011-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["13", "14", "15", "16", "17", "18", "19"],
        )
        self.assertEqual(
            [question["answer"] for question in questions[:6]],
            ["4", "6", "7", "8", "8", "6"],
        )

    def test_deferred_comma_heading_before_subject_header(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "42.\n43.\n44,\n"
            "PHYSICS\n"
            "Four point charges sit on a soap film.\nANSWER: 3\n"
            "A steel wire is cooled after a mass is hung.\nANSWER: 3\n"
            "A freshly prepared radioactive sample decays.\nANSWER: 1\n"
            "45. A long circular tube carries a current.\n",
            document_id="jee-advanced-2011-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["42", "43", "44", "45"],
        )
        self.assertEqual(
            [question["answer"] for question in questions[:3]],
            ["3", "3", "1"],
        )

    def test_deferred_block_ignores_ratio_false_heading(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "54.\n55.\n"
            "A rectangular sheet has sides in the ratio\n"
            "8: 15 is converted into an open rectangular box.\n"
            "(A) 24 (B) 32 (C) 45 (D) 60\nANSWER : AC\n"
            "A line passing through the origin is perpendicular.\n"
            "(A) (1,1,1) (B) (-1,-1,0)\nANSWER : BD\n"
            "56. The coefficients of three consecutive terms follow.\n",
            document_id="jee-advanced-2013-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["54", "55", "56"],
        )
        self.assertEqual([question["answer"] for question in questions[:2]], ["AC", "BD"])
        self.assertIn("8: 15 is converted", questions[0]["text"])

    def test_deferred_block_ignores_empty_false_heading(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "18.\n19.\n20.\n"
            "A lamina is made by removing a small disc.\n"
            "6)\n"
            "ANSWER : 3\n"
            "A circular wire loop of radius R is placed.\nANSWER : 7\n"
            "A proton is fired from very far away.\nANSWER : 7\n"
            "21. In allene the carbon hybridisation is.\n",
            document_id="jee-advanced-2012-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["18", "19", "20", "21"],
        )
        self.assertEqual(
            [question["answer"] for question in questions[:3]],
            ["3", "7", "7"],
        )
        self.assertIn("6)", questions[0]["text"])

    def test_deferred_block_ignores_formula_false_heading(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "53.\n54.\n55.\n"
            "Let w be a complex number such that\n"
            "2. 2 =\n"
            "Then the value of the expression is\nANSWER : MARKS TO ALL\n"
            "The number of distinct real roots is\nANSWER : 2\n"
            "Let y'(x) + y(x) = g(x).\nANSWER : 0\n"
            "56. Let M be a 3x3 matrix.\n",
            document_id="jee-advanced-2011-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["53", "54", "55", "56"],
        )
        self.assertEqual(
            [question["answer"] for question in questions[:3]],
            ["MARKS TO ALL", "2", "0"],
        )
        self.assertIn("2. 2 =", questions[0]["text"])

    def test_empty_deferred_run_keeps_bare_subject_reprint(self) -> None:
        questions = parse_questions_from_text(
            "CHEMISTRY\n"
            "21. A chemistry leftover.\nANSWER: C\n"
            "22. Another chemistry leftover.\nANSWER: B\n"
            "23.\n24.\n"
            "PHYSICS\n"
            "A long insulated copper wire is wound as a spiral.\nANSWER: A\n"
            "A point mass is subjected to two displacements.\nANSWER : B\n"
            "25. Which of the field patterns is valid?\nANSWER : C\n",
            document_id="jee-advanced-2011-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["21", "22", "23", "24", "25"],
        )
        self.assertEqual(
            [question["answer"] for question in questions],
            ["C", "B", "A", "B", "C"],
        )
        self.assertEqual(
            questions[2]["source_refs"][0]["subject_context"],
            "Physics",
        )

    def test_paragraph_header_closes_complete_deferred_block(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "58.\n59.\n60.\n"
            "Paragraph for Question Nos. 58 to 60\n"
            "Let a, b and c be three real numbers.\nANSWER: D\n"
            "Let w be a solution of x^3-1=0.\nANSWER: A\n"
            "Let b=6 with a and c satisfying (E).\n"
            "Paragraph for Question Nos. 61 and 62\n"
            "Let U1 and U2 be two urns.\nANSWER: B\n"
            "Given that the drawn ball is white.\nANSWER: D\n"
            "SECTION - IV (Total Marks : 28)\n"
            "63. Consider the parabola y^2=8x.\n",
            document_id="jee-advanced-2011-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        numbers = [question["source_refs"][0]["question_number"] for question in questions]
        self.assertEqual(numbers[:4], ["58", "59", "60", "63"])
        self.assertEqual(
            [question["answer"] for question in questions[:3]],
            ["D", "A", None],
        )
        self.assertIn("Let b=6", questions[2]["text"])
        self.assertNotIn("Let U1 and U2", questions[2]["text"])

    def test_deferred_comma_heading_before_ocr_garbage(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "42.\n43.\n44,\n"
            "x es\n"
            "Let P be a point on the hyperbola.\nANSWER : B\n"
            "A value of b for which the equations share a root.\nANSWER : B\n"
            "Let w be a cube root of unity.\nANSWER: A\n"
            "The circle passing through (-1,0) also passes through another point.\n"
            "ANSWER : D\n"
            "45.\n46.\n"
            "MATHEMATICS\n"
            "Evaluate the first limit.\nANSWER: D\n"
            "Evaluate the second integral.\nANSWER : C\n",
            document_id="jee-advanced-2011-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["42", "43", "44", "45", "46"],
        )
        self.assertEqual(
            [question["answer"] for question in questions],
            ["B", "B", "A", "D", "C"],
        )

    def test_deferred_block_does_not_absorb_skipped_forward_heading(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "47.\n48.\n"
            "MATHEMATICS\n"
            "The value of the cotangent product is.\nANSWER: B\n"
            "The distance between the intersection point is less than 2.\n"
            "ANSWER: AorC or AC\n"
            "50. Let PR and SQ determine diagonals of a parallelogram.\nANSWER: C\n",
            document_id="jee-advanced-2013-paper-1-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["47", "48", "50"],
        )
        self.assertEqual(
            [question["answer"] for question in questions],
            ["B", "AorC or AC", "C"],
        )

    def test_matrix_match_digit_is_not_a_restart_heading(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "56. Let M be a 3x3 matrix.\nANSWER: 9\n"
            "58. The straight line divides the circular region.\nANSWER : 2\n"
            "MATHEMATICS\n"
            "SECTION - IV (Total Marks : 16)\n"
            "(Matrix-Match Type)\n"
            "Match the statements given in Column I with the values given in Column II\n"
            "3.\n"
            "(C) The value of the integral is\n"
            "60. Match the statements given in Column I with the intervals.\n",
            document_id="jee-advanced-2011-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        numbers = [question["source_refs"][0]["question_number"] for question in questions]
        self.assertEqual(numbers[:2], ["56", "58"])
        self.assertIn("60", numbers)
        self.assertNotIn("3", numbers)
        self.assertNotIn("3,60", numbers)

    def test_deferred_block_splits_before_wrapped_section_instruction(self) -> None:
        questions = parse_questions_from_text(
            "MATHEMATICS\n"
            "44,\n45.\n46.\n47.\n48.\n"
            "MATHEMATICS\n"
            "If P is a 3x3 matrix such that P'=2P+I.\nANSWER : D\n"
            "Let alpha and beta be the roots of the equation.\nANSWER : B\n"
            "Four fair dice are rolled simultaneously.\nANSWER: A\n"
            "The value of the integral is.\nANSWER: B\n"
            "Let a_n be in harmonic progression.\nANSWER : D\n"
            "MATHEMATICS\n"
            "This section contains 6 multiple choice questions relating to three paragraphs with two questions\n"
            "on each paragraph. Each question has four choices (A), (B), (C) and (D) out of which ONLY ONE\n"
            "is correct.\n"
            "SECTION II: Paragraph Type\n"
            "Paragraph for Questions 49 and 50\n"
            "Let a_n denote the number of n-digit integers.\n"
            "49. The value of b_7 is\nANSWER : B\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["44", "45", "46", "47", "48", "49"],
        )
        self.assertEqual(
            [question["answer"] for question in questions[:5]],
            ["D", "B", "A", "B", "D"],
        )

    def test_zero_axis_label_is_not_treated_as_a_question_number(self) -> None:
        questions = parse_questions_from_text(
            "PHYSICS\n"
            "1. Choose the correct velocity-time graph.\n"
            "0. time axis label\n"
            "The curve remains continuous.\nANSWER: A\n"
            "2. State the next result.\n",
            document_id="jee-advanced-2012-paper-2-english",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )

        self.assertEqual(
            [question["source_refs"][0]["question_number"] for question in questions],
            ["1", "2"],
        )
        self.assertIn("0. time axis label", questions[0]["text"])

    def test_nta_q_colon_image_export_headers_are_segmented(self) -> None:
        questions = parse_questions_from_text(
            "Lang English\n"
            "Q:1\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101661\n"
            "Let A be a complex set. Then B:\n"
            "Question:\n"
            "A is an empty set\n"
            "Q:2\n"
            "Topic Name:Physics-Section A\n"
            "The magnetic field due to a long wire is:\n"
            "Question:\n"
            "A mu0 I / 2 pi r\n",
            document_id="jee-main-2022-06-24-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["source_refs"][0]["question_number"] for item in questions],
            ["1", "2"],
        )
        self.assertIn("complex set", questions[0]["text"])
        self.assertIn("magnetic field", questions[1]["text"])
        self.assertNotIn("Q:2", questions[0]["text"])

    def test_nta_2022_garbled_q_headers_recover_from_topic_blocks(self) -> None:
        questions = parse_questions_from_text(
            "Q:10\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101670\n"
            "Find the maximum of f(x).\n"
            "Ql\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101671\n"
            "If the tangent passes through the origin.\n"
            "Q:12\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101672\n"
            "Find the area of the triangle.\n"
            "Q:13\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101673\n"
            "Evaluate the definite integral.\n"
            "Q:4\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101674\n"
            "Solve the differential equation.\n",
            document_id="jee-main-2022-06-24-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["source_refs"][0]["question_number"] for item in questions],
            ["10", "11", "12", "13", "14"],
        )
        self.assertIn("tangent", questions[1]["text"])
        self.assertIn("differential", questions[4]["text"])

    def test_nta_2022_itemcode_recovers_extra_digit_q_headers(self) -> None:
        questions = parse_questions_from_text(
            "Q:1\n"
            "Topic Name:Mathematics-Section A\n"
            "TtemCode:101061\n"
            "Let f(x) be a real function.\n"
            "Q:2\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101062\n"
            "Let A be a complex set.\n"
            "Q:33\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101063\n"
            "Let A be a 3x3 invertible matrix.\n"
            "Q:4\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101064\n"
            "Find the ordered pair (a, b).\n"
            "Q:5\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101065\n"
            "Find the remainder.\n",
            document_id="jee-main-2022-06-26-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["source_refs"][0]["question_number"] for item in questions],
            ["1", "2", "3", "4", "5"],
        )
        self.assertIn("invertible", questions[2]["text"])
        self.assertIn("ordered pair", questions[3]["text"])

    def test_nta_2022_itemcode_recovers_garbled_header_across_page_break(self) -> None:
        questions = parse_questions_from_text(
            "Q:12\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101072\n"
            "Let C be a circle passing through A and B.\n"
            "Q3\f"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101073\n"
            "Let the normal at P pass through (5, -8).\n"
            "Q:14\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101074\n"
            "If the two lines are perpendicular.\n",
            document_id="jee-main-2022-06-26-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["source_refs"][0]["question_number"] for item in questions],
            ["12", "13", "14"],
        )
        self.assertIn("normal at P", questions[1]["text"])
        self.assertNotIn("Q3", questions[0]["text"])

    def test_nta_2022_itemcode_does_not_jump_ahead_on_series_break(self) -> None:
        questions = parse_questions_from_text(
            "Q:1\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101061\n"
            "Find the first matrix.\n"
            "Q:2\n"
            "Topic Name:Mathematics-Section A\n"
            "ItemCode:101062\n"
            "Find the second matrix.\n"
            "Q:33\n"
            "Topic Name:Physics-Section A\n"
            "ItemCode:101003\n"
            "An object is thrown vertically upward.\n",
            document_id="jee-main-2022-06-26-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["source_refs"][0]["question_number"] for item in questions],
            ["1", "2", "33"],
        )
        self.assertIn("thrown vertically", questions[2]["text"])

    def test_nta_export_question_headers_are_segmented(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 26 Question Id : 10026 Question Type : MCQ\n"
            "A conducting loop is placed in a changing magnetic field.\nOptions:\n(A) 1\n"
            "Question Number : 27 Question Id : 10027 Question Type : MCQ\n"
            "Find the induced emf in the loop.\n",
            document_id="jee-main-2026-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual([item["source_refs"][0]["question_number"] for item in questions], ["26", "27"])
        self.assertIn("changing magnetic field", questions[0]["text"])

    def test_nta_global_numbering_restores_subjects_when_headers_are_missing(self) -> None:
        questions = parse_questions_from_text(
            "Mathematics Section A\n"
            "Question Number : 1 Question Type : MCQ\nFind a determinant.\n"
            "Question Number : 25 Question Type : SA\nFind an integral.\n"
            "Question Number : 26 Question Type : MCQ\nFind the force.\n"
            "Question Number : 50 Question Type : SA\nFind the current.\n"
            "Chemistry Section B\n"
            "Question Number : 51 Question Type : MCQ\nFind the compound.\n"
            "Question Number : 75 Question Type : SA\nFind the moles.\n",
            document_id="jee-main-2025-01-22-shift-2",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )
        document = document_record("jee-main-2025-01-22-shift-2", "a" * 64)
        document["exam"] = "JEE Main"
        document["subject"] = "Mathematics, Physics, Chemistry"

        inference = _apply_nta_subject_numbering(document, questions)

        self.assertEqual(inference["subject_block_size"], 25)
        self.assertEqual(
            [question["source_refs"][0]["subject_context"] for question in questions],
            ["Mathematics", "Mathematics", "Physics", "Physics", "Chemistry", "Chemistry"],
        )

    def test_nta_per_question_metadata_is_removed_across_wrap_variants(self) -> None:
        wrapped_metadata = (
            "Question Number : 1 Question Id : 10001 Question Type : MCQ "
            "Option Shuffling : Yes Display Question Number : Yes Is\n"
            "Question Mandatory : No Single Line Question Option : No "
            "Option Orientation : Vertical\n"
            "Find the first direction cosine.\n"
            "Question Number : 2 Question Id : 10002 Question Type : MCQ "
            "Option Shuffling : Yes Display Question Number :\n"
            "Yes Is Question Mandatory : No Single Line Question Option : No "
            "Option Orientation : Vertical\n"
            "Find the second direction cosine.\n"
            "Question Number : 3 Question Id : 10003 Question Type : MCQ "
            "Option Shuffling : Yes Display Question Number : Yes\n"
            "Is Question Mandatory : No Single Line Question Option : No "
            "Option Orientation : Vertical\n"
            "Find the third direction cosine.\n"
        )

        questions = parse_questions_from_text(
            wrapped_metadata,
            document_id="jee-main-2026-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["text"] for item in questions],
            [
                "Find the first direction cosine.",
                "Find the second direction cosine.",
                "Find the third direction cosine.",
            ],
        )

    def test_nta_split_question_mandatory_metadata_is_removed(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 1 Question Type : MCQ\n"
            "Number : Yes Is Question Mandatory : No\n"
            "Instruction Time : 0\n"
            "Find the electric potential.\n"
            "Question Number : 2 Question Type : MCQ\n"
            "Is Question Mandatory : No\n"
            "Find the magnetic flux.\n"
            "Question Number : 3 Question Type : MCQ\n"
            ": Yes Is Question Mandatory : No\n"
            "Find the induced emf.\n"
            "Question Number : 4 Question Type : SA Calculator : None Response\n"
            "Time : N.A Think Time : N.A Minimum Instruction Time : 0\n"
            "Find the resistance.\n",
            document_id="jee-main-2025-04-07-shift-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            [item["text"] for item in questions],
            [
                "Find the electric potential.",
                "Find the magnetic flux.",
                "Find the induced emf.",
                "Find the resistance.",
            ],
        )

    def test_nta_viewer_chrome_is_removed_from_page_spanning_question(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 1 Question Type : MCQ\n"
            "Find the electric field at the origin.\n"
            "https://g28.tcsion.com/CAE/pdf-preview 1/67\f"
            "4/4/25, 3:57 PM Online Question Paper PDF Preview\n"
            "Use the following charge configuration.\n"
            "Question Number : 2 Question Type : MCQ\n"
            "Find the magnetic field.\n",
            document_id="jee-main-2025-04-02-shift-2",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(len(questions), 2)
        self.assertNotIn("pdf-preview", questions[0]["text"])
        self.assertNotIn("Online Question Paper PDF Preview", questions[0]["text"])
        self.assertIn("Use the following charge configuration", questions[0]["text"])

    def test_nta_viewer_url_with_short_ocr_suffix_is_removed(self) -> None:
        questions = parse_questions_from_text(
            "Question Number : 72 Question Type : SA\n"
            "Find the current in the circuit.\n"
            "https://g28.tcsion.com/CAE/pdf-preview T4IT7\n"
            "Use the nearest integer value.\n",
            document_id="jee-main-2025-01-28-shift-1",
            document_sha256="a" * 64,
            extraction_method="tesseract-ocr-eng-fast-v1",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(
            questions[0]["text"],
            "Find the current in the circuit.\nUse the nearest integer value.",
        )

    def test_nta_preamble_and_numeric_options_do_not_require_segmentation_review(self) -> None:
        _questions, diagnostics = parse_questions_with_diagnostics(
            "National Testing Agency\nB. Tech\nGroup Number : 1\n"
            "Mathematics Section A\n"
            "Question Number : 1 Question Type : MCQ\n"
            "Find the determinant.\nOptions :\n17\n27\n24\n25\n",
            document_id="jee-main-2025-04-02-shift-2",
            document_sha256="a" * 64,
            extraction_method="test-text",
            question_pattern=NTA_QUESTION_PATTERN,
        )

        self.assertEqual(diagnostics["unassigned_nonempty_lines"], 0)
        self.assertEqual(diagnostics["suspicious_heading_lines"], [])
        self.assertFalse(diagnostics["review_required"])

    def test_cbse_bilingual_duplicate_number_prefers_english_occurrence(self) -> None:
        questions = parse_questions_from_text(
            "1. एक समतल का समीकरण ज्ञात कीजिए।\n"
            "1. Find the equation of the plane.\n"
            "2. Find its distance from the origin.\n",
            document_id="cbse-2025-mathematics-set-1",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )
        document = document_record("cbse-2025-mathematics-set-1", "a" * 64)
        document["exam"] = "CBSE Class XII Board Examination"
        document["subject"] = "Mathematics"

        selected, discarded = _select_cbse_english_variants(document, questions)

        self.assertEqual(discarded, 1)
        self.assertEqual(len(selected), 2)
        self.assertEqual(selected[0]["text"], "Find the equation of the plane.")

    def test_exact_deduplication_merges_source_appearances(self) -> None:
        first = parse_questions_from_text(
            "1. What is the speed of the particle?",
            document_id="example-2024-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]
        second = parse_questions_from_text(
            "7.  WHAT is the speed of the particle?  ",
            document_id="example-2025-physics-b",
            document_sha256="b" * 64,
            extraction_method="test-text",
        )[0]

        merged, duplicate_count = deduplicate_questions([first, second])

        self.assertEqual(duplicate_count, 1)
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(merged[0]["source_refs"]), 2)

    def test_reextraction_merges_artifact_hashes_without_fake_source(self) -> None:
        first = parse_questions_from_text(
            "Cover A\n1. What is the induced emf?",
            document_id="example-2025-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]
        second = parse_questions_from_text(
            "Changed cover\nPHYSICS\n1. What is the induced emf?",
            document_id="example-2025-physics-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]

        merged, duplicate_count = deduplicate_questions([first, second])

        self.assertEqual(duplicate_count, 1)
        self.assertEqual(len(merged[0]["source_refs"]), 1)
        self.assertEqual(
            merged[0]["source_refs"][0]["subject_context"], "Physics"
        )
        self.assertEqual(
            len(merged[0]["source_refs"][0]["extraction_artifact_sha256s"]), 2
        )

    def test_reextraction_rejects_conflicting_known_subject_contexts(self) -> None:
        physics = parse_questions_from_text(
            "PHYSICS\n1. What is the induced emf?",
            document_id="example-2025-pcm-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]
        mathematics = parse_questions_from_text(
            "MATHEMATICS\n1. What is the induced emf?",
            document_id="example-2025-pcm-a",
            document_sha256="a" * 64,
            extraction_method="test-text",
        )[0]

        with self.assertRaisesRegex(ValidationError, "conflicting subject context"):
            deduplicate_questions([physics, mathematics])

    def test_combined_paper_without_subject_context_abstains(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions_path = root / "questions.jsonl"
            rules_path = root / "classification-rules.json"
            document = document_record("example-2025-pcm-paper", "a" * 64)
            document["subject"] = "Physics, Chemistry, Mathematics"
            questions = parse_questions_from_text(
                "1. Find the induced emf in the loop.",
                document_id=document["document_id"],
                document_sha256=document["sha256"],
                extraction_method="test-text",
            )
            write_jsonl(manifest, [document])
            write_jsonl(questions_path, questions)
            rules_path.write_text(
                json.dumps(
                    {
                        "schema_version": "question-bank-classification-rules/v1",
                        "rules": [
                            {
                                "id": "physics-induced-emf",
                                "subject": "Physics",
                                "topic": "Electromagnetic Induction and Alternating Currents",
                                "subtopic": "Electromagnetic induction",
                                "difficulty": None,
                                "keywords_any": ["induced emf"],
                                "keywords_all": [],
                                "priority": 100,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            result = classify_questions(manifest, questions_path, rules_path)
            question = load_questions(questions_path)[0]

            self.assertIsNone(question["topic"])
            self.assertEqual(result["classified"], 0)
            self.assertEqual(result["context_required"], 1)

    def test_near_duplicate_report_does_not_merge_ocr_variants(self) -> None:
        first = parse_questions_from_text(
            "1. Calculate induced emf when magnetic flux changes at 4 Wb/s.",
            document_id="example-2024-physics-a",
            document_sha256="a" * 64,
            extraction_method="pdftotext-layout",
        )[0]
        second = parse_questions_from_text(
            "7. Calculate the induced emf when magnetic flux changes at 4 Wb/s.",
            document_id="example-2025-physics-b",
            document_sha256="b" * 64,
            extraction_method="tesseract-ocr",
        )[0]

        pairs, truncated = find_near_duplicate_questions(
            [first, second], minimum_similarity=0.85
        )

        self.assertEqual(len(pairs), 1)
        self.assertFalse(truncated)
        self.assertNotEqual(first["question_id"], second["question_id"])
        self.assertGreaterEqual(pairs[0]["similarity"], 0.85)

    def test_acquisition_indexes_an_existing_pdf_without_network(self) -> None:
        pdf_bytes = b"%PDF-1.4\nminimal test fixture\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            raw = root / "raw"
            raw.mkdir()
            document_id = "example-2025-physics-a"
            write_jsonl(manifest, [document_record(document_id, None, status="planned")])
            (raw / f"{document_id}.pdf").write_bytes(pdf_bytes)

            result = acquire_documents(manifest, raw, [document_id])
            acquired = load_documents(manifest)[0]

            self.assertEqual(result["documents"][0]["action"], "reused")
            self.assertEqual(acquired["sha256"], hashlib.sha256(pdf_bytes).hexdigest())
            self.assertEqual(acquired["status"], "acquired")
            self.assertIsNotNone(acquired["provenance"]["retrieved_at"])

    def test_classification_and_sqlite_build(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions_path = root / "questions.jsonl"
            rules_path = root / "classification-rules.json"
            database = root / "question-bank.sqlite"
            content_hash = "c" * 64
            document = document_record("example-2025-physics-a", content_hash)
            questions = parse_questions_from_text(
                "PHYSICS\n1. Calculate the acceleration of a block on a rough plane.",
                document_id=document["document_id"],
                document_sha256=content_hash,
                extraction_method="test-text",
            )
            write_jsonl(manifest, [document])
            write_jsonl(questions_path, questions)
            rules_path.write_text(
                json.dumps(
                    {
                        "schema_version": "question-bank-classification-rules/v1",
                        "rules": [
                            {
                                "id": "physics-mechanics-dynamics",
                                "subject": "Physics",
                                "topic": "Mechanics",
                                "subtopic": "Dynamics",
                                "difficulty": "medium",
                                "keywords_any": ["acceleration", "force"],
                                "keywords_all": [],
                                "priority": 100,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            classification = classify_questions(manifest, questions_path, rules_path)
            classified_question = load_questions(questions_path)[0]
            build = build_sqlite_database(manifest, questions_path, database)

            self.assertEqual(classification["classified"], 1)
            self.assertEqual(classified_question["topic"], "Mechanics")
            self.assertEqual(classified_question["subtopic"], "Dynamics")
            self.assertEqual(classified_question["difficulty"], "medium")
            self.assertEqual(build["questions"], 1)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM documents").fetchone(), (1,))
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM questions").fetchone(), (1,))
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM question_sources").fetchone(), (1,)
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT subject_context FROM question_sources"
                    ).fetchone(),
                    ("Physics",),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM metadata WHERE key = 'question_release_status'"
                    ).fetchone(),
                    ("candidate_only",),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM metadata WHERE key = 'schema_version'"
                    ).fetchone(),
                    ("question-bank-sqlite/v2",),
                )
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_corpus_validation_rejects_a_stale_source_hash(self) -> None:
        document = document_record("example-2025-physics-a", "a" * 64)
        question = parse_questions_from_text(
            "1. Find the focal length of the lens.",
            document_id=document["document_id"],
            document_sha256="b" * 64,
            extraction_method="test-text",
        )[0]

        with self.assertRaisesRegex(ValidationError, "does not match the manifest"):
            validate_corpus([document], [question])

    def test_question_v2_migration_adds_null_subject_context_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            questions_path = Path(temporary_directory) / "questions.jsonl"
            question = parse_questions_from_text(
                "1. Find the induced emf.",
                document_id="example-2025-physics-a",
                document_sha256="a" * 64,
                extraction_method="test-text",
            )[0]
            question["schema_version"] = "question-bank-question/v2"
            del question["source_refs"][0]["subject_context"]
            write_jsonl(questions_path, [question])

            dry_run = migrate_questions_v2_to_v3(questions_path, dry_run=True)
            self.assertEqual(dry_run["migrated"], 1)
            self.assertIn(
                '"schema_version":"question-bank-question/v2"',
                questions_path.read_text(encoding="utf-8"),
            )

            result = migrate_questions_v2_to_v3(questions_path)
            migrated = load_questions(questions_path)[0]
            self.assertEqual(result["migrated"], 1)
            self.assertIsNone(migrated["source_refs"][0]["subject_context"])

    def test_document_validation_rejects_future_retrieval_timestamp(self) -> None:
        document = document_record("example-2025-physics-a", "a" * 64)
        document["provenance"]["retrieved_at"] = "2099-01-01T00:00:00Z"

        with self.assertRaisesRegex(ValidationError, "timestamp is in the future"):
            validate_corpus([document], [])

    def test_extraction_offset_requires_complete_remaining_page_mapping(self) -> None:
        pdf_bytes = b"%PDF-1.4\nminimal test fixture\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions = root / "questions.jsonl"
            raw = root / "raw"
            raw.mkdir()
            document_id = "example-2025-physics-a"
            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
            document = document_record(document_id, content_hash)
            document["artifact"]["page_count"] = 3
            write_jsonl(manifest, [document])
            write_jsonl(questions, [])
            (raw / f"{document_id}.pdf").write_bytes(pdf_bytes)
            text_path = root / "truncated.txt"
            text_path.write_text("1. State Faraday's law.\n", encoding="utf-8")

            with self.assertRaisesRegex(PipelineError, "requires exactly 2 text pages"):
                extract_document(
                    manifest,
                    questions,
                    raw,
                    document_id,
                    text_path=text_path,
                    page_offset=1,
                )

    def test_extract_document_blocks_unresolved_shared_stem_without_writing(self) -> None:
        pdf_bytes = b"%PDF-1.4\nminimal test fixture\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions = root / "questions.jsonl"
            raw = root / "raw"
            raw.mkdir()
            document_id = "jee-advanced-2021-paper-1-english"
            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
            document = document_record(document_id, content_hash)
            document["exam"] = "JEE Advanced"
            write_jsonl(manifest, [document])
            write_jsonl(questions, [])
            (raw / f"{document_id}.pdf").write_bytes(pdf_bytes)
            text_path = root / "broken-shared-stem.txt"
            text_path.write_text(
                "Question Stem for Question Nos. 7 and 8\n"
                "Shared setup.\n"
                "Q.7 First part.\n"
                "Q.9 Unrelated next question.\n",
                encoding="utf-8",
            )

            manifest_before = manifest.read_bytes()
            questions_before = questions.read_bytes()

            with self.assertRaisesRegex(PipelineError, "blocking extraction issues"):
                extract_document(
                    manifest,
                    questions,
                    raw,
                    document_id,
                    text_path=text_path,
                )

            self.assertEqual(manifest.read_bytes(), manifest_before)
            self.assertEqual(questions.read_bytes(), questions_before)
            self.assertEqual(load_documents(manifest)[0]["status"], "acquired")

    def test_extract_document_persists_happy_path_shared_stem(self) -> None:
        pdf_bytes = b"%PDF-1.4\nminimal test fixture\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions = root / "questions.jsonl"
            raw = root / "raw"
            raw.mkdir()
            document_id = "jee-advanced-2021-paper-2-english"
            content_hash = hashlib.sha256(pdf_bytes).hexdigest()
            document = document_record(document_id, content_hash)
            document["exam"] = "JEE Advanced"
            write_jsonl(manifest, [document])
            write_jsonl(questions, [])
            (raw / f"{document_id}.pdf").write_bytes(pdf_bytes)
            text_path = root / "valid-shared-stem.txt"
            text_path.write_text(
                "Question Stem for Question Nos. 7 and 8\n"
                "Shared setup.\n"
                "Q.7 First part.\n"
                "Q.8 Second part.\n",
                encoding="utf-8",
            )

            result = extract_document(
                manifest,
                questions,
                raw,
                document_id,
                text_path=text_path,
            )

            stored_questions = load_questions(questions)
            self.assertEqual(result["candidates"], 2)
            self.assertEqual(load_documents(manifest)[0]["status"], "extracted")
            self.assertEqual(len(stored_questions), 2)
            self.assertTrue(all("Shared setup." in item["text"] for item in stored_questions))


if __name__ == "__main__":
    unittest.main()
