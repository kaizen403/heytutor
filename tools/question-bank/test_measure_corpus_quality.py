from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from measure_corpus_quality import (
    classify_filtered_row,
    is_english_enough,
    main,
    measure_corpus_quality,
)


def _question(question_id: str, text: str, document_id: str = "jee-main-2024-01-01-shift-1") -> dict:
    return {
        "question_id": question_id,
        "text": text,
        "source_refs": [
            {
                "document_id": document_id,
                "extraction_method": "tesseract-ocr-eng-fast-v1",
            }
        ],
    }


def _assignment(question_id: str, *, status: str, unit: str | None, reasons: list[str] | None = None) -> dict:
    return {
        "question_id": question_id,
        "status": status,
        "primary_unit_id": unit,
        "subject": "Physics",
        "review_reasons": reasons or [],
    }


class MeasureCorpusQualityTests(unittest.TestCase):
    def test_mixed_hindi_preamble_with_circuit_stem_is_diagram_cued_not_english(self) -> None:
        text = (
            "ÃØæ\x81Øæ ·¤èçÁ° ç·¤ SÍæØè ¥ßSÍæ ×ð´ ç·¤âè ¥æÎàæü â´ÏæçÚU\x98æ ·¤æð a.c. dæðÌ âð "
            "â´ØæðçÁÌ ·¤ÚUÙð ÂÚU ÏæÚUæ ÂýßæçãÌ ãæðÌè ãñÐ\n"
            "Explain why current flows through an ideal capacitor in a circuit "
            "connected to an a.c. source."
        )
        self.assertFalse(is_english_enough(text))
        self.assertEqual(classify_filtered_row(text), "not_english_diagram_cued")

    def test_clean_english_circuit_stem_is_measured(self) -> None:
        text = (
            "Explain why current flows through an ideal capacitor in a circuit "
            "connected to an a.c. source but not to a d.c. source."
        )
        self.assertTrue(is_english_enough(text))
        self.assertEqual(classify_filtered_row(text), "measured_diagram_worthy")

    def test_english_diagram_led_stem_without_cue_is_separate_bucket(self) -> None:
        text = (
            "A particle of mass 2 kg is acted upon by a constant force of 10 N. "
            "Find the acceleration of the particle after 3 seconds."
        )
        self.assertEqual(classify_filtered_row(text), "english_no_diagram_cue")

    def test_measure_splits_filtered_buckets_and_skips_non_classified(self) -> None:
        mixed = (
            "ÃØæ\x81Øæ ·¤èçÁ° ç·¤ SÍæØè ¥ßSÍæ ×ð´ ç·¤âè ¥æÎàæü â´ÏæçÚU\x98æ ·¤æð a.c. dæðÌ âð "
            "â´ØæðçÁÌ ·¤ÚUÙð ÂÚU ÏæÚUæ ÂýßæçãÌ ãæðÌè ãñÐ\n"
            "Explain why current flows through an ideal capacitor in a circuit "
            "connected to an a.c. source."
        )
        questions = [
            _question("q_mixed", mixed),
            _question(
                "q_english",
                "A particle of mass 2 kg is acted upon by a constant force of 10 N. "
                "Find the acceleration of the particle after 3 seconds.",
            ),
            _question(
                "q_algebra",
                "If A and B are two independent events such that P(A) = 1/2, find P(A and B).",
            ),
            _question("q_review", "Some unclassified stem about a magnetic field vector."),
        ]
        assignments = [
            _assignment("q_mixed", status="classified", unit="physics|14"),
            _assignment("q_english", status="classified", unit="physics|3"),
            _assignment("q_algebra", status="classified", unit="maths|13"),
            _assignment(
                "q_review",
                status="needs_review",
                unit=None,
                reasons=["no_unit_evidence"],
            ),
        ]
        documents = [
            {
                "document_id": "jee-main-2024-01-01-shift-1",
                "exam": "JEE Main",
            }
        ]

        report = measure_corpus_quality(questions, assignments, documents)

        self.assertEqual(report["totals"]["filtered_low_quality"], 2)
        self.assertEqual(report["filtered_low_quality_split"]["not_english_diagram_cued"], 1)
        self.assertEqual(report["filtered_low_quality_split"]["english_no_diagram_cue"], 1)
        self.assertEqual(report["totals"]["not_diagram_led"], 1)
        self.assertEqual(report["totals"]["needs_review"], 1)
        self.assertEqual(report["not_english_by_exam"]["jee_main"], 1)
        self.assertGreaterEqual(
            report["filtered_low_quality_split"]["not_english_with_clean_ascii_prompt"],
            1,
        )

    def test_main_skips_when_corpus_jsonl_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            missing = Path(raw) / "missing.jsonl"
            code = main(
                [
                    "--questions",
                    str(missing),
                    "--syllabus",
                    str(missing),
                    "--manifest",
                    str(missing),
                    "--report",
                    str(Path(raw) / "report.json"),
                ]
            )
            self.assertEqual(code, 0)
            self.assertFalse((Path(raw) / "report.json").exists())

    def test_main_writes_report_when_corpus_is_present(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            questions_path = Path(raw) / "questions.jsonl"
            syllabus_path = Path(raw) / "syllabus.jsonl"
            report_path = Path(raw) / "report.json"
            questions_path.write_text(
                json.dumps(_question("q_english", "A force of 10 N acts on a mass of 2 kg for 3 seconds."))
                + "\n",
                encoding="utf-8",
            )
            syllabus_path.write_text(
                json.dumps(
                    _assignment("q_english", status="classified", unit="physics|3")
                )
                + "\n",
                encoding="utf-8",
            )
            code = main(
                [
                    "--questions",
                    str(questions_path),
                    "--syllabus",
                    str(syllabus_path),
                    "--manifest",
                    str(Path(raw) / "missing-manifest.jsonl"),
                    "--report",
                    str(report_path),
                ]
            )
            self.assertEqual(code, 0)
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema"], "corpus-quality-breakdown/v1")
            self.assertEqual(payload["totals"]["filtered_low_quality"], 1)
            self.assertEqual(
                payload["filtered_low_quality_split"]["english_no_diagram_cue"],
                1,
            )


if __name__ == "__main__":
    unittest.main()
