from __future__ import annotations


import unittest

from build_corpus import (
    BuildError,
    _expected_nta_unique_question_count,
    _page_count,
    _validate_nta_unique_question_coverage,
)


def _question(number: int) -> dict[str, object]:
    return {
        "text": f"Question {number}",
        "source_refs": [
            {
                "document_id": "jee-main-2025-01-23-shift-1",
                "question_number": str(number),
                "subject_context": "Mathematics",
            }
        ],
    }


class BuildCorpusNtaCoverageTests(unittest.TestCase):
    def test_page_count_preserves_a_real_blank_final_page(self) -> None:
        self.assertEqual(_page_count("first\fsecond\f"), 2)
        self.assertEqual(_page_count("first\fsecond\f\f"), 3)

    def test_nta_2025_unique_coverage_mismatch_raises(self) -> None:
        document = {"exam": "JEE Main", "year": 2025}
        questions = [_question(number) for number in range(1, 70)]

        with self.assertRaisesRegex(BuildError, "69 != 75"):
            _validate_nta_unique_question_coverage(document, questions)

    def test_nta_2024_full_unique_coverage_passes(self) -> None:
        document = {"exam": "JEE Main", "year": 2024}
        questions = [_question(number) for number in range(1, 91)]

        _validate_nta_unique_question_coverage(document, questions)

    def test_nta_metadata_only_question_bodies_are_rejected(self) -> None:
        document = {"exam": "JEE Main", "year": 2025}
        questions = [_question(number) for number in range(1, 76)]
        for question in questions:
            question["text"] = "Options :"

        with self.assertRaisesRegex(BuildError, "substantive question coverage"):
            _validate_nta_unique_question_coverage(document, questions)

    def test_nta_small_number_of_ocr_fragments_remains_reviewable(self) -> None:
        document = {"exam": "JEE Main", "year": 2025}
        questions = [_question(number) for number in range(1, 76)]
        for question in questions[:3]:
            question["text"] = "Options :"

        _validate_nta_unique_question_coverage(document, questions)

    def test_expected_counts_follow_the_historical_nta_paper_formats(self) -> None:
        self.assertEqual(
            _expected_nta_unique_question_count({"exam": "JEE Main", "year": 2019}),
            90,
        )
        self.assertEqual(
            _expected_nta_unique_question_count({"exam": "JEE Main", "year": 2020}),
            75,
        )
        self.assertEqual(
            _expected_nta_unique_question_count({"exam": "JEE Main", "year": 2021}),
            90,
        )
        self.assertEqual(
            _expected_nta_unique_question_count({"exam": "JEE Main", "year": 2026}),
            75,
        )
        self.assertIsNone(
            _expected_nta_unique_question_count({"exam": "JEE Main", "year": 2018})
        )


if __name__ == "__main__":
    unittest.main()
