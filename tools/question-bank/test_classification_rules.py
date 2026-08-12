import unittest
from pathlib import Path

from question_bank.pipeline import _load_classification_rules, _matching_rule


REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_PATH = REPO_ROOT / "data/question-bank/classification-rules.json"


class ClassificationRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rules = _load_classification_rules(RULES_PATH)

    def classify(self, text: str, subject: str):
        return _matching_rule({"text": text}, self.rules, {subject.casefold()})

    def test_returns_null_difficulty_for_direction_cosines_rule(self) -> None:
        rule, ambiguity = self.classify(
            "Direction cosines of a line parallel to AB are to be found.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(rule["subtopic"], "Direction ratios and direction cosines")
        self.assertIsNone(rule["difficulty"])

    def test_returns_three_dimensional_geometry_for_plane_passing_through_points(self) -> None:
        rule, ambiguity = self.classify(
            "Find the equation of the plane passing through points (2, 1, 0), "
            "(3, 2, 2) and (1, 1, 7).",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(rule["subtopic"], "Equations of a plane in different forms")

    def test_returns_three_dimensional_geometry_for_coplanar_lines(self) -> None:
        rule, ambiguity = self.classify(
            "Show that the lines are coplanar.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(rule["subtopic"], "Intersection of a line and a plane; coplanar lines")

    def test_does_not_treat_non_coplanar_vectors_as_coplanar_lines(self) -> None:
        rule, ambiguity = self.classify(
            "Let a, b and c be three non-coplanar unit vectors, and let L be a "
            "line through the origin.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_does_not_return_three_dimensional_geometry_for_generic_line_intersection(self) -> None:
        rule, ambiguity = self.classify(
            "Find the point of intersection of these given lines.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_does_not_return_three_dimensional_geometry_for_plane_mirror_text(self) -> None:
        rule, ambiguity = self.classify(
            "A small needle is moved above a plane mirror until its inverted image "
            "is found at the position of the needle.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_returns_three_dimensional_geometry_for_line_of_intersection_of_planes(self) -> None:
        rule, ambiguity = self.classify(
            "Let L be the line of intersection of the planes x + y + z = 1 "
            "and 2x - y + z = 3.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(rule["subtopic"], "Equations of a plane in different forms")

    def test_returns_three_dimensional_geometry_for_plane_containing_both_lines(self) -> None:
        rule, ambiguity = self.classify(
            "Find the normal vector to the plane containing both the lines L1 and L2.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(rule["subtopic"], "Equations of a plane in different forms")

    def test_returns_three_dimensional_geometry_for_point_mirror_image_in_plane(self) -> None:
        rule, ambiguity = self.classify(
            "The point (3, 2, -1) is the mirror image of the point (1, 0, -1) "
            "with respect to the plane ax + by + cz = d.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(
            rule["subtopic"],
            "Distance of a point from a plane; reflection in a plane",
        )

    def test_returns_three_dimensional_geometry_for_foot_of_perpendicular_to_plane(self) -> None:
        rule, ambiguity = self.classify(
            "Find the coordinates of the foot of the perpendicular drawn from P "
            "to the plane 2x - y + 3z = 4.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Three-Dimensional Geometry")
        self.assertEqual(
            rule["subtopic"],
            "Distance of a point from a plane; reflection in a plane",
        )

    def test_does_not_treat_mirror_image_across_line_as_three_dimensional(self) -> None:
        rule, ambiguity = self.classify(
            "The curve C is the mirror image of the parabola y^2 = 4x with "
            "respect to the line x + y + 4 = 0.",
            "Mathematics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_returns_electromagnetic_induction_for_transformer_primary_secondary_coils(self) -> None:
        rule, ambiguity = self.classify(
            "The primary and secondary coils of an ideal step-down transformer "
            "consist of 650 and 25 turns respectively.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Transformer")

    def test_returns_electromagnetic_induction_for_faradays_law_with_typographic_apostrophe(self) -> None:
        rule, ambiguity = self.classify(
            "State Faraday’s law of electromagnetic induction.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Electromagnetic induction; Faraday's law; induced EMF")

    def test_returns_electromagnetic_induction_for_hyphenated_self_inductance(self) -> None:
        rule, ambiguity = self.classify(
            "Obtain an expression for the self-inductance of a coil.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Self inductance")

    def test_returns_electromagnetic_induction_for_series_lc_net_reactance(self) -> None:
        rule, ambiguity = self.classify(
            "In a series LC circuit connected to an AC source, the net reactance changes "
            "with the frequency of the source.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "LCR series circuit")

    def test_returns_alternating_currents_for_ac_source_without_lcr_phrase(self) -> None:
        rule, ambiguity = self.classify(
            "The components L, C and R are connected in series with an a.c. source.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Alternating current and voltage")

    def test_returns_induction_for_emf_induced_in_loop_reverse_phrasing(self) -> None:
        rule, ambiguity = self.classify(
            "The emf induced in the loop is finite when the current decreases steadily.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(
            rule["subtopic"],
            "Electromagnetic induction; Faraday's law; induced EMF",
        )

    def test_returns_induction_for_current_induced_in_loop_reverse_phrasing(self) -> None:
        rule, ambiguity = self.classify(
            "The current induced in the loop will be proportional to the dipole moment.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(
            rule["subtopic"],
            "Electromagnetic induction; Faraday's law; induced EMF",
        )

    def test_returns_induction_for_induced_current_in_conducting_loop(self) -> None:
        rule, ambiguity = self.classify(
            "A conducting loop rotates through a magnetic field; find the induced current.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(
            rule["subtopic"],
            "Electromagnetic induction; Faraday's law; induced EMF",
        )

    def test_returns_rms_subtopic_when_alternating_current_context_is_present(self) -> None:
        rule, ambiguity = self.classify(
            "Derive the root mean square value of an alternating current in terms "
            "of its peak value.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Peak and RMS values of AC voltage and current")

    def test_does_not_return_alternating_currents_for_gas_rms_speed(self) -> None:
        rule, ambiguity = self.classify(
            "At 400 K, the root mean square speed of a gas X is equal to the most "
            "probable molecular speed of gas Y.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_does_not_return_ac_resonance_for_resonance_air_column(self) -> None:
        rule, ambiguity = self.classify(
            "A tuning fork is in resonance with an air column in a pipe.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_returns_ac_resonance_for_resonant_frequency_of_circuit(self) -> None:
        rule, ambiguity = self.classify(
            "Find the resonant frequency of the circuit containing an inductor "
            "and a capacitor.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Resonance in AC circuits")

    def test_does_not_return_electromagnetic_induction_for_electric_flux_question(self) -> None:
        rule, ambiguity = self.classify(
            "The electric flux through a Gaussian spherical surface enclosing a point charge q is to be found.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNone(rule)

    def test_prefers_self_inductance_when_faraday_and_lenz_are_supporting_phrases(self) -> None:
        rule, ambiguity = self.classify(
            "State Faraday’s law of electromagnetic induction and mention the utility of "
            "Lenz’s law. Obtain an expression for self-inductance of a coil.",
            "Physics",
        )

        self.assertEqual(ambiguity, [])
        self.assertIsNotNone(rule)
        self.assertEqual(rule["topic"], "Electromagnetic Induction and Alternating Currents")
        self.assertEqual(rule["subtopic"], "Self inductance")


if __name__ == "__main__":
    unittest.main()
