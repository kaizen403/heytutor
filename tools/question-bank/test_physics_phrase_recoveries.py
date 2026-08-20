from __future__ import annotations

import unittest
from pathlib import Path

from question_bank.models import question_content_sha256, question_id_for_text
from question_bank.syllabus import assign_question, load_syllabus_inputs


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"


class PhysicsPhraseRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.taxonomy, cls.rules_by_subject = load_syllabus_inputs(
            DATA_ROOT / "syllabus-taxonomy.json",
            [
                DATA_ROOT / "syllabus-rules-mathematics.json",
                DATA_ROOT / "syllabus-rules-physics.json",
            ],
        )

    def assignment_for(self, text: str) -> dict[str, object]:
        document = {
            "document_id": "physics-phrase-regression",
            "subject": "Physics",
        }
        content_hash = question_content_sha256(text)
        question = {
            "schema_version": "question-bank-question/v3",
            "question_id": question_id_for_text(text),
            "text": text,
            "content_sha256": content_hash,
            "topic": None,
            "subtopic": None,
            "difficulty": None,
            "answer": None,
            "status": "extracted",
            "source_refs": [
                {
                    "document_id": document["document_id"],
                    "document_sha256": "a" * 64,
                    "page_number": 1,
                    "page_end": 1,
                    "question_number": "1",
                    "subject_context": "Physics",
                    "extraction_method": "test-text",
                    "extracted_text_sha256": content_hash,
                    "extraction_artifact_sha256s": [content_hash],
                }
            ],
        }
        return assign_question(
            question,
            {document["document_id"]: document},
            self.taxonomy,
            self.rules_by_subject,
        )

    def test_zero_drift_physics_phrase_recoveries(self) -> None:
        cases = [
            (
                "Calculate the magnetic field due to a long straight current "
                "carrying conductor at the observation point.",
                "physics|13",
            ),
            (
                "Find the electric potential at the centre of the charged spherical shell.",
                "physics|11",
            ),
            (
                "The half life of a radioactive sample is 10 days. Find the remaining "
                "fraction after 30 days.",
                "physics|18",
            ),
            (
                "Use Kirchhoff's rules to find the current through the 3 ohm resistor "
                "in the given network.",
                "physics|12",
            ),
            (
                "Write the expression for the Lorentz force on a particle of charge q "
                "moving with velocity v in a magnetic field B.",
                "physics|13",
            ),
            (
                "State the underlying principle of a cyclotron and explain how it "
                "accelerates charged particles.",
                "physics|13",
            ),
            (
                "The electric field due to an infinitely long uniformly charged straight "
                "wire is radial.",
                "physics|11",
            ),
            (
                "Explain how the intensity of the diffraction pattern changes as the "
                "order n of the diffraction band increases.",
                "physics|16",
            ),
        ]

        for text, expected_unit in cases:
            with self.subTest(unit_id=expected_unit):
                assignment = self.assignment_for(text)
                self.assertEqual(assignment["status"], "classified")
                self.assertEqual(assignment["primary_unit_id"], expected_unit)
                self.assertEqual(assignment["confidence"], "high")

        induced = self.assignment_for(
            "A conducting rod of length l moves in a uniform magnetic field B. "
            "Find the induced emf across the ends of the rod."
        )
        self.assertNotEqual(induced["primary_unit_id"], "physics|13")


if __name__ == "__main__":
    unittest.main()
