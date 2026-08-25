from __future__ import annotations


import copy
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from question_bank.models import (
    DOCUMENT_SCHEMA_VERSION,
    ValidationError,
    question_content_sha256,
    question_id_for_text,
    write_jsonl,
)
from question_bank.syllabus import (
    ASSIGNMENT_SCHEMA_VERSION,
    assign_question,
    build_assignments,
    build_full_sqlite_database,
    build_syllabus_index,
    load_syllabus_inputs,
    make_report,
    quality_review_reasons,
    score_question_units,
    validate_assignment,
    validate_assignments,
    validate_taxonomy,
    validate_unit_rules,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = REPOSITORY_ROOT / "data" / "question-bank"
TAXONOMY_PATH = DATA_ROOT / "syllabus-taxonomy.json"
MATHEMATICS_RULES_PATH = DATA_ROOT / "syllabus-rules-mathematics.json"
PHYSICS_RULES_PATH = DATA_ROOT / "syllabus-rules-physics.json"


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


def question_record(
    text: str,
    refs: list[dict[str, object]],
    *,
    topic: str | None = None,
    subtopic: str | None = None,
) -> dict[str, object]:
    content_hash = question_content_sha256(text)
    return {
        "schema_version": "question-bank-question/v3",
        "question_id": question_id_for_text(text),
        "text": text,
        "content_sha256": content_hash,
        "topic": topic,
        "subtopic": subtopic,
        "difficulty": None,
        "answer": None,
        "status": "classified" if topic is not None else "extracted",
        "source_refs": refs,
    }


class SyllabusIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.taxonomy, cls.rules_by_subject = load_syllabus_inputs(
            TAXONOMY_PATH,
            [MATHEMATICS_RULES_PATH, PHYSICS_RULES_PATH],
        )

    def assignment_for(
        self,
        text: str,
        subject: str,
        *,
        topic: str | None = None,
        subtopic: str | None = None,
    ) -> dict[str, object]:
        document = document_record("example-paper", subject)
        question = question_record(
            text,
            [source_ref(document, subject_context=None)],
            topic=topic,
            subtopic=subtopic,
        )
        return assign_question(
            question,
            {document["document_id"]: document},
            self.taxonomy,
            self.rules_by_subject,
        )

    def test_strict_taxonomy_rules_and_assignment_validators(self) -> None:
        invalid_taxonomy = copy.deepcopy(self.taxonomy)
        invalid_taxonomy["unexpected"] = True
        with self.assertRaisesRegex(ValidationError, "unknown fields"):
            validate_taxonomy(invalid_taxonomy)

        unknown_framework = copy.deepcopy(self.taxonomy)
        unknown_framework["subjects"][0]["units"][0]["topics"][0][
            "framework_ids"
        ].append("unknown-framework")
        with self.assertRaisesRegex(ValidationError, "unknown framework"):
            validate_taxonomy(unknown_framework)

        invalid_rules = copy.deepcopy(self.rules_by_subject["Mathematics"])
        invalid_rules["units"][0]["patterns"] = ["["]
        with self.assertRaisesRegex(ValidationError, "invalid regular expression"):
            validate_unit_rules(invalid_rules, self.taxonomy)

        assignment = self.assignment_for(
            "Determine the power set of the given finite set.", "Mathematics"
        )
        invalid_assignment = copy.deepcopy(assignment)
        invalid_assignment["unexpected"] = True
        with self.assertRaisesRegex(ValidationError, "unknown fields"):
            validate_assignment(invalid_assignment, self.taxonomy)

        invalid_assignment = copy.deepcopy(assignment)
        invalid_assignment["candidate_units"][0]["evidence"][0]["weight"] = 7
        with self.assertRaisesRegex(ValidationError, "does not match the evidence kind"):
            validate_assignment(invalid_assignment, self.taxonomy)

        invalid_assignment = copy.deepcopy(assignment)
        invalid_assignment["primary_unit_id"] = "maths|unknown"
        with self.assertRaisesRegex(ValidationError, "unknown taxonomy unit"):
            validate_assignment(invalid_assignment, self.taxonomy)

    def test_subject_fallback_missing_conflict_and_chemistry(self) -> None:
        maths_document = document_record("maths-paper", "Maths", "a")
        maths_question = question_record(
            "Determine the power set of the given finite set.",
            [source_ref(maths_document, subject_context=None)],
        )
        maths_assignment = assign_question(
            maths_question,
            {maths_document["document_id"]: maths_document},
            self.taxonomy,
            self.rules_by_subject,
        )
        self.assertEqual(maths_assignment["subject"], "Mathematics")
        self.assertEqual(maths_assignment["subject_status"], "resolved")

        combined = document_record(
            "combined-paper", "Physics, Chemistry, Mathematics", "b"
        )
        missing = question_record(
            "Find the induced current in the conducting loop.",
            [source_ref(combined, subject_context=None)],
        )
        missing_assignment = assign_question(
            missing,
            {combined["document_id"]: combined},
            self.taxonomy,
            self.rules_by_subject,
        )
        self.assertIsNone(missing_assignment["subject"])
        self.assertEqual(missing_assignment["subject_status"], "missing_context")
        self.assertIsNone(missing_assignment["primary_unit_id"])

        physics_document = document_record("physics-paper", "Physics", "c")
        conflict = question_record(
            "Find the value from the supplied information.",
            [
                source_ref(maths_document, subject_context="Mathematics"),
                source_ref(
                    physics_document,
                    subject_context="Physics",
                    question_number="2",
                ),
            ],
        )
        conflict_assignment = assign_question(
            conflict,
            {
                maths_document["document_id"]: maths_document,
                physics_document["document_id"]: physics_document,
            },
            self.taxonomy,
            self.rules_by_subject,
        )
        self.assertEqual(conflict_assignment["subject_status"], "conflict")
        self.assertIn("conflicting_subject_context", conflict_assignment["review_reasons"])

        chemistry_document = document_record("chemistry-paper", "Chemistry", "f")
        chemistry = question_record(
            "Find the molarity of the aqueous solution.",
            [source_ref(chemistry_document, subject_context=None)],
        )
        chemistry_assignment = assign_question(
            chemistry,
            {chemistry_document["document_id"]: chemistry_document},
            self.taxonomy,
            self.rules_by_subject,
        )
        self.assertEqual(chemistry_assignment["subject"], "Chemistry")
        self.assertEqual(chemistry_assignment["subject_status"], "out_of_scope")
        self.assertEqual(chemistry_assignment["status"], "out_of_scope")
        self.assertEqual(chemistry_assignment["syllabus_scope"], "out_of_scope")

    def test_scoring_thresholds_ties_and_exclusions(self) -> None:
        high = self.assignment_for(
            "Determine the power set of the given finite set.", "Mathematics"
        )
        self.assertEqual(high["primary_unit_id"], "maths|1")
        self.assertEqual(high["confidence"], "high")
        self.assertEqual(high["score"], 8)

        medium = self.assignment_for(
            "Evaluate lim_{x to 0} h(x) from the displayed expression.",
            "Mathematics",
        )
        self.assertEqual(medium["primary_unit_id"], "maths|7")
        self.assertEqual(medium["confidence"], "medium")
        self.assertEqual(medium["score"], 5)

        low = self.assignment_for(
            "Write the set in roster form using the supplied elements.",
            "Mathematics",
        )
        self.assertIsNone(low["primary_unit_id"])
        self.assertEqual(low["score"], 3)
        self.assertIn("unit_score_below_threshold", low["review_reasons"])

        tied = self.assignment_for(
            "Compare the power set and a complex number in this statement.",
            "Mathematics",
        )
        self.assertIsNone(tied["primary_unit_id"])
        self.assertEqual(tied["margin"], 0)
        self.assertIn("unit_score_tie", tied["review_reasons"])

        exclusion_question = {
            "text": "Use the power set while evaluating a limit.",
            "topic": None,
            "subtopic": None,
        }
        candidates = score_question_units(
            exclusion_question,
            "Mathematics",
            self.taxonomy,
            self.rules_by_subject,
        )
        set_candidate = next(item for item in candidates if item["unit_id"] == "maths|1")
        self.assertEqual(set_candidate["score"], 0)
        self.assertIn(
            {
                "kind": "exclusion",
                "value": "limit",
                "weight": -8,
            },
            set_candidate["evidence"],
        )

    def test_collision_guards_for_rms_lagrange_and_sound_resonance(self) -> None:
        gas = self.assignment_for(
            "At 400 K, the root mean square speed of gas molecules is required.",
            "Physics",
        )
        self.assertEqual(gas["primary_unit_id"], "physics|9")
        self.assertNotIn("physics|14", [item["unit_id"] for item in gas["candidate_units"]])

        lagrange = self.assignment_for(
            "Apply Lagrange's mean value theorem to the given differentiable function.",
            "Mathematics",
        )
        self.assertEqual(lagrange["primary_unit_id"], "maths|7")
        self.assertNotIn("maths|13", [item["unit_id"] for item in lagrange["candidate_units"]])

        sound = self.assignment_for(
            "A standing wave resonates in an organ pipe at its fundamental mode.",
            "Physics",
        )
        self.assertEqual(sound["primary_unit_id"], "physics|10")
        self.assertNotIn("physics|14", [item["unit_id"] for item in sound["candidate_units"]])

        resonance_tube = self.assignment_for(
            "Measure the speed of sound in air using a resonance tube.", "Physics"
        )
        self.assertEqual(resonance_tube["primary_unit_id"], "physics|20")
        self.assertNotIn(
            "physics|14",
            [item["unit_id"] for item in resonance_tube["candidate_units"]],
        )

    def test_ambiguous_mathematical_notation_does_not_create_unit_labels(self) -> None:
        cases = [
            ("Evaluate the integral of (A-B) with respect to x.", "maths|1"),
            ("If |A| = 4, find the magnitude of vector A.", "maths|3"),
            ("For sets A and B, write A × B.", "maths|12"),
            ("Point P divides the line segment AP in the ratio 2:1.", "maths|6"),
            ("Let f : R → R be a differentiable function.", "maths|12"),
            ("Find the differential equation of the family y = mx + c.", "maths|10"),
        ]
        for text, forbidden_unit_id in cases:
            with self.subTest(text=text):
                assignment = self.assignment_for(text, "Mathematics")
                self.assertNotEqual(assignment["primary_unit_id"], forbidden_unit_id)

        differentiable_mapping = self.assignment_for(
            "Let f : R → R be differentiable and find its local maxima.",
            "Mathematics",
        )
        self.assertEqual(differentiable_mapping["primary_unit_id"], "maths|7")
        self.assertNotIn(
            "maths|1",
            [item["unit_id"] for item in differentiable_mapping["candidate_units"]],
        )

        integral = self.assignment_for(
            "Evaluate the definite integral of sin 2x from 0 to pi.",
            "Mathematics",
        )
        self.assertEqual(integral["primary_unit_id"], "maths|8")
        self.assertNotIn(
            "maths|14", [item["unit_id"] for item in integral["candidate_units"]]
        )

        linear_programming = self.assignment_for(
            "Solve the linear programming problem with objective z = 3x + 2y.",
            "Mathematics",
        )
        self.assertEqual(
            linear_programming["primary_unit_id"],
            "maths|supplemental|linear-programming",
        )

        cartesian_product = self.assignment_for(
            "Find the Cartesian product of sets A and B.", "Mathematics"
        )
        self.assertEqual(cartesian_product["primary_unit_id"], "maths|1")

        combinatorics = self.assignment_for(
            "The number of ways of forming a queue of 4 boys and 3 girls is required.",
            "Mathematics",
        )
        self.assertEqual(combinatorics["primary_unit_id"], "maths|4")

        conic = self.assignment_for(
            "Find the eccentricity and focus of the given hyperbola.",
            "Mathematics",
        )
        self.assertEqual(conic["primary_unit_id"], "maths|10")

        conic_area = self.assignment_for(
            "Find the area bounded by the ellipse using integration.",
            "Mathematics",
        )
        self.assertEqual(conic_area["primary_unit_id"], "maths|8")
        self.assertEqual(conic_area["status"], "needs_review")
        self.assertIn("multi_unit_evidence", conic_area["review_reasons"])

        related_rates = self.assignment_for(
            "The radius of a circle is increasing at the rate of 3 cm/s.",
            "Mathematics",
        )
        self.assertEqual(related_rates["primary_unit_id"], "maths|7")

        geometric_median = self.assignment_for(
            "Find the length of the median through A in triangle ABC.",
            "Mathematics",
        )
        self.assertNotEqual(geometric_median["primary_unit_id"], "maths|13")

        progression = self.assignment_for(
            "The first term of an A.P. is 3 and its common difference is 2.",
            "Mathematics",
        )
        self.assertEqual(progression["primary_unit_id"], "maths|6")

    def test_cursor_math_high_precision_phrase_recoveries(self) -> None:
        """Cursor-owned Math backlog recoveries: long strong phrases only."""

        cases = [
            (
                "A and B are skew-symmetric matrices of same order. AB is symmetric if:",
                "maths|3",
            ),
            (
                "Find the particular solution of the differential equation "
                "dy/dx + y cot x = 4x cosec x, given that y = 0 when x = pi/2.",
                "maths|9",
            ),
            (
                "Find the general solution of the differential equation "
                "x dy/dx = y + x.",
                "maths|9",
            ),
            (
                "If A and B are two independent events such that P(A) = 1/2 "
                "and P(B) = 1/3, find P(A and B).",
                "maths|13",
            ),
            (
                "Find the shortest distance between the lines "
                "r = i + j + lambda(2i - j) and r = 2i - k + mu(i + j - k).",
                "maths|11",
            ),
            (
                "Find a unit vector perpendicular to each of the vectors "
                "a = i + j and b = i - j.",
                "maths|12",
            ),
            (
                "Find the absolute maximum and absolute minimum values of "
                "f(x) = 12x^(4/3) - 6x^(1/3) on [-1, 1].",
                "maths|7",
            ),
            # Pass 2 recoveries
            (
                "Find the inverse of the matrix A given below and verify A A^{-1} = I.",
                "maths|3",
            ),
            (
                "Show that f(x) = x^3 + x is a strictly increasing function on R.",
                "maths|7",
            ),
            (
                "Find the local maxima and local minima of f(x) = x^3 - 3x.",
                "maths|7",
            ),
            (
                "Find the value of the integral of sin x dx from 0 to pi/2.",
                "maths|8",
            ),
            (
                "Find the equation of the plane passing through the point (1, 1, 1) "
                "and perpendicular to the vector i + j + k.",
                "maths|11",
            ),
            (
                "If A and B are events with P(B) > 0, find the conditional probability P(A|B).",
                "maths|13",
            ),
            (
                "Find the roots of the quadratic equation x^2 - 5x + 6 = 0.",
                "maths|2",
            ),
            (
                "Prove that f : A → B defined by f(x) = 2x is a bijective function.",
                "maths|1",
            ),
            # Pass 3 recoveries
            (
                "Find the number of onto functions from a set with 4 elements "
                "to a set with 2 elements.",
                "maths|1",
            ),
            (
                "If z = 3 + 4i, represent the complex numbers on an Argand diagram.",
                "maths|2",
            ),
            (
                "Find the cofactor of a12 in the given matrix and write its transpose "
                "of the matrix.",
                "maths|3",
            ),
            (
                "The radius of a circle is increasing at the rate of change of 3 cm/s.",
                "maths|7",
            ),
            (
                "Find the area of the region bounded by the curve y = x^2 and the x-axis.",
                "maths|8",
            ),
            (
                "The degree of the differential equation "
                "(d^2y/dx^2)^3 + (dy/dx)^2 + y = 0 is:",
                "maths|9",
            ),
            (
                "Find the equation of the tangent to the curve y = x^2 at x = 1.",
                "maths|10",
            ),
            (
                "Find the angle between the lines "
                "(x-1)/2 = (y+1)/3 = (z-1)/6 and (x)/1 = (y)/2 = (z)/3.",
                "maths|11",
            ),
            (
                "A random variable X has the following probability distribution.",
                "maths|13",
            ),
            # Pass 4 recoveries (OCR-cleaned + remaining no_unit_evidence)
            (
                "Find the inverse of the function f(x) = 2x + 3.",
                "maths|1",
            ),
            (
                "If A is a 2 x 3 matrix such that AB and AB' are defined, "
                "then the order of the matrix B is:",
                "maths|3",
            ),
            (
                "Insert two arithmetic means between 4 and 16.",
                "maths|6",
            ),
            (
                "Find the local minimum of f(x) = x^3 - 3x + 2.",
                "maths|7",
            ),
            (
                "Show that f(x) = x^3 is increasing in the interval (0, infinity).",
                "maths|7",
            ),
            (
                "Find the area enclosed by the curve y = x^2 and the line y = 4.",
                "maths|8",
            ),
            (
                "Form the differential equation of the family of circles "
                "with centre on the x-axis.",
                "maths|9",
            ),
            (
                "Find the vector equation of the line passing through (1, 2, 3) "
                "and parallel to i + j + k.",
                "maths|11",
            ),
            (
                "Find a vector of magnitude 9 units in the direction of the vector "
                "-2i - j + 2k.",
                "maths|12",
            ),
            (
                "A ball is drawn at random from a bag containing 4 red and 5 black balls. "
                "Find the probability of the event that it is red.",
                "maths|13",
            ),
            (
                "The principal value of sin^{-1}(1/2) is:",
                "maths|14",
            ),
            # Pass 5 recoveries (English no_unit_evidence backlog)
            (
                "If f : A → B defined by f(x) = 2x is one-one and onto, find f inverse.",
                "maths|1",
            ),
            (
                "Let the system of linear equations x + y + z = 1, "
                "2x + y + 3z = 4 and x + 2z = 1 have a unique solution.",
                "maths|3",
            ),
            (
                "Find the projection of the vector a = i + j + k on the vector "
                "b = i - j.",
                "maths|12",
            ),
        ]
        for text, unit_id in cases:
            with self.subTest(unit_id=unit_id, text=text[:48]):
                assignment = self.assignment_for(text, "Mathematics")
                self.assertEqual(assignment["status"], "classified")
                self.assertEqual(assignment["primary_unit_id"], unit_id)
                self.assertIn(assignment["confidence"], {"high", "medium"})

        # Short "Solve the differential equation" is intentionally not a strong
        # phrase: multi-part pages that also say "using integration" must keep
        # the integral unit instead of flipping to differential equations.
        merged = self.assignment_for(
            "Solve the differential equation (x^2 + y^2) dx + xy dy = 0. "
            "Also find the area of the region using integration.",
            "Mathematics",
        )
        self.assertEqual(merged["primary_unit_id"], "maths|8")
        self.assertNotEqual(merged["primary_unit_id"], "maths|9")

    def test_cross_domain_physics_terms_require_chapter_context(self) -> None:
        abstentions = [
            ("The force is expressed in SI units. Calculate its value.", "physics|1"),
            (
                "A projectile moves under acceleration due to gravity. Find its range.",
                "physics|6",
            ),
            (
                "A charged particle in a magnetic field experiences centripetal force.",
                "physics|3",
            ),
            (
                "The electrostatic force is conservative. Find the electric potential.",
                "physics|4",
            ),
            (
                "Find the mean free path of an electron in a metal conductor.",
                "physics|9",
            ),
            (
                "X-ray astronomy is possible from satellites orbiting Earth.",
                "physics|6",
            ),
            (
                "Neither the source nor the observer is moving.",
                "physics|19",
            ),
        ]
        for text, forbidden_unit_id in abstentions:
            with self.subTest(text=text):
                assignment = self.assignment_for(text, "Physics")
                self.assertNotEqual(assignment["primary_unit_id"], forbidden_unit_id)

        atomic = self.assignment_for(
            "In the Bohr model, find the angular momentum of the electron.",
            "Physics",
        )
        self.assertEqual(atomic["primary_unit_id"], "physics|18")

        communication = self.assignment_for(
            "A communication system uses sky wave propagation and amplitude modulation.",
            "Physics",
        )
        self.assertEqual(
            communication["primary_unit_id"],
            "physics|supplemental|communication-systems",
        )
        self.assertNotIn(
            "physics|15",
            [item["unit_id"] for item in communication["candidate_units"]],
        )

        atomic_spectrum = self.assignment_for(
            "Which infrared line belongs to the Paschen series of hydrogen spectrum?",
            "Physics",
        )
        self.assertEqual(atomic_spectrum["primary_unit_id"], "physics|18")

        electrostatic = self.assignment_for(
            "Electrostatic force is a conservative force.", "Physics"
        )
        self.assertNotEqual(electrostatic["primary_unit_id"], "physics|4")

        mechanics = self.assignment_for(
            "Find the coefficient of friction for a block on a rough inclined plane.",
            "Physics",
        )
        self.assertEqual(mechanics["primary_unit_id"], "physics|3")

        rolling = self.assignment_for(
            "A solid cylinder rolls without slipping on a rough horizontal surface; find its acceleration and coefficient of friction.",
            "Physics",
        )
        self.assertEqual(rolling["primary_unit_id"], "physics|5")
        self.assertNotIn(
            "physics|3", [item["unit_id"] for item in rolling["candidate_units"]]
        )

        fluid = self.assignment_for(
            "A bubble rises with terminal speed; calculate the coefficient of viscosity.",
            "Physics",
        )
        self.assertEqual(fluid["primary_unit_id"], "physics|7")

        gravitation = self.assignment_for(
            "A geostationary satellite orbits Earth; find its orbital velocity.",
            "Physics",
        )
        self.assertEqual(gravitation["primary_unit_id"], "physics|6")

        thermodynamics = self.assignment_for(
            "A monatomic ideal gas expands adiabatically and does work.", "Physics"
        )
        self.assertEqual(thermodynamics["primary_unit_id"], "physics|8")

        projectile = self.assignment_for(
            "A projectile is launched horizontally and hits the ground; find its time of flight.",
            "Physics",
        )
        self.assertEqual(projectile["primary_unit_id"], "physics|2")

        elastic_solid = self.assignment_for(
            "Calculate the breaking stress of the wire from its maximum load.",
            "Physics",
        )
        self.assertEqual(elastic_solid["primary_unit_id"], "physics|7")

        string_wave = self.assignment_for(
            "A string fixed at two ends vibrates in its fifth harmonic.", "Physics"
        )
        self.assertEqual(string_wave["primary_unit_id"], "physics|10")

        electronics = self.assignment_for(
            "Draw the symbol and truth table of the logic gate.", "Physics"
        )
        self.assertEqual(electronics["primary_unit_id"], "physics|19")

        dielectric_wave = self.assignment_for(
            "An electromagnetic wave propagates through a dielectric medium.",
            "Physics",
        )
        self.assertEqual(dielectric_wave["primary_unit_id"], "physics|15")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in dielectric_wave["candidate_units"]
                    if item["unit_id"] == "physics|11"
                ),
                0,
            ),
            0,
        )

        brewster = self.assignment_for(
            "Unpolarized light is incident on a dielectric at the Brewster angle.",
            "Physics",
        )
        self.assertEqual(brewster["primary_unit_id"], "physics|16")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in brewster["candidate_units"]
                    if item["unit_id"] == "physics|11"
                ),
                0,
            ),
            0,
        )

        ac_circuit = self.assignment_for(
            "An AC voltage source is connected to a capacitor and inductor; find the impedance.",
            "Physics",
        )
        self.assertEqual(ac_circuit["primary_unit_id"], "physics|14")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in ac_circuit["candidate_units"]
                    if item["unit_id"] == "physics|11"
                ),
                0,
            ),
            0,
        )

        maxwell = self.assignment_for(
            "Find the displacement currents between the plates of a capacitor.",
            "Physics",
        )
        self.assertEqual(maxwell["primary_unit_id"], "physics|15")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in maxwell["candidate_units"]
                    if item["unit_id"] == "physics|11"
                ),
                0,
            ),
            0,
        )

        semiconductor = self.assignment_for(
            "Compare carrier mobility in intrinsic and extrinsic semiconductors.",
            "Physics",
        )
        self.assertEqual(semiconductor["primary_unit_id"], "physics|19")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in semiconductor["candidate_units"]
                    if item["unit_id"] == "physics|12"
                ),
                0,
            ),
            0,
        )

        atomic_xray = self.assignment_for(
            "Find the K-alpha X-ray wavelength using Moseley's law.", "Physics"
        )
        self.assertEqual(atomic_xray["primary_unit_id"], "physics|18")
        self.assertNotEqual(atomic_xray["primary_unit_id"], "physics|15")

        detector = self.assignment_for(
            "Photo diodes detect infrared radiation and ultraviolet radiation.",
            "Physics",
        )
        self.assertEqual(detector["primary_unit_id"], "physics|19")

        orbital_current = self.assignment_for(
            "An electron moves around the nucleus in a circular orbit and produces an equivalent current.",
            "Physics",
        )
        self.assertEqual(orbital_current["primary_unit_id"], "physics|13")
        self.assertNotIn(
            "physics|18",
            [item["unit_id"] for item in orbital_current["candidate_units"]],
        )

        nuclear_radius = self.assignment_for(
            "Estimate the radius of the nucleus from its mass number.", "Physics"
        )
        self.assertEqual(nuclear_radius["primary_unit_id"], "physics|18")

        lowercase_led = self.assignment_for(
            "Scattering led him to infer that the size of nucleus is very small.",
            "Physics",
        )
        self.assertEqual(lowercase_led["primary_unit_id"], "physics|18")
        self.assertNotIn(
            "physics|19",
            [item["unit_id"] for item in lowercase_led["candidate_units"]],
        )

        uppercase_led = self.assignment_for(
            "An LED emits visible light.", "Physics"
        )
        self.assertEqual(uppercase_led["primary_unit_id"], "physics|19")

        maxwell_law = self.assignment_for(
            "Maxwell's generalization of Ampere's Circuital Law explains the displacement current between capacitor plates and EM waves.",
            "Physics",
        )
        self.assertEqual(maxwell_law["primary_unit_id"], "physics|15")
        self.assertLessEqual(
            next(
                (
                    item["score"]
                    for item in maxwell_law["candidate_units"]
                    if item["unit_id"] == "physics|11"
                ),
                0,
            ),
            0,
        )

        alternative_topics = self.assignment_for(
            "Describe electromagnetic waves OR state Huygens principle.", "Physics"
        )
        self.assertEqual(alternative_topics["status"], "needs_review")
        self.assertTrue(
            {"physics|15", "physics|16"}.issubset(
                {item["unit_id"] for item in alternative_topics["candidate_units"]}
            )
        )

        inverse_trig_case = self.assignment_for(
            "For an inverse trigonometric function, give the domain and range of its principal value branch.",
            "Mathematics",
        )
        self.assertEqual(inverse_trig_case["status"], "needs_review")
        self.assertTrue(
            {"maths|1", "maths|14"}.issubset(
                {item["unit_id"] for item in inverse_trig_case["candidate_units"]}
            )
        )

        spectrum = self.assignment_for(
            "Arrange radio waves and gamma rays in ascending order of frequency.",
            "Physics",
        )
        self.assertEqual(spectrum["primary_unit_id"], "physics|15")

    def test_overlapping_evidence_is_counted_once_and_multi_unit_text_is_reviewed(self) -> None:
        measurement = self.assignment_for(
            "The least count of the instrument is required.", "Physics"
        )
        self.assertEqual(measurement["primary_unit_id"], "physics|1")
        self.assertEqual(measurement["score"], 8)
        self.assertEqual(
            measurement["candidate_units"][0]["evidence"],
            [
                {
                    "kind": "strong_phrase",
                    "value": "least count",
                    "weight": 8,
                }
            ],
        )

        mixed = self.assignment_for(
            "Compare a power set and equivalence relation with a complex number.",
            "Mathematics",
        )
        self.assertEqual(mixed["primary_unit_id"], "maths|1")
        self.assertEqual(mixed["status"], "needs_review")
        self.assertIn("multi_unit_evidence", mixed["review_reasons"])

    def test_existing_topic_projection_is_dynamic_and_decisive(self) -> None:
        assignment = self.assignment_for(
            "Determine the requested value using the supplied information.",
            "Mathematics",
            topic="Three-Dimensional Geometry",
        )
        self.assertEqual(assignment["primary_unit_id"], "maths|11")
        self.assertEqual(assignment["score"], 20)
        self.assertEqual(assignment["status"], "needs_review")
        self.assertIn(
            "uncorroborated_existing_topic_projection",
            assignment["review_reasons"],
        )
        self.assertEqual(
            assignment["candidate_units"][0]["evidence"],
            [
                {
                    "kind": "existing_topic_projection",
                    "value": "Three-Dimensional Geometry",
                    "weight": 20,
                }
            ],
        )

        corroborated = self.assignment_for(
            "Find the direction ratios and direction cosines of the given line.",
            "Mathematics",
            topic="Three-Dimensional Geometry",
        )
        self.assertEqual(corroborated["primary_unit_id"], "maths|11")
        self.assertEqual(corroborated["status"], "classified")
        self.assertNotIn(
            "uncorroborated_existing_topic_projection",
            corroborated["review_reasons"],
        )

    def test_active_and_legacy_topic_lifecycle(self) -> None:
        active = self.assignment_for(
            "Find the direction ratios and direction cosines of the given line.",
            "Mathematics",
            topic="Three-Dimensional Geometry",
            subtopic="Direction ratios and direction cosines",
        )
        self.assertEqual(active["primary_topic_id"], "maths|11|direction-ratios-and-cosines")
        self.assertEqual(active["syllabus_scope"], "active")

        plane = self.assignment_for(
            "Find the equation of a plane in different forms.",
            "Mathematics",
            topic="Three-Dimensional Geometry",
            subtopic="Equations of a plane in different forms",
        )
        self.assertEqual(plane["primary_topic_id"], "maths|11|plane-equations")
        self.assertEqual(plane["syllabus_scope"], "outside_active_syllabus")

        doppler = self.assignment_for(
            "Explain the Doppler effect in sound for a moving source.",
            "Physics",
            topic="Oscillations and Waves",
            subtopic="Doppler effect in sound",
        )
        self.assertEqual(doppler["primary_topic_id"], "physics|10|doppler-effect-in-sound")
        self.assertEqual(doppler["syllabus_scope"], "outside_active_syllabus")

        resolving_power = self.assignment_for(
            "Find the resolving power of the microscope and telescope.",
            "Physics",
            topic="Optics",
            subtopic="Resolving power of the microscope and telescope",
        )
        self.assertEqual(
            resolving_power["primary_topic_id"],
            "physics|16|resolving-power-of-microscope-and-telescope",
        )
        self.assertEqual(
            resolving_power["syllabus_scope"], "outside_active_syllabus"
        )

    def test_supplemental_units_are_high_precision_and_subject_isolated(self) -> None:
        physics = self.assignment_for(
            "A communication system uses amplitude modulation of a carrier wave.",
            "Physics",
        )
        self.assertEqual(
            physics["primary_unit_id"],
            "physics|supplemental|communication-systems",
        )
        self.assertEqual(physics["syllabus_scope"], "outside_active_syllabus")
        self.assertTrue(
            all(
                evidence["kind"] == "supplemental_alias"
                for evidence in physics["candidate_units"][0]["evidence"]
            )
        )

        mathematics = self.assignment_for(
            "A communication system uses amplitude modulation of a carrier wave.",
            "Mathematics",
        )
        self.assertNotIn(
            "physics|supplemental|communication-systems",
            [item["unit_id"] for item in mathematics["candidate_units"]],
        )
        self.assertIsNone(mathematics["primary_unit_id"])

    def test_all_quality_gates_and_notation_heavy_mathematics(self) -> None:
        self.assertIn(
            "very_short_non_mathematical_text", quality_review_reasons("Hello.")
        )
        self.assertIn("option_only_fragment", quality_review_reasons("(A) 4"))
        merged = (
            "Determine the power set. ANSWER: "
            + "This likely belongs to another merged question. " * 4
        )
        merged_assignment = self.assignment_for(merged, "Mathematics")
        self.assertIn("possible_merged_questions", merged_assignment["review_reasons"])
        self.assertIsNone(merged_assignment["primary_unit_id"])
        self.assertTrue(merged_assignment["candidate_units"])

        answer_summary = self.assignment_for(
            "Electromagnetic waves travel in vacuum. Answers for the above questions: A, B, C.",
            "Physics",
        )
        self.assertIn(
            "possible_merged_questions", answer_summary["review_reasons"]
        )
        self.assertIsNone(answer_summary["primary_unit_id"])

        shared_stem = self.assignment_for(
            "Question Stem for Question Nos. 17 and 18: A common passage follows.",
            "Mathematics",
            topic="Matrices",
        )
        self.assertIn("possible_merged_questions", shared_stem["review_reasons"])
        self.assertIsNone(shared_stem["primary_unit_id"])

        paired_answer = self.assignment_for(
            "Answer Q.17 and Q.18 by appropriately matching the two columns.",
            "Physics",
            topic="Waves",
        )
        self.assertIn("possible_merged_questions", paired_answer["review_reasons"])
        self.assertIsNone(paired_answer["primary_unit_id"])

        merged_pages = self.assignment_for(
            "First item (A) 1 (B) 2 (C) 3 (D) 4 "
            "Second item (A) 5 (B) 6 (C) 7 (D) 8 Page 3 of 20",
            "Mathematics",
            topic="Matrices",
        )
        self.assertIn("possible_merged_questions", merged_pages["review_reasons"])
        self.assertIsNone(merged_pages["primary_unit_id"])

        ordinary_mcq = quality_review_reasons(
            "Choose the answer (A) 1 (B) 2 (C) 3 (D) 4 Page 3 of 20"
        )
        self.assertNotIn("possible_merged_questions", ordinary_mcq)

        corrupted = self.assignment_for(
            "\ue000\ue001\ue002\ue003 Determine the requested coordinate value.",
            "Mathematics",
            topic="Three-Dimensional Geometry",
        )
        self.assertIn("high_character_corruption_ratio", corrupted["review_reasons"])
        self.assertEqual(corrupted["status"], "needs_review")
        self.assertEqual(corrupted["primary_unit_id"], "maths|11")

        notation = self.assignment_for("∫₀¹x²dx=?", "Mathematics")
        self.assertNotIn(
            "very_short_non_mathematical_text", notation["review_reasons"]
        )
        self.assertEqual(notation["primary_unit_id"], "maths|8")
        self.assertEqual(notation["score"], 5)

        mixed_page = self.assignment_for(
            "An RC series circuit contains a capacitor. A later item asks for the dimensional formula.",
            "Physics",
        )
        self.assertEqual(mixed_page["primary_unit_id"], "physics|11")
        self.assertEqual(mixed_page["status"], "needs_review")
        self.assertIn("multi_unit_evidence", mixed_page["review_reasons"])

    def test_assignment_output_is_byte_stable_and_canonical_rows_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions_path = root / "questions.jsonl"
            assignments_path = root / "assignments.jsonl"
            database_path = root / "unused.sqlite"
            physics = document_record("physics-paper", "Physics", "a")
            mathematics = document_record("mathematics-paper", "Mathematics", "b")
            questions = [
                question_record(
                    "A transformer changes the alternating voltage.",
                    [source_ref(physics, subject_context=None)],
                ),
                question_record(
                    "Determine the power set of the given finite set.",
                    [source_ref(mathematics, subject_context=None)],
                ),
            ]
            write_jsonl(manifest, [physics, mathematics])
            write_jsonl(questions_path, list(reversed(questions)))
            canonical_before = questions_path.read_bytes()

            first: bytes | None = None
            for _ in range(2):
                build_syllabus_index(
                    manifest,
                    questions_path,
                    TAXONOMY_PATH,
                    [MATHEMATICS_RULES_PATH, PHYSICS_RULES_PATH],
                    assignments_path,
                    database_path,
                    build_database=False,
                )
                current = assignments_path.read_bytes()
                if first is None:
                    first = current
                else:
                    self.assertEqual(current, first)

            self.assertEqual(questions_path.read_bytes(), canonical_before)
            assert first is not None
            rows = [json.loads(line) for line in first.decode("utf-8").splitlines()]
            self.assertEqual(
                [row["question_id"] for row in rows],
                sorted(row["question_id"] for row in rows),
            )

            with self.assertRaisesRegex(
                ValidationError, "cannot replace a canonical input"
            ):
                build_syllabus_index(
                    manifest,
                    questions_path,
                    TAXONOMY_PATH,
                    [MATHEMATICS_RULES_PATH, PHYSICS_RULES_PATH],
                    questions_path,
                    database_path,
                    build_database=False,
                )

    def test_report_is_aggregate_only_with_bounded_id_samples(self) -> None:
        secret_text = "SECRET QUESTION TEXT with no matching unit evidence."
        document = document_record("maths-paper", "Mathematics")
        question = question_record(
            secret_text, [source_ref(document, subject_context=None)]
        )
        assignments = build_assignments(
            [document], [question], self.taxonomy, self.rules_by_subject
        )
        report = make_report(
            [document],
            [question],
            self.taxonomy,
            self.rules_by_subject,
            assignments,
            generated_at="2026-08-10T00:00:00Z",
        )
        repeated_report = make_report(
            [document],
            [question],
            self.taxonomy,
            self.rules_by_subject,
            assignments,
            generated_at="2026-08-10T00:00:00Z",
        )
        self.assertEqual(report, repeated_report)
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn(secret_text, serialized)
        self.assertEqual(report["input_counts"]["questions"], 1)
        self.assertEqual(report["output_counts"]["assignments"], 1)
        self.assertEqual(report["source_release_status"], "candidate_only")
        self.assertTrue(
            all(
                sample.startswith("q_")
                for samples in report["review_samples"].values()
                for sample in samples
            )
        )
        self.assertTrue(
            all(len(samples) <= 20 for samples in report["review_samples"].values())
        )

    def test_sqlite_full_index_row_foreign_key_and_integrity_invariants(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            manifest = root / "manifest.jsonl"
            questions_path = root / "questions.jsonl"
            database = root / "question-bank-full.sqlite"
            repeated_database = root / "question-bank-full-repeated.sqlite"
            mathematics = document_record("mathematics-paper", "Mathematics", "a")
            physics = document_record("physics-paper", "Physics", "b")
            questions = [
                question_record(
                    "Determine the power set of the given finite set.",
                    [source_ref(mathematics, subject_context=None)],
                ),
                question_record(
                    "At 400 K, find the root mean square speed of gas molecules.",
                    [source_ref(physics, subject_context=None)],
                ),
            ]
            write_jsonl(manifest, [mathematics, physics])
            write_jsonl(questions_path, questions)
            assignments = build_assignments(
                [mathematics, physics],
                questions,
                self.taxonomy,
                self.rules_by_subject,
            )

            result = build_full_sqlite_database(
                manifest,
                questions_path,
                database,
                self.taxonomy,
                assignments,
            )
            build_full_sqlite_database(
                manifest,
                questions_path,
                repeated_database,
                self.taxonomy,
                assignments,
            )

            self.assertEqual(result["questions"], 2)
            self.assertEqual(result["syllabus_assignments"], 2)
            self.assertEqual(database.read_bytes(), repeated_database.read_bytes())
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM questions").fetchone(),
                    (2,),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT COUNT(*) FROM syllabus_assignments"
                    ).fetchone(),
                    (2,),
                )
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM syllabus_units").fetchone(),
                    (38,),
                )
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM syllabus_topics").fetchone(),
                    (525,),
                )
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone(), ("ok",))
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM metadata WHERE key = 'question_release_status'"
                    ).fetchone(),
                    ("candidate_only",),
                )
                self.assertEqual(
                    connection.execute(
                        "SELECT value FROM metadata WHERE key = 'syllabus_assignment_schema_version'"
                    ).fetchone(),
                    (ASSIGNMENT_SCHEMA_VERSION,),
                )

    def test_assignment_set_requires_exactly_one_row_per_question(self) -> None:
        document = document_record("maths-paper", "Mathematics")
        question = question_record(
            "Determine the power set of the given finite set.",
            [source_ref(document, subject_context=None)],
        )
        assignments = build_assignments(
            [document], [question], self.taxonomy, self.rules_by_subject
        )
        with self.assertRaisesRegex(ValidationError, "exactly one assignment"):
            validate_assignments([], [question], self.taxonomy)
        with self.assertRaisesRegex(ValidationError, "duplicate question assignments"):
            validate_assignments(
                [assignments[0], copy.deepcopy(assignments[0])],
                [question],
                self.taxonomy,
            )


if __name__ == "__main__":
    unittest.main()
