from __future__ import annotations


import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'importers'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import legacy_cbse_sources as legacy


class LegacyCbseSourcesTests(unittest.TestCase):
    def test_normalize_url_requires_https_and_escapes_spaces(self) -> None:
        normalized = legacy._normalize_url(
            "https://www.cbse.gov.in/example folder/Physics (Theory).pdf"
        )
        self.assertEqual(
            normalized,
            "https://www.cbse.gov.in/example%20folder/Physics%20(Theory).pdf",
        )
        with self.assertRaisesRegex(legacy.VerificationError, "expected HTTPS"):
            legacy._normalize_url("http://www.cbse.gov.in/not-allowed.pdf")

    def test_sniff_magic_supports_pdf_zip_and_rar(self) -> None:
        self.assertEqual(legacy.sniff_magic(b"%PDF-1.4\n"), "pdf")
        self.assertEqual(legacy.sniff_magic(b"PK\x03\x04payload"), "zip")
        self.assertEqual(legacy.sniff_magic(b"Rar!\x1a\x07\x00payload"), "rar")
        with self.assertRaisesRegex(legacy.VerificationError, "unrecognized file magic"):
            legacy.sniff_magic(b"plain text")

    def test_list_container_members_reads_zip_entries(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("maths/set1.pdf", b"%PDF-1.4\n")
            archive.writestr("physics/set2.pdf", b"%PDF-1.4\n")
        members = legacy.list_container_members("zip", buffer.getvalue())
        self.assertEqual(members, ["maths/set1.pdf", "physics/set2.pdf"])

    def test_detect_kind_or_none_handles_malformed_pdf_header(self) -> None:
        malformed_pdf = b".~>\r\nendstream\r\nendobj\r\n36 0 obj\r\n<<\r\n/ProcSet [/PDF /Text ]\r\n"
        self.assertIsNone(legacy._detect_kind_or_none(malformed_pdf))
        self.assertTrue(legacy._looks_like_pdf_structure(malformed_pdf))

    def test_inventory_contains_requested_gap_and_event_years(self) -> None:
        gap_years = {gap.year for gap in legacy._build_gap_specs()}
        event_years = {event.year for event in legacy._build_event_specs()}
        self.assertTrue({2008, 2014, 2016, 2019}.issubset(gap_years))
        self.assertNotIn(2007, gap_years)
        self.assertEqual(event_years, {2021})

    def test_atomic_json_writes_expected_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "report.json"
            legacy._atomic_json(target, {"status": "ok"})
            self.assertEqual(target.read_text(encoding="utf-8"), '{\n  "status": "ok"\n}\n')


if __name__ == "__main__":
    unittest.main()
