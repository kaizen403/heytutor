from __future__ import annotations

import unittest
from pathlib import Path

from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    question_content_sha256,
    question_id_for_text,
)
from question_bank.syllabus import assign_question, load_syllabus_inputs


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
TAXONOMY_PATH = DATA_ROOT / "syllabus-taxonomy.json"
MATHEMATICS_RULES_PATH = DATA_ROOT / "syllabus-rules-mathematics.json"
PHYSICS_RULES_PATH = DATA_ROOT / "syllabus-rules-physics.json"

PHYSICS_19_BAND_PATTERN = (
    r"\b(?:energy bands?(?: diagrams?)?|conduction band|valence band|[pn][ -]?type "
    r"semiconductors?|(?:forbidden (?:energy )?gap|band gap)\b.{0,80}\b(?:semiconductors?|"
    r"insulators?|crystalline solids?|energy bands?|conduction band|valence band)\b|"
    r"\b(?:semiconductors?|insulators?|crystalline solids?|energy bands?|conduction "
    r"band|valence band)\b.{0,80}(?:forbidden (?:energy )?gap|band gap))\b"
)


def document_record(
    document_id: str,
    subject: str,
    hash_character: str = "a",
) -> dict[str, object]:
    return {
        "schema_version": DOCUMENT_SCHEMA_VERSION,
        "document_id": document_id,
        "provenance": {
            "publisher": "Example examination board",
            "source_type": "official",
            "retrieved_at": "2025-01-01T00:00:00Z",
            "notes": None,
        },
        "year": 2025,
        "exam": "Example Exam",
        "session": "May",
        "set": "A",
        "subject": subject,
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
            "page_count": 10,
            "container_url": None,
            "container_sha256": None,
            "member_path": None,
        },
        "sha256": hash_character * 64,
        "status": "extracted",
    }


def source_ref(
    document: dict[str, object],
    *,
    subject_context: str | None,
    question_number: str = "1",
) -> dict[str, object]:
    return {
        "document_id": document["document_id"],
        "document_sha256": document["sha256"],
        "page_number": 1,
        "page_end": 1,
        "question_number": question_number,
        "subject_context": subject_context,
        "extraction_method": "test-text",
        "extracted_text_sha256": "d" * 64,
        "extraction_artifact_sha256s": ["e" * 64],
    }


def question_record(text: str, refs: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "question-bank-question/v3",
        "question_id": question_id_for_text(text),
        "text": text,
        "content_sha256": question_content_sha256(text),
        "topic": None,
        "subtopic": None,
        "difficulty": None,
        "answer": None,
        "status": "extracted",
        "source_refs": refs,
    }


class PhysicsSemiconductorRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.taxonomy, cls.rules_by_subject = load_syllabus_inputs(
            TAXONOMY_PATH,
            [MATHEMATICS_RULES_PATH, PHYSICS_RULES_PATH],
        )

    def assignment_for(self, text: str) -> dict[str, object]:
        document = document_record("example-paper", "Physics")
        question = question_record(text, [source_ref(document, subject_context=None)])
        return assign_question(
            question,
            {document["document_id"]: document},
            self.taxonomy,
            self.rules_by_subject,
        )

    def assert_semiconductor_band_classified(self, text: str) -> dict[str, object]:
        assignment = self.assignment_for(text)
        self.assertEqual(assignment["status"], "classified")
        self.assertEqual(assignment["primary_unit_id"], "physics|19")
        self.assertGreaterEqual(assignment["score"], 5)
        top_candidate = assignment["candidate_units"][0]
        self.assertTrue(
            any(
                evidence["kind"] == "pattern"
                and evidence["value"] == PHYSICS_19_BAND_PATTERN
                for evidence in top_candidate["evidence"]
            ),
            top_candidate["evidence"],
        )
        return assignment

    def assert_not_semiconductor(
        self,
        text: str,
        *,
        expected_primary_unit_id: str | None = None,
    ) -> dict[str, object]:
        assignment = self.assignment_for(text)
        self.assertNotEqual(assignment["primary_unit_id"], "physics|19")
        self.assertNotIn(
            "physics|19",
            [candidate["unit_id"] for candidate in assignment["candidate_units"]],
        )
        if expected_primary_unit_id is not None:
            self.assertEqual(assignment["primary_unit_id"], expected_primary_unit_id)
        return assignment

    def test_semiconductor_band_pattern_positive_phrasings(self) -> None:
        cases = {
            "energy band": "Draw the energy band of a semiconductor crystal.",
            "energy band diagram": "Draw the energy band diagram for a semiconductor device.",
            "conduction band": "Electrons enter the conduction band after thermal excitation.",
            "valence band": "Explain why the valence band is nearly full in a semiconductor.",
            "forbidden gap context after": (
                "Why is the forbidden energy gap small in semiconductors?"
            ),
            "band gap context before": (
                "In crystalline solids, the band gap determines electrical conductivity."
            ),
            "p-type semiconductor": "A p-type semiconductor is formed by acceptor doping.",
            "p type semiconductor": "A p type semiconductor has holes as majority carriers.",
            "n-type semiconductor": "An n-type semiconductor has electrons as majority carriers.",
        }
        for label, text in cases.items():
            with self.subTest(case=label):
                self.assert_semiconductor_band_classified(text)

    def test_semiconductor_band_pattern_negative_phrasings(self) -> None:
        atomic = self.assert_not_semiconductor(
            "State the energy levels of hydrogen atom in Bohr's model.",
            expected_primary_unit_id="physics|18",
        )
        self.assertEqual(atomic["status"], "classified")

        for label, text in {
            "atomic forbidden gap": (
                "Discuss the forbidden energy gap between atomic levels in hydrogen."
            ),
            "nuclear forbidden gap": (
                "Estimate the forbidden gap for nuclear shell transitions in a heavy nucleus."
            ),
            "generic energy": "Energy is conserved in an isolated system during motion.",
            "generic gap": "Find the gap between the two meter readings.",
            "generic band": "A rubber band is stretched by an external force.",
            "bare band gap": "The band gap was reported without naming any material system.",
        }.items():
            with self.subTest(case=label):
                self.assert_not_semiconductor(text)

    def test_synthetic_representative_phrasings_classify_as_semiconductors(self) -> None:
        cases = {
            "temperature and n-type": (
                "When the temperature of an n-type semiconductor is increased, the "
                "number of free electrons and holes both increase."
            ),
            "valence to conduction": (
                "The number of electrons excited from the valence band to the "
                "conduction band in a semiconductor increases with temperature."
            ),
            "energy band diagrams": (
                "Draw energy band diagrams of n-type and p-type semiconductors."
            ),
            "insulator forbidden gap": (
                "In insulators, the forbidden gap is very large because valence "
                "electrons are tightly bound."
            ),
        }
        for label, text in cases.items():
            with self.subTest(case=label):
                self.assert_semiconductor_band_classified(text)


if __name__ == "__main__":
    unittest.main()
