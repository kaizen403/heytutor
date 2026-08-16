from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import reverify_nta_quarantine as reverify


def _inventory(unique_papers: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "nta-jee-main-source-inventory/v1",
        "observed_at": "2026-08-10T00:00:00Z",
        "report_filename_date": "2026-08-10",
        "historical_endpoint_inventory": {
            "unique_papers": unique_papers,
        },
    }


def _schedule(
    keys: list[tuple[str, int, str, bool]],
    *,
    session_id: str = "2022-s1",
    year: int = 2022,
    source_url: str = "https://www.nta.ac.in/Download/Notice/Notice_20220810.pdf",
) -> dict[str, object]:
    return {
        "schema_version": "nta-jee-main-official-schedule/v1",
        "as_of": "2026-08-10",
        "program": "B.E./B.Tech. Paper 1",
        "sessions": [
            {
                "session_id": session_id,
                "label": session_id,
                "year": year,
                "source_url": source_url,
                "alternate_source_urls": [],
                "keys": [
                    {
                        "exam_date": exam_date,
                        "shift": shift,
                        "evidence_type": evidence_type,
                        "expected_gap": expected_gap,
                    }
                    for exam_date, shift, evidence_type, expected_gap in keys
                ],
            }
        ],
    }


def _paper(
    slug: str,
    *,
    names: list[str],
    dates: list[str],
    shifts: list[str],
    years: list[int],
    candidate_status: str = "candidate",
) -> dict[str, object]:
    paper_file = f"/Download/ExamPaper/{slug}.pdf"
    paper_url = f"https://www.nta.ac.in/Download/ExamPaper/{slug}.pdf"
    raw_rows = [
        {
            "ID": 1001,
            "Year": years[0] if years else None,
            "PaperDate": dates[0] if dates else None,
            "Shift": shifts[0] if shifts else None,
            "PaperName": names[0] if names else None,
            "PaperFile": paper_file,
        }
    ]
    return {
        "paper_file": paper_file,
        "paper_url": paper_url,
        "candidate_status": candidate_status,
        "raw_row_count": 1,
        "row_ids": [1001],
        "reported_years": years,
        "reported_paper_dates": dates,
        "reported_paper_names": names,
        "reported_shifts": shifts,
        "raw_rows": raw_rows,
    }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_quarantine(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4\nfake pdf bytes\n")


class ReverifyNtaQuarantineTests(unittest.TestCase):
    def test_reverify_verifies_legacy_english_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            schedule_path = root / "schedule.json"
            staging_dir = root / "staging"
            all_jsonl = root / "all.jsonl"
            verified_jsonl = root / "verified.jsonl"
            report_path = root / "report.json"
            _write_json(
                inventory_path,
                _inventory(
                    [
                        _paper(
                            "Paper_20230320112124",
                            names=["BTech English"],
                            dates=["24-06-2022"],
                            shifts=["1"],
                            years=[2022],
                        )
                    ]
                ),
            )
            _write_json(
                schedule_path,
                _schedule([("2022-06-24", 1, "final_key_notice", False)]),
            )
            staged_path = reverify.acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/Paper_20230320112124.pdf",
            )
            quarantine_path = staged_path.with_suffix(
                f"{staged_path.suffix}.non-paper1-subject-evidence.quarantine"
            )
            _write_quarantine(quarantine_path)
            preview_text = "\n".join(
                [
                    "NTA",
                    "B.E./B.Tech. (Paper I)",
                    "24-06-2022",
                    "SLOT 1",
                    "English",
                    "Question Paper Name : 12345",
                    "Subject Name : PHYSICS",
                ]
            )

            with (
                patch.object(reverify.acquisition, "_pdf_page_count", return_value=26),
                patch.object(reverify.acquisition, "_pdftotext_preview", return_value=preview_text),
            ):
                exit_code = reverify.main(
                    [
                        "--inventory-report",
                        str(inventory_path),
                        "--schedule",
                        str(schedule_path),
                        "--staging-dir",
                        str(staging_dir),
                        "--paper-file",
                        "/Download/ExamPaper/Paper_20230320112124.pdf",
                        "--all-jsonl",
                        str(all_jsonl),
                        "--verified-jsonl",
                        str(verified_jsonl),
                        "--report",
                        str(report_path),
                    ]
                )

            self.assertEqual(exit_code, 0)
            verified_rows = [
                json.loads(line)
                for line in verified_jsonl.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(len(verified_rows), 1)
            self.assertEqual(verified_rows[0]["status"], "verified")
            self.assertEqual(
                verified_rows[0]["evaluation_path"], "legacy_english_header_fallback"
            )
            self.assertEqual(verified_rows[0]["official_key"], "2022-06-24-shift-1")
            self.assertEqual(
                Path(verified_rows[0]["quarantine_path"]).name, quarantine_path.name
            )
            self.assertEqual(verified_rows[0]["year"], 2022)
            self.assertEqual(verified_rows[0]["session_id"], "2022-s1")
            self.assertTrue(verified_rows[0]["retrieved_at"].endswith("Z"))
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["summary"]["verified"], 1)
            self.assertEqual(report["summary"]["quarantined"], 0)

    def test_reverify_verifies_english_hindi_numeric_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            schedule_path = root / "schedule.json"
            staging_dir = root / "staging"
            all_jsonl = root / "all.jsonl"
            verified_jsonl = root / "verified.jsonl"
            report_path = root / "report.json"
            _write_json(
                inventory_path,
                _inventory(
                    [
                        _paper(
                            "Paper_20230926123934",
                            names=["BTech English Hindi"],
                            dates=["06-04-2023"],
                            shifts=["2"],
                            years=[2023],
                        )
                    ]
                ),
            )
            _write_json(
                schedule_path,
                _schedule(
                    [("2023-04-06", 2, "final_key_notice", False)],
                    session_id="2023-s2",
                    year=2023,
                ),
            )
            staged_path = reverify.acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/Paper_20230926123934.pdf",
            )
            quarantine_path = staged_path.with_suffix(
                f"{staged_path.suffix}.ambiguous-internal-schedule.quarantine"
            )
            _write_quarantine(quarantine_path)
            preview_text = "\n".join(
                [
                    "Question Paper Name : 123456",
                    "Subject Name : B.E./B.Tech.",
                    "Creation Date : 2023-04-06",
                    "Lang EnglishHindi",
                ]
            )

            with (
                patch.object(reverify.acquisition, "_pdf_page_count", return_value=48),
                patch.object(reverify.acquisition, "_pdftotext_preview", return_value=preview_text),
            ):
                reverify.main(
                    [
                        "--inventory-report",
                        str(inventory_path),
                        "--schedule",
                        str(schedule_path),
                        "--staging-dir",
                        str(staging_dir),
                        "--official-key",
                        "2023-04-06-shift-2",
                        "--all-jsonl",
                        str(all_jsonl),
                        "--verified-jsonl",
                        str(verified_jsonl),
                        "--report",
                        str(report_path),
                    ]
                )

            verified_rows = [
                json.loads(line)
                for line in verified_jsonl.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(verified_rows[0]["evaluation_path"], "english_hindi_numeric_fallback")
            self.assertEqual(verified_rows[0]["official_key"], "2023-04-06-shift-2")

    def test_missing_quarantine_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            schedule_path = root / "schedule.json"
            staging_dir = root / "staging"
            all_jsonl = root / "all.jsonl"
            verified_jsonl = root / "verified.jsonl"
            report_path = root / "report.json"
            _write_json(
                inventory_path,
                _inventory(
                    [
                        _paper(
                            "Paper_missing",
                            names=["BTech English"],
                            dates=["24-06-2022"],
                            shifts=["1"],
                            years=[2022],
                        )
                    ]
                ),
            )
            _write_json(
                schedule_path,
                _schedule([("2022-06-24", 1, "final_key_notice", False)]),
            )

            reverify.main(
                [
                    "--inventory-report",
                    str(inventory_path),
                    "--schedule",
                    str(schedule_path),
                    "--staging-dir",
                    str(staging_dir),
                    "--paper-file",
                    "/Download/ExamPaper/Paper_missing.pdf",
                    "--all-jsonl",
                    str(all_jsonl),
                    "--verified-jsonl",
                    str(verified_jsonl),
                    "--report",
                    str(report_path),
                ]
            )

            all_rows = [
                json.loads(line)
                for line in all_jsonl.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(all_rows[0]["status"], "missing_local_quarantine")
            self.assertEqual(verified_jsonl.read_text(encoding="utf-8"), "")

    def test_unresolved_selector_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            schedule_path = root / "schedule.json"
            staging_dir = root / "staging"
            all_jsonl = root / "all.jsonl"
            verified_jsonl = root / "verified.jsonl"
            report_path = root / "report.json"
            _write_json(inventory_path, _inventory([]))
            _write_json(
                schedule_path,
                _schedule([("2022-06-24", 1, "final_key_notice", False)]),
            )

            reverify.main(
                [
                    "--inventory-report",
                    str(inventory_path),
                    "--schedule",
                    str(schedule_path),
                    "--staging-dir",
                    str(staging_dir),
                    "--official-key",
                    "2022-06-24-shift-1",
                    "--all-jsonl",
                    str(all_jsonl),
                    "--verified-jsonl",
                    str(verified_jsonl),
                    "--report",
                    str(report_path),
                ]
            )

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(
                report["unresolved_selectors"],
                [{"selector_type": "official_key", "selector_value": "2022-06-24-shift-1"}],
            )
            self.assertEqual(report["summary"]["selected_candidates"], 0)

    def test_requires_explicit_selectors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inventory_path = root / "inventory.json"
            schedule_path = root / "schedule.json"
            staging_dir = root / "staging"
            all_jsonl = root / "all.jsonl"
            verified_jsonl = root / "verified.jsonl"
            report_path = root / "report.json"
            _write_json(inventory_path, _inventory([]))
            _write_json(
                schedule_path,
                _schedule([("2022-06-24", 1, "final_key_notice", False)]),
            )

            with self.assertRaises(reverify.acquisition.AcquisitionError):
                reverify.main(
                    [
                        "--inventory-report",
                        str(inventory_path),
                        "--schedule",
                        str(schedule_path),
                        "--staging-dir",
                        str(staging_dir),
                        "--all-jsonl",
                        str(all_jsonl),
                        "--verified-jsonl",
                        str(verified_jsonl),
                        "--report",
                        str(report_path),
                    ]
                )


if __name__ == "__main__":
    unittest.main()
