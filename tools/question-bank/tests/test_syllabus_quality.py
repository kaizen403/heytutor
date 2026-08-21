from __future__ import annotations


import unittest

from question_bank.syllabus import quality_review_reasons


class SyllabusQualityTests(unittest.TestCase):
    def test_mojibake_preamble_with_clean_english_prompt_is_not_flagged(self) -> None:
        text = (
            "ÃØæ\x81Øæ ·¤èçÁ° ç·¤ SÍæØè ¥ßSÍæ ×ð´ ç·¤âè ¥æÎàæü â´ÏæçÚU\x98æ ·¤æð a.c. dæðÌ âð "
            "â´ØæðçÁÌ ·¤ÚUÙð ÂÚU ÏæÚUæ ÂýßæçãÌ ãæðÌè ãñÐ\n"
            "Explain why current flows through an ideal capacitor when it is connected "
            "to an a.c. source but not when it is connected to a d.c. source in a "
            "steady state."
        )
        self.assertNotIn(
            "high_character_corruption_ratio",
            quality_review_reasons(text),
        )

    def test_private_use_corruption_stays_flagged(self) -> None:
        text = "\ue000\ue001\ue002\ue003 Determine the requested coordinate value."
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_single_private_use_character_stays_flagged_in_long_clean_prompt(self) -> None:
        text = (
            "\ue000 Explain why current flows through an ideal capacitor when it is "
            "connected to an alternating current source but not to a direct current "
            "source after steady operation is established."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_replacement_character_stays_flagged(self) -> None:
        text = (
            "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd Explain why current flows through an ideal capacitor "
            "when it is connected to an alternating current source."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_single_replacement_character_stays_flagged_in_long_clean_prompt(self) -> None:
        text = (
            "\ufffd Explain why current flows through an ideal capacitor when it is "
            "connected to an alternating current source but not to a direct current "
            "source after steady operation is established."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_hindi_only_mojibake_stays_flagged_without_english_prompt(self) -> None:
        text = (
            "âêØæðüÎØ ¥æñÚU âêØæüSÌ ·ð¤ â×Ø âêØü ÜæÜ \x80Øæð´ ÂýÌèÌ ãæðÌæ ãñ? "
            "§â·¤æ ·¤æÚU\x87æ çÜç¹°Ð"
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_corrupted_english_prompt_line_stays_flagged(self) -> None:
        text = (
            "ç·¤âè ¿æÜ·¤ ×ð´ ÒÒçß\x9fææ´çÌ-·¤æÜÓ ÂÎ ·¤è ÂçÚUÖæáæ çÜç¹°Ð\n"
            "Define the term \x91relaxation time\x92 in a conductor."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_clean_english_line_with_removed_verb_stays_flagged(self) -> None:
        text = (
            "ÃØæ\x81Øæ ·¤èçÁ° ç·¤ SÍæØè ¥ßSÍæ ×ð´ ç·¤âè ¥æÎàæü â´ÏæçÚU\x98æ ·¤æð a.c. dæðÌ âð "
            "â´ØæðçÁÌ ·¤ÚUÙð ÂÚU ÏæÚUæ ÂýßæçãÌ ãæðÌè ãñÐ\n"
            "Identify the physical principle responsible for this observed capacitor "
            "behavior during steady operation in the described alternating-current "
            "setup."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))

    def test_low_ratio_private_use_characters_stay_flagged(self) -> None:
        text = (
            "\ue000\ue001\ue002 Explain why current flows through an ideal capacitor "
            "when it is connected to an alternating current source but not to a "
            "direct current source after steady operation is established in this "
            "circuit configuration."
        )
        self.assertIn("high_character_corruption_ratio", quality_review_reasons(text))


if __name__ == "__main__":
    unittest.main()
