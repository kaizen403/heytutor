from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from nta_jee_main_sources import (
    HISTORICAL_POST_URL,
    PROGRAM_LABEL,
    PdfProbe,
    build_inventory,
    _build_gap_report,
    _build_historical_inventory,
    _build_official_download_url,
    _dedupe_records,
    _fetch_historical_payload,
    _historical_request_spec,
    _normalize_direct_row,
    _normalize_historical_row,
    _observed_date,
    _parse_historical_payload,
)
from nta_jee_main_sources import DirectRow, NoticeRow


class NtaJeeMainSourceTests(unittest.TestCase):
    def test_observed_date_is_derived_from_observed_at(self) -> None:
        self.assertEqual(
            _observed_date("2026-08-10T18:23:45Z"),
            "2026-08-10",
        )

    def test_historical_request_spec_matches_verified_official_contract(self) -> None:
        spec = _historical_request_spec()

        self.assertEqual(spec["url"], HISTORICAL_POST_URL)
        self.assertEqual(spec["method"], "POST")
        self.assertEqual(
            spec["data"],
            {"Year": "0", "ExamType": "1", "PaperType": "0"},
        )
        self.assertEqual(
            spec["headers"],
            {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://www.nta.ac.in/Downloads",
                "X-Requested-With": "XMLHttpRequest",
            },
        )

    def test_parse_historical_payload_requires_object_with_list(self) -> None:
        self.assertEqual(_parse_historical_payload({"List": [{"ID": 1}]}), [{"ID": 1}])

        with self.assertRaisesRegex(Exception, "object with a List array"):
            _parse_historical_payload([])

        with self.assertRaisesRegex(Exception, "object with a List array"):
            _parse_historical_payload({"List": {}})

    def test_fetch_historical_payload_rejects_non_json_and_non_200(self) -> None:
        with patch(
            "nta_jee_main_sources._fetch",
            return_value=(200, {"content-type": "text/html"}, b"not-json"),
        ):
            with self.assertRaisesRegex(Exception, "invalid JSON"):
                _fetch_historical_payload()

        with patch(
            "nta_jee_main_sources._fetch",
            return_value=(500, {"content-type": "application/json"}, b"{}"),
        ):
            with self.assertRaisesRegex(Exception, "HTTP 500"):
                _fetch_historical_payload()

    def test_build_official_download_url_requires_https_official_host(self) -> None:
        self.assertEqual(
            _build_official_download_url("/Download/ExamPaper/Paper_20250530112202.pdf"),
            "https://www.nta.ac.in/Download/ExamPaper/Paper_20250530112202.pdf",
        )

        with self.assertRaisesRegex(Exception, "non-official host"):
            _build_official_download_url("https://example.com/paper.pdf")

    def test_normalize_historical_row_classifies_candidates_exclusions_and_generic_paper_i(
        self,
    ) -> None:
        candidate = _normalize_historical_row(
            {
                "ID": 11,
                "Year": 2025,
                "PaperDate": "22-01-2025",
                "Shift": "1",
                "PaperName": "B Tech 22nd Jan 2025 Shift 1 English",
                "PaperFile": "/Download/ExamPaper/Paper_20250530112202.pdf",
            }
        )
        excluded = _normalize_historical_row(
            {
                "ID": 12,
                "Year": 2025,
                "PaperDate": "30-01-2025",
                "Shift": "2",
                "PaperName": "B Arch B Planning 30th Jan 2025 Shift 2 English & Hindi",
                "PaperFile": "/Download/ExamPaper/Paper_20250530112203.pdf",
            }
        )
        generic = _normalize_historical_row(
            {
                "ID": 13,
                "Year": 2024,
                "PaperDate": "01-02-2024",
                "Shift": "1",
                "PaperName": "Paper 1 1st Feb 2024 Shift 1",
                "PaperFile": "/Download/ExamPaper/Paper_20240530112203.pdf",
                "NewPaperType": "Paper I",
            }
        )

        self.assertEqual(candidate["candidate_status"], "candidate")
        self.assertEqual(candidate["paper_url"], "https://www.nta.ac.in/Download/ExamPaper/Paper_20250530112202.pdf")
        self.assertEqual(candidate["reported_year"], 2025)
        self.assertEqual(candidate["reported_paper_name"], "B Tech 22nd Jan 2025 Shift 1 English")
        self.assertEqual(candidate["raw_row"]["ID"], 11)

        self.assertEqual(excluded["candidate_status"], "excluded")
        self.assertIn("B Arch", excluded["reported_paper_name"])

        self.assertEqual(generic["candidate_status"], "candidate_generic_paper_1")
        self.assertEqual(generic["raw_row"]["NewPaperType"], "Paper I")

    def test_build_historical_inventory_reports_duplicates_conflicts_and_gaps(self) -> None:
        rows = [
            {
                "ID": 101,
                "Year": 2025,
                "PaperDate": "22-01-2025",
                "Shift": "1",
                "PaperName": "B Tech 22nd Jan 2025 Shift 1 English",
                "PaperFile": "/Download/ExamPaper/Paper_A.pdf",
            },
            {
                "ID": 102,
                "Year": 2025,
                "PaperDate": "22-01-2025",
                "Shift": "1",
                "PaperName": "B Tech 22nd Jan 2025 Shift 1 English",
                "PaperFile": "/Download/ExamPaper/Paper_A.pdf",
            },
            {
                "ID": 103,
                "Year": 2021,
                "PaperDate": "25-02-2021",
                "Shift": "2",
                "PaperName": "BTech Malayalam",
                "PaperFile": "/Download/ExamPaper/Paper_conflict.pdf",
            },
            {
                "ID": 104,
                "Year": 2021,
                "PaperDate": "26-02-2021",
                "Shift": "2",
                "PaperName": "BTech Odiya",
                "PaperFile": "/Download/ExamPaper/Paper_conflict.pdf",
            },
            {
                "ID": 105,
                "Year": 2024,
                "PaperDate": "01-02-2024",
                "Shift": "1",
                "PaperName": "Paper 1 1st Feb 2024 Shift 1",
                "PaperFile": "/Download/ExamPaper/Paper_generic.pdf",
            },
            {
                "ID": 106,
                "Year": 2025,
                "PaperDate": "30-01-2025",
                "Shift": "2",
                "PaperName": "B Arch B Planning 30th Jan 2025 Shift 2 English & Hindi",
                "PaperFile": "/Download/ExamPaper/Paper_arch.pdf",
            },
            {
                "ID": 107,
                "Year": 2023,
                "PaperDate": "15-01-2023",
                "Shift": "1",
                "PaperName": "Unclear paper metadata",
                "PaperFile": "/Download/ExamPaper/Paper_ambiguous.pdf",
            },
            {
                "ID": 108,
                "Year": 2022,
                "PaperDate": "10-07-2022",
                "Shift": "1",
                "PaperName": "Missing file row",
                "PaperFile": "",
            },
        ]

        inventory = _build_historical_inventory(rows)

        self.assertEqual(inventory["response_shape"], {"top_level_type": "object", "list_key": "List"})
        self.assertEqual(inventory["raw_row_count"], 8)
        self.assertEqual(inventory["nonempty_paperfile_row_count"], 7)
        self.assertEqual(inventory["unique_nonempty_paperfile_count"], 5)
        self.assertEqual(inventory["empty_paperfile_row_count"], 1)
        self.assertEqual(inventory["counts_by_reported_year_raw"]["2025"], 3)
        self.assertEqual(inventory["program_candidate_counts_raw"]["candidate"], 4)
        self.assertEqual(inventory["program_candidate_counts_raw"]["candidate_generic_paper_1"], 1)
        self.assertEqual(inventory["program_candidate_counts_raw"]["excluded"], 1)
        self.assertEqual(inventory["program_candidate_counts_raw"]["ambiguous"], 1)
        self.assertEqual(inventory["program_candidate_counts_unique"]["candidate"], 2)
        self.assertEqual(inventory["program_candidate_counts_unique"]["candidate_generic_paper_1"], 1)
        self.assertEqual(inventory["program_candidate_counts_unique"]["excluded"], 1)
        self.assertEqual(inventory["program_candidate_counts_unique"]["ambiguous"], 1)
        self.assertEqual(
            inventory["endpoint_coverage_gaps"],
            [
                {
                    "year": 2019,
                    "status": "missing_from_historical_endpoint",
                    "notes": "the verified historical endpoint did not return this year",
                },
                {
                    "year": 2020,
                    "status": "missing_from_historical_endpoint",
                    "notes": "the verified historical endpoint did not return this year",
                },
                {
                    "year": 2026,
                    "status": "missing_from_historical_endpoint",
                    "notes": "the verified historical endpoint did not return this year; live 2026 direct-paper inventory is reported separately",
                },
            ],
        )
        self.assertEqual(len(inventory["suspect_metadata"]), 1)
        self.assertEqual(
            inventory["suspect_metadata"][0]["paper_file"],
            "/Download/ExamPaper/Paper_conflict.pdf",
        )
        self.assertEqual(
            inventory["suspect_metadata"][0]["conflict_fields"]["reported_paper_date"],
            ["25-02-2021", "26-02-2021"],
        )

    def test_build_inventory_marks_notice_rows_as_volatile_live_snapshot(self) -> None:
        with (
            patch("nta_jee_main_sources._utc_now", return_value="2026-08-10T18:23:45Z"),
            patch(
                "nta_jee_main_sources._fetch",
                side_effect=[
                    (200, {"content-type": "text/html"}, b"<html></html>"),
                    (200, {"content-type": "text/html"}, b"<html></html>"),
                    (200, {"content-type": "text/html"}, b"<html></html>"),
                ],
            ),
            patch(
                "nta_jee_main_sources._fetch_historical_payload_response",
                return_value=(
                    [
                        {
                            "ID": 11,
                            "Year": 2025,
                            "PaperDate": "22-01-2025",
                            "Shift": "1",
                            "PaperName": "B Tech 22nd Jan 2025 Shift 1 English",
                            "PaperFile": "/Download/ExamPaper/Paper_20250530112202.pdf",
                        }
                    ],
                    {
                        "url": HISTORICAL_POST_URL,
                        "method": "POST",
                        "request_headers": _historical_request_spec()["headers"],
                        "request_data": _historical_request_spec()["data"],
                        "status": 200,
                        "content_type": "application/json; charset=utf-8",
                    },
                ),
            ),
            patch("nta_jee_main_sources._collect_direct_rows", return_value=[]),
            patch(
                "nta_jee_main_sources._collect_notice_rows",
                side_effect=[
                    [
                        NoticeRow(
                            source_url="https://www.nta.ac.in/NoticeBoardArchive",
                            title="JEE (Main) 2025 Session 1 Question Paper",
                            href="https://www.nta.ac.in/Download/Notice/a.pdf",
                        )
                    ],
                    [],
                ],
            ),
        ):
            report = build_inventory(staging_dir=None)

        self.assertEqual(report["observed_at"], "2026-08-10T18:23:45Z")
        self.assertEqual(report["observed_date"], "2026-08-10")
        self.assertEqual(report["summary"]["notice_row_count"], 1)
        self.assertEqual(report["official_notice_snapshot"]["captured_at"], "2026-08-10T18:23:45Z")
        self.assertEqual(report["official_notice_snapshot"]["captured_date"], "2026-08-10")
        self.assertTrue(report["official_notice_snapshot"]["volatile_live_snapshot"])
        self.assertIn(
            "Do not treat notice_row_count as stable historical evidence.",
            report["official_notice_snapshot"]["notes"],
        )
        self.assertIn(
            "cdnbbsr.s3waas.gov.in",
            report["notes"][2],
        )

    def test_normalize_direct_row_parses_date_shift_and_program(self) -> None:
        normalized = _normalize_direct_row(
            DirectRow(
                source_url="https://jeemain.nta.nic.in/",
                label="  B Tech   2nd  Apr  2026   Shift 1 ",
                href="https://jeemain.nta.nic.in/example.pdf",
            )
        )

        self.assertEqual(normalized["year"], 2026)
        self.assertEqual(normalized["exam_date"], "2026-04-02")
        self.assertEqual(normalized["session"], 2)
        self.assertEqual(
            normalized["session_evidence"],
            "derived from the verified 2026 exam month",
        )
        self.assertEqual(normalized["shift"], 1)
        self.assertEqual(normalized["program"], PROGRAM_LABEL)

    def test_dedupe_records_groups_duplicate_rows(self) -> None:
        records = [
            {"href": "https://example.invalid/a.pdf", "label": "A"},
            {"href": "https://example.invalid/a.pdf", "label": "A"},
            {"href": "https://example.invalid/b.pdf", "label": "B"},
        ]

        unique, duplicates = _dedupe_records(records, key_fields=("href", "label"))

        self.assertEqual(len(unique), 2)
        self.assertEqual(len(duplicates), 1)
        self.assertEqual(duplicates[0]["key"]["href"], "https://example.invalid/a.pdf")

    def test_gap_report_marks_missing_years_and_session_one_gap(self) -> None:
        notice_rows = [
            {
                "year": 2026,
                "sessions": [1, 2],
            },
            {
                "year": 2025,
                "sessions": [1, 2],
            },
        ]

        session_two_only_gaps = _build_gap_report(
            [
                {
                    "year": 2026,
                    "exam_date": "2026-04-02",
                    "session": 2,
                    "shift": 1,
                    "pdf_probe": {"internal_language": None},
                }
            ],
            notice_rows,
            observed_date="2026-08-10",
        )
        both_sessions_gaps = _build_gap_report(
            [
                {
                    "year": 2026,
                    "exam_date": "2026-01-22",
                    "session": 1,
                    "shift": 1,
                    "pdf_probe": {"internal_language": None},
                },
                {
                    "year": 2026,
                    "exam_date": "2026-04-02",
                    "session": 2,
                    "shift": 1,
                    "pdf_probe": {"internal_language": None},
                },
            ],
            notice_rows,
            observed_date="2026-08-10",
        )

        gap_2025 = next(gap for gap in session_two_only_gaps if gap["year"] == 2025)
        session_gap_2026 = next(
            gap
            for gap in session_two_only_gaps
            if gap["year"] == 2026 and gap["status"] == "session_gap"
        )

        self.assertEqual(
            gap_2025["status"], "no_direct_official_question_paper_pdf_linked"
        )
        self.assertEqual(gap_2025["official_notice_sessions_seen"], [1, 2])
        self.assertEqual(session_gap_2026["missing_session"], 1)
        self.assertIn("2026-08-10", session_gap_2026["notes"])
        self.assertFalse(
            any(
                gap["year"] == 2026 and gap["status"] == "session_gap"
                for gap in both_sessions_gaps
            )
        )


if __name__ == "__main__":
    unittest.main()
