from __future__ import annotations


import copy
import json
import re
import unittest
from pathlib import Path

from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    ValidationError,
    question_content_sha256,
    question_id_for_text,
)
from question_bank.syllabus import (
    assign_question,
    load_syllabus_inputs,
    validate_unit_rules,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
TAXONOMY_PATH = DATA_ROOT / "syllabus-taxonomy.json"
MATHEMATICS_RULES_PATH = DATA_ROOT / "syllabus-rules-mathematics.json"
PHYSICS_RULES_PATH = DATA_ROOT / "syllabus-rules-physics.json"
CHEMISTRY_RULES_PATH = DATA_ROOT / "syllabus-rules-chemistry.json"


def document_record(document_id: str, subject: str) -> dict[str, object]:
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
        "sha256": "c" * 64,
        "status": "extracted",
    }


def question_record(text: str, document: dict[str, object], subject_context: str | None) -> dict[str, object]:
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
        "source_refs": [
            {
                "document_id": document["document_id"],
                "document_sha256": document["sha256"],
                "page_number": 1,
                "page_end": 1,
                "question_number": "1",
                "subject_context": subject_context,
                "extraction_method": "test-text",
                "extracted_text_sha256": "d" * 64,
                "extraction_artifact_sha256s": ["e" * 64],
            }
        ],
    }


def normalized_alias(value: str) -> str:
    return " ".join(re.sub(r"[^\w]+", " ", value.casefold()).split())


# One stem per regular unit, phrased the way JEE Main writes them.
UNIT_STEMS = {
    "chemistry|1": "When 10 g of H2 reacts with 64 g of O2, identify the limiting reagent and the mass of water formed.",
    "chemistry|2": "Calculate the de Broglie wavelength of an electron moving with a velocity of 2.0 x 10^6 m/s.",
    "chemistry|3": "The hybridisation of the central atom in XeF4 and the shape of the molecule are respectively",
    "chemistry|4": "Given the enthalpy of combustion of carbon and hydrogen, calculate the enthalpy of formation of methane using Hess's law.",
    "chemistry|5": "The depression in freezing point of a 0.1 m aqueous solution of K4[Fe(CN)6] is observed. Find the van't Hoff factor.",
    "chemistry|6": "The solubility product of AgCl is 1.8 x 10^-10. Calculate its molar solubility in 0.1 M NaCl solution.",
    "chemistry|7": "Calculate the emf of the cell Zn|Zn2+(0.1 M)||Cu2+(1 M)|Cu at 298 K using the Nernst equation.",
    "chemistry|8": "The half-life of a first order reaction is 30 min. Calculate the rate constant.",
    "chemistry|9": "Arrange B, C, N and O in increasing order of first ionisation enthalpy.",
    "chemistry|10": "Which oxoacid of phosphorus is a strong reducing agent: H3PO2, H3PO3 or H3PO4?",
    "chemistry|11": "Calculate the spin only magnetic moment of Mn2+ ion.",
    "chemistry|12": "Calculate the CFSE of [Co(NH3)6]3+ and state whether it is a high spin or low spin complex.",
    "chemistry|13": "In Kjeldahl's method, 0.5 g of an organic compound evolved ammonia that neutralised 10 mL of 1 M H2SO4. Find the percentage of nitrogen.",
    "chemistry|14": "Arrange the following carbocations in decreasing order of stability and explain using hyperconjugation.",
    "chemistry|15": "Ozonolysis of 2-methylbut-2-ene followed by Zn/H2O gives which products?",
    "chemistry|16": "Which of the following alkyl halides undergoes an SN2 reaction fastest with hydroxide ion?",
    "chemistry|17": "Benzaldehyde undergoes Cannizzaro reaction with concentrated NaOH to give which products?",
    "chemistry|18": "Aniline reacts with NaNO2 and HCl at 273 K to form benzenediazonium chloride. Name the reaction.",
    "chemistry|19": "Sucrose on hydrolysis gives glucose and fructose. Between which carbons is the glycosidic linkage in sucrose?",
    "chemistry|20": "In the titration of oxalic acid against KMnO4, why is the oxalic acid solution warmed to 60 degree C?",
}


class ChemistrySyllabusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.taxonomy, cls.rules_by_subject = load_syllabus_inputs(
            TAXONOMY_PATH,
            [MATHEMATICS_RULES_PATH, PHYSICS_RULES_PATH, CHEMISTRY_RULES_PATH],
        )
        cls.chemistry = next(
            subject for subject in cls.taxonomy["subjects"] if subject["subject_id"] == "chemistry"
        )

    def assignment_for(
        self,
        text: str,
        subject: str = "Chemistry",
        *,
        subject_context: str | None = None,
    ) -> dict[str, object]:
        document = document_record(f"{subject.casefold()}-paper", subject)
        question = question_record(text, document, subject_context)
        return assign_question(
            question,
            {document["document_id"]: document},
            self.taxonomy,
            self.rules_by_subject,
        )

    def test_taxonomy_has_twenty_regular_units_with_capped_specific_aliases(self) -> None:
        self.assertEqual(self.chemistry["name"], "Chemistry")
        self.assertEqual(
            [unit["unit_number"] for unit in self.chemistry["units"]],
            list(range(1, 21)),
        )
        for unit in self.chemistry["units"]:
            owners: dict[str, str] = {}
            self.assertGreaterEqual(len(unit["topics"]), 4, unit["unit_id"])
            for topic in unit["topics"]:
                with self.subTest(topic=topic["topic_id"]):
                    self.assertTrue(topic["topic_id"].startswith(f"{unit['unit_id']}|"))
                    self.assertEqual(topic["framework_ids"], ["jee-main-2026"])
                    self.assertLessEqual(len(topic["aliases"]), 40)
                    for alias in topic["aliases"]:
                        self.assertFalse(
                            " " not in alias and len(alias) < 6,
                            f"short single-word alias {alias!r}",
                        )
                        self.assertEqual(
                            owners.setdefault(normalized_alias(alias), topic["topic_id"]),
                            topic["topic_id"],
                            f"alias {alias!r} is shared inside {unit['unit_id']}",
                        )
        for alias in ("ortho", "meta", "para", "major", "mainly", "predominantly", "aromatic", "benzene", "toluene"):
            with self.subTest(generic=alias):
                self.assertFalse(
                    any(
                        normalized_alias(value) == alias
                        for unit in self.chemistry["units"]
                        for topic in unit["topics"]
                        for value in topic["aliases"]
                    )
                )
        for unit in self.chemistry["supplemental_units"]:
            self.assertIsNone(unit["unit_number"])
            self.assertTrue(unit["unit_id"].startswith("chemistry|supplemental|"))
            self.assertTrue(all(topic["framework_ids"] == [] for topic in unit["topics"]))

    def test_active_framework_note_names_all_three_subjects(self) -> None:
        framework = next(
            item for item in self.taxonomy["frameworks"] if item["framework_id"] == "jee-main-2026"
        )
        self.assertIn("Chemistry", framework["source"]["notes"])
        self.assertNotIn("Maths and Physics only", framework["source"]["notes"])

    def test_chemistry_rules_validate_and_stay_inside_their_subject(self) -> None:
        rules = self.rules_by_subject["Chemistry"]
        self.assertEqual(rules["subject"], "Chemistry")
        self.assertEqual(
            [rule["unit_id"] for rule in rules["units"]],
            [f"chemistry|{number}" for number in range(1, 21)],
        )
        validate_unit_rules(rules, self.taxonomy)

        crossed = copy.deepcopy(rules)
        crossed["units"].append({**copy.deepcopy(rules["units"][0]), "unit_id": "physics|1"})
        with self.assertRaisesRegex(ValidationError, "cross-subject"):
            validate_unit_rules(crossed, self.taxonomy)

        raw = json.loads(CHEMISTRY_RULES_PATH.read_text(encoding="utf-8"))
        self.assertEqual(raw["schema_version"], "question-bank-syllabus-unit-rules/v1")

    def test_one_stem_per_unit_classifies_to_that_unit(self) -> None:
        for expected_unit_id, text in UNIT_STEMS.items():
            with self.subTest(unit=expected_unit_id):
                assignment = self.assignment_for(text)
                self.assertEqual(assignment["subject_status"], "resolved")
                self.assertEqual(assignment["status"], "classified", assignment["review_reasons"])
                self.assertEqual(assignment["primary_unit_id"], expected_unit_id)
                self.assertEqual(assignment["syllabus_scope"], "active")
                self.assertTrue(
                    all(
                        candidate["unit_id"].startswith("chemistry|")
                        for candidate in assignment["candidate_units"]
                    )
                )

    def test_topic_is_resolved_inside_the_selected_unit(self) -> None:
        cases = {
            "chemistry|2|de-broglie-and-heisenberg": UNIT_STEMS["chemistry|2"],
            "chemistry|12|crystal-field-theory": UNIT_STEMS["chemistry|12"],
            "chemistry|13|quantitative-estimation-of-elements": UNIT_STEMS["chemistry|13"],
            "chemistry|17|alpha-hydrogen-aldol-cannizzaro-and-haloform": UNIT_STEMS["chemistry|17"],
            "chemistry|20|qualitative-analysis-of-anions": (
                "An aqueous salt solution gives a brown ring test with FeSO4 and conc. H2SO4. Identify the anion."
            ),
        }
        for expected_topic_id, text in cases.items():
            with self.subTest(topic=expected_topic_id):
                assignment = self.assignment_for(text)
                self.assertEqual(assignment["primary_topic_id"], expected_topic_id)

    def test_plain_sulphuric_acid_does_not_pull_a_mole_stem_into_p_block(self) -> None:
        assignment = self.assignment_for(
            "Calculate the number of moles of oxygen atoms present in 9.8 g of H2SO4."
        )
        self.assertEqual(assignment["primary_unit_id"], "chemistry|1")
        self.assertNotIn(
            "chemistry|10",
            [candidate["unit_id"] for candidate in assignment["candidate_units"]],
        )

    def test_physics_photoelectric_nuclear_and_gas_stems_stay_out_of_units_2_and_4(self) -> None:
        cases = {
            "photoelectric": (
                "chemistry|2",
                "In a photoelectric experiment the stopping potential is 1.5 V. Find the work function of the metal surface.",
            ),
            "nuclear": (
                "chemistry|2",
                "Using Bohr's model, estimate the mass defect and binding energy per nucleon of the nucleus.",
            ),
            "gas process": (
                "chemistry|4",
                "One mole of a monatomic ideal gas expands adiabatically. Using degrees of freedom, find the work done by the gas.",
            ),
            "heat engine": (
                "chemistry|4",
                "A Carnot engine works between 500 K and 300 K. Find the efficiency of the engine and the entropy change.",
            ),
        }
        for label, (forbidden_unit_id, text) in cases.items():
            with self.subTest(case=label):
                assignment = self.assignment_for(text)
                self.assertNotEqual(assignment["primary_unit_id"], forbidden_unit_id)
                self.assertNotEqual(assignment["status"], "classified")

    def test_historical_solid_state_lands_on_a_supplemental_unit(self) -> None:
        assignment = self.assignment_for(
            "Calculate the packing efficiency of a face centred cubic unit cell."
        )
        self.assertEqual(assignment["primary_unit_id"], "chemistry|supplemental|solid-state")
        self.assertEqual(assignment["syllabus_scope"], "outside_active_syllabus")

    def test_chemistry_context_in_a_combined_paper_resolves(self) -> None:
        assignment = self.assignment_for(
            UNIT_STEMS["chemistry|7"],
            "Physics, Chemistry, Mathematics",
            subject_context="Chemistry",
        )
        self.assertEqual(assignment["subject"], "Chemistry")
        self.assertEqual(assignment["primary_unit_id"], "chemistry|7")

    def test_physics_stem_never_takes_a_chemistry_unit(self) -> None:
        assignment = self.assignment_for(UNIT_STEMS["chemistry|2"], "Physics")
        self.assertEqual(assignment["subject"], "Physics")
        self.assertTrue(
            all(
                not candidate["unit_id"].startswith("chemistry|")
                for candidate in assignment["candidate_units"]
            )
        )

    def test_unsupported_subject_is_still_out_of_scope(self) -> None:
        for subject, context in (("Biology", None), ("Physics, Chemistry, Mathematics", "Botany")):
            with self.subTest(subject=subject, context=context):
                assignment = self.assignment_for(
                    "Describe the structure of a plant cell wall.",
                    subject,
                    subject_context=context,
                )
                self.assertIsNone(assignment["subject"])
                self.assertEqual(assignment["subject_status"], "out_of_scope")
                self.assertEqual(assignment["status"], "out_of_scope")
                self.assertEqual(assignment["syllabus_scope"], "out_of_scope")
                self.assertEqual(assignment["review_reasons"], ["unsupported_subject"])
                self.assertEqual(assignment["candidate_units"], [])


if __name__ == "__main__":
    unittest.main()
