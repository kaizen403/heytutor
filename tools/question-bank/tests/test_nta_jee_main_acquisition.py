from __future__ import annotations


import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'importers'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nta_jee_main_acquisition as acquisition


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
    session_id: str = "2024-s2",
    year: int = 2024,
    source_url: str = "https://www.nta.ac.in/Download/Notice/Notice_20240422121837.pdf",
    evidence_type: str = "final_key_notice",
) -> dict[str, object]:
    return {
        "schema_version": acquisition.SCHEDULE_SCHEMA_VERSION,
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
                        "evidence_type": item_evidence,
                        "expected_gap": expected_gap,
                    }
                    for exam_date, shift, item_evidence, expected_gap in keys
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
    raw_row_count: int | None = None,
    paper_url: str | None = None,
    paper_file: str | None = None,
) -> dict[str, object]:
    if raw_row_count is None:
        raw_row_count = max(1, len(names))
    effective_paper_file = paper_file or f"/Download/ExamPaper/{slug}.pdf"
    effective_paper_url = paper_url or f"https://www.nta.ac.in/Download/ExamPaper/{slug}.pdf"
    raw_rows = []
    for index in range(raw_row_count):
        raw_rows.append(
            {
                "ID": 1000 + index,
                "Year": years[0] if years else None,
                "PaperDate": dates[0] if dates else None,
                "Shift": shifts[0] if shifts else None,
                "PaperName": names[0] if names else None,
                "PaperFile": effective_paper_file,
            }
        )
    return {
        "paper_file": effective_paper_file,
        "paper_url": effective_paper_url,
        "candidate_status": candidate_status,
        "raw_row_count": raw_row_count,
        "row_ids": [row["ID"] for row in raw_rows],
        "reported_years": years,
        "reported_paper_dates": dates,
        "reported_paper_names": names,
        "reported_shifts": shifts,
        "raw_rows": raw_rows,
    }


def _pdf_preview(
    *,
    question_paper_name: str,
    subject_name: str,
    creation_date: str = "2024-04-09",
    language: str | None = None,
) -> str:
    pieces = [
        f"Question Paper Name : {question_paper_name}",
        f"Subject Name : {subject_name}",
        f"Creation Date : {creation_date}",
    ]
    if language is not None:
        pieces.append(f"Lang {language}")
    return "\n".join(pieces)


class _FakeResponse:
    def __init__(
        self,
        chunks: list[bytes],
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._chunks = list(chunks)
        self.status = status
        self.headers = headers or {}

    def read(self, _size: int = -1) -> bytes:
        if not self._chunks:
            return b""
        chunk = self._chunks.pop(0)
        if isinstance(chunk, BaseException):
            raise chunk
        if _size >= 0 and len(chunk) > _size:
            self._chunks.insert(0, chunk[_size:])
            return chunk[:_size]
        return chunk

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class NtaJeeMainAcquisitionTests(unittest.TestCase):
    def test_build_download_plan_is_deterministic_and_retains_duplicates(self) -> None:
        schedule = _schedule(
            [
                ("2024-04-09", 2, "final_key_notice", False),
                ("2021-08-04", 1, "final_key_notice", False),
            ]
        )
        inventory = _inventory(
            [
                _paper(
                    "english",
                    names=["BTech English"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                    raw_row_count=2,
                ),
                _paper(
                    "regional",
                    names=["BTech Gujarati"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                ),
                _paper(
                    "generic-a",
                    names=["PAPER - I"],
                    dates=["04-08-2021"],
                    shifts=["1"],
                    years=[2021],
                    candidate_status="candidate_generic_paper_1",
                ),
                _paper(
                    "generic-b",
                    names=["PAPER - I"],
                    dates=["04-08-2021"],
                    shifts=["1"],
                    years=[2021],
                    candidate_status="candidate_generic_paper_1",
                ),
            ]
        )

        plan = acquisition._build_download_plan(inventory, schedule)

        self.assertEqual(
            [item["paper_file"] for item in plan["planned_candidates"]],
            [
                "/Download/ExamPaper/generic-a.pdf",
                "/Download/ExamPaper/generic-b.pdf",
                "/Download/ExamPaper/english.pdf",
            ],
        )
        suppressed = {
            item["paper_file"]: item["suppression_reasons"]
            for item in plan["suppressed_candidates"]
        }
        self.assertIn(
            "lower_priority_same_reported_schedule_key",
            suppressed["/Download/ExamPaper/regional.pdf"],
        )
        english = next(
            item
            for item in plan["planned_candidates"]
            if item["paper_file"] == "/Download/ExamPaper/english.pdf"
        )
        self.assertEqual(english["raw_row_count"], 2)
        self.assertEqual(len(english["raw_rows"]), 2)

    def test_compact_barch_and_bplanning_spellings_are_excluded(self) -> None:
        schedule = _schedule([("2024-04-09", 2, "final_key_notice", False)])
        inventory = _inventory(
            [
                _paper(
                    "arch",
                    names=["BArchPaper2 English"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                    candidate_status="ambiguous",
                ),
                _paper(
                    "planning",
                    names=["BPlanningPaperII Hindi"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                    candidate_status="ambiguous",
                ),
            ]
        )

        plan = acquisition._build_download_plan(inventory, schedule)

        self.assertEqual(plan["planned_candidates"], [])
        self.assertEqual(len(plan["suppressed_candidates"]), 2)
        for item in plan["suppressed_candidates"]:
            self.assertIn("excluded_non_paper1_program", item["suppression_reasons"])

    def test_schedule_resolvable_ambiguous_row_is_probed(self) -> None:
        schedule = _schedule([("2024-04-09", 2, "final_key_notice", False)])
        inventory = _inventory(
            [
                _paper(
                    "ambiguous",
                    names=["JEE Main 2018 (8th April)"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                    candidate_status="ambiguous",
                )
            ]
        )

        plan = acquisition._build_download_plan(inventory, schedule)

        self.assertEqual(len(plan["planned_candidates"]), 1)
        self.assertEqual(
            plan["planned_candidates"][0]["plan_reason"],
            "reported_schedule_resolvable_ambiguous",
        )

    def test_unmatched_generic_paper1_outlier_is_probed(self) -> None:
        schedule = _schedule([("2025-04-08", 2, "final_key_notice", False)])
        inventory = _inventory(
            [
                _paper(
                    "outlier",
                    names=["PAPER - I"],
                    dates=[],
                    shifts=[],
                    years=[2025],
                    candidate_status="candidate_generic_paper_1",
                )
            ]
        )

        plan = acquisition._build_download_plan(inventory, schedule)

        self.assertEqual(len(plan["planned_candidates"]), 1)
        self.assertEqual(plan["planned_candidates"][0]["plan_reason"], "metadata_outlier")

    def test_regional_fallback_is_kept_for_audit_when_no_preferred_variant_exists(self) -> None:
        schedule = _schedule([("2024-04-09", 2, "final_key_notice", False)])
        inventory = _inventory(
            [
                _paper(
                    "regional",
                    names=["BTech Gujarati"],
                    dates=["09-04-2024"],
                    shifts=["2"],
                    years=[2024],
                )
            ]
        )

        plan = acquisition._build_download_plan(inventory, schedule)

        self.assertEqual(len(plan["planned_candidates"]), 1)
        self.assertEqual(plan["planned_candidates"][0]["plan_reason"], "regional_fallback")

    def test_select_canonical_variants_prefers_english_and_marks_regional_fallbacks(self) -> None:
        canonical = acquisition._select_canonical_candidates(
            [
                {
                    "official_key": "2024-04-09-shift-2",
                    "paper_url": "https://www.nta.ac.in/Download/ExamPaper/english.pdf",
                    "sha256": "a" * 64,
                    "language_variant": "english",
                    "variant_rank": 1,
                },
                {
                    "official_key": "2024-04-09-shift-2",
                    "paper_url": "https://www.nta.ac.in/Download/ExamPaper/english-hindi.pdf",
                    "sha256": "b" * 64,
                    "language_variant": "english_hindi",
                    "variant_rank": 2,
                },
                {
                    "official_key": "2024-04-09-shift-2",
                    "paper_url": "https://www.nta.ac.in/Download/ExamPaper/gujarati.pdf",
                    "sha256": "c" * 64,
                    "language_variant": "regional",
                    "variant_rank": 4,
                },
                {
                    "official_key": "2024-04-10-shift-1",
                    "paper_url": "https://www.nta.ac.in/Download/ExamPaper/tamil.pdf",
                    "sha256": "d" * 64,
                    "language_variant": "regional",
                    "variant_rank": 4,
                },
            ]
        )

        self.assertEqual(
            canonical["2024-04-09-shift-2"]["canonical"]["paper_url"],
            "https://www.nta.ac.in/Download/ExamPaper/english.pdf",
        )
        self.assertEqual(
            canonical["2024-04-09-shift-2"]["alternates"][0]["alternate_reason"],
            "lower_language_rank",
        )
        self.assertFalse(canonical["2024-04-09-shift-2"]["regional_fallback"])
        self.assertTrue(canonical["2024-04-10-shift-1"]["regional_fallback"])

    def test_real_run_corrects_endpoint_metadata_from_internal_header(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "wrong-meta",
                                names=["PAPER - I"],
                                dates=["08-04-2024"],
                                shifts=["1"],
                                years=[2024],
                                candidate_status="candidate_generic_paper_1",
                            )
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule(
                        [
                            ("2024-04-08", 1, "final_key_notice", False),
                            ("2024-04-09", 2, "final_key_notice", False),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    return_value=_FakeResponse([b"%PDF-1.4\ncorrected\n"]),
                ),
                patch("nta_jee_main_acquisition._utc_now", return_value="2026-08-10T12:00:00Z"),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=12),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    ),
                ),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            verified = report["verified_candidates"][0]
            self.assertEqual(verified["official_key"], "2024-04-09-shift-2")
            self.assertEqual(verified["retrieved_at"], "2026-08-10T12:00:00Z")
            self.assertIn("metadata_corrected", verified["warnings"])
            self.assertEqual(
                report["canonical_candidates"][0]["canonical"]["official_key"],
                "2024-04-09-shift-2",
            )
            self.assertEqual(
                report["canonical_candidates"][0]["canonical"]["retrieved_at"],
                "2026-08-10T12:00:00Z",
            )
            self.assertEqual(report["missing_schedule_keys"][0]["official_key"], "2024-04-08-shift-1")
            staged_path = Path(verified["staged_path"])
            sidecar = json.loads(acquisition._sidecar_path(staged_path).read_text(encoding="utf-8"))
            self.assertEqual(sidecar["retrieved_at"], "2026-08-10T12:00:00Z")

    def test_internal_schedule_miss_and_missing_shift_quarantine(self) -> None:
        schedule = _schedule([("2024-04-09", 2, "final_key_notice", False)])
        verified = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/example.pdf",
                "paper_file": "/Download/ExamPaper/example.pdf",
                "reported_schedule_keys": ["2024-04-09-shift-2"],
                "language_variant": "generic",
                "variant_rank": 3,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/example.pdf"),
            sha256="a" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text=_pdf_preview(
                question_paper_name="B.E./B.Tech. 9 Apr 2024",
                subject_name="B.E./B.Tech Paper 1",
            ),
        )
        missing = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/missing.pdf",
                "paper_file": "/Download/ExamPaper/missing.pdf",
                "reported_schedule_keys": [],
                "language_variant": "generic",
                "variant_rank": 3,
                "plan_reason": "metadata_outlier",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/missing.pdf"),
            sha256="b" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text=_pdf_preview(
                question_paper_name="B.E./B.Tech. 10 Apr 2024 Shift 1",
                subject_name="B.E./B.Tech Paper 1",
            ),
        )

        self.assertEqual(verified["status"], "quarantined")
        self.assertEqual(verified["quarantine_reason"], "ambiguous_internal_schedule")
        self.assertEqual(missing["status"], "quarantined")
        self.assertEqual(missing["quarantine_reason"], "internal_schedule_key_not_found")

    def test_official_english_hindi_numeric_header_uses_single_reported_schedule_key(self) -> None:
        schedule = _schedule([("2023-04-10", 1, "final_key_notice", False)], year=2023)

        verified = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/eh-2023.pdf",
                "paper_file": "/Download/ExamPaper/eh-2023.pdf",
                "reported_schedule_keys": ["2023-04-10-shift-1"],
                "language_variant": "english_hindi",
                "variant_rank": 2,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/eh-2023.pdf"),
            sha256="e" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text=_pdf_preview(
                question_paper_name="401571",
                subject_name="B.E./B.Tech Paper 1",
                creation_date="2023-04-10",
                language="EnglishHindi",
            ),
        )

        self.assertEqual(verified["status"], "verified")
        self.assertEqual(verified["official_key"], "2023-04-10-shift-1")
        self.assertEqual(verified["question_paper_name"], "401571")
        self.assertEqual(verified["language_variant"], "english_hindi")
        self.assertEqual(verified["internal_exam_date"], "2023-04-10")
        self.assertEqual(verified["internal_shift"], 1)

    def test_numeric_header_fallback_keeps_ambiguous_and_non_btech_rejections(self) -> None:
        schedule = _schedule(
            [
                ("2023-04-10", 1, "final_key_notice", False),
                ("2023-04-10", 2, "final_key_notice", False),
            ],
            year=2023,
        )

        ambiguous = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/eh-ambiguous.pdf",
                "paper_file": "/Download/ExamPaper/eh-ambiguous.pdf",
                "reported_schedule_keys": ["2023-04-10-shift-1", "2023-04-10-shift-2"],
                "language_variant": "english_hindi",
                "variant_rank": 2,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/eh-ambiguous.pdf"),
            sha256="f" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text=_pdf_preview(
                question_paper_name="401572",
                subject_name="B.E./B.Tech Paper 1",
                creation_date="2023-04-10",
                language="EnglishHindi",
            ),
        )
        non_btech = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/eh-non-btech.pdf",
                "paper_file": "/Download/ExamPaper/eh-non-btech.pdf",
                "reported_schedule_keys": ["2023-04-10-shift-1"],
                "language_variant": "english_hindi",
                "variant_rank": 2,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/eh-non-btech.pdf"),
            sha256="1" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text=_pdf_preview(
                question_paper_name="401573",
                subject_name="Paper 1",
                creation_date="2023-04-10",
                language="EnglishHindi",
            ),
        )

        self.assertEqual(ambiguous["status"], "quarantined")
        self.assertEqual(ambiguous["quarantine_reason"], "ambiguous_internal_schedule")
        self.assertEqual(non_btech["status"], "quarantined")
        self.assertEqual(non_btech["quarantine_reason"], "ambiguous_internal_schedule")

    def test_official_legacy_header_layout_uses_matching_single_reported_schedule_key(self) -> None:
        schedule = _schedule([("2022-06-24", 1, "final_key_notice", False)], year=2022)

        verified = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/Paper_20230320112124.pdf",
                "paper_file": "/Download/ExamPaper/Paper_20230320112124.pdf",
                "reported_schedule_keys": ["2022-06-24-shift-1"],
                "language_variant": "english",
                "variant_rank": 1,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/Paper_20230320112124.pdf"),
            sha256="2" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text="\n".join(
                [
                    "NTA Mock Header",
                    "B.E/B.Tech.(Paper I)",
                    "24-06-2022",
                    "SLOT - 1",
                    "English",
                ]
            ),
        )

        self.assertEqual(verified["status"], "verified")
        self.assertEqual(verified["official_key"], "2022-06-24-shift-1")
        self.assertEqual(verified["language_variant"], "english")
        self.assertEqual(verified["language"], "English")
        self.assertEqual(verified["internal_exam_date"], "2022-06-24")
        self.assertEqual(verified["internal_shift"], 1)

    def test_legacy_header_fallback_requires_official_candidate(self) -> None:
        schedule = _schedule([("2022-06-24", 1, "final_key_notice", False)], year=2022)

        rejected = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://example.com/Paper_20230320112124.pdf",
                "paper_file": "/tmp/Paper_20230320112124.pdf",
                "reported_schedule_keys": ["2022-06-24-shift-1"],
                "language_variant": "english",
                "variant_rank": 1,
                "plan_reason": "reported_schedule_match",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/nonofficial-legacy.pdf"),
            sha256="3" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=True,
            preview_text="\n".join(
                [
                    "NTA Mock Header",
                    "B.E/B.Tech.(Paper I)",
                    "24-06-2022",
                    "SLOT - 1",
                    "English",
                ]
            ),
        )

        self.assertEqual(rejected["status"], "quarantined")
        self.assertEqual(rejected["quarantine_reason"], "non_paper1_subject_evidence")

    def test_bad_magic_and_zero_page_count_quarantine(self) -> None:
        schedule = _schedule([("2024-04-09", 2, "final_key_notice", False)])
        bad_magic = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/magic.pdf",
                "paper_file": "/Download/ExamPaper/magic.pdf",
                "reported_schedule_keys": [],
                "language_variant": "generic",
                "variant_rank": 3,
                "plan_reason": "metadata_outlier",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/magic.pdf"),
            sha256="c" * 64,
            size_bytes=10,
            page_count=12,
            pdf_magic=False,
            preview_text="",
        )
        zero_pages = acquisition._evaluate_pdf_metadata(
            candidate={
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/pages.pdf",
                "paper_file": "/Download/ExamPaper/pages.pdf",
                "reported_schedule_keys": [],
                "language_variant": "generic",
                "variant_rank": 3,
                "plan_reason": "metadata_outlier",
            },
            schedule_index=acquisition._schedule_index(schedule),
            staged_path=Path("/tmp/pages.pdf"),
            sha256="d" * 64,
            size_bytes=10,
            page_count=0,
            pdf_magic=True,
            preview_text="",
        )

        self.assertEqual(bad_magic["quarantine_reason"], "invalid_pdf_magic")
        self.assertEqual(zero_pages["quarantine_reason"], "invalid_pdf_page_count")

    def test_download_enforces_per_file_and_total_caps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse([b"%PDF-1.4\ncap\n"]),
            ):
                with self.assertRaisesRegex(acquisition.AcquisitionError, "per-file byte cap"):
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/cap.pdf",
                        destination=staging_dir / "cap.pdf",
                        max_file_bytes=4,
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse([b"%PDF-1.4\ncap\n"]),
            ):
                with self.assertRaisesRegex(acquisition.AcquisitionError, "total byte cap"):
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/cap.pdf",
                        destination=staging_dir / "cap.pdf",
                        max_file_bytes=100,
                        max_total_bytes=4,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

    def test_download_accepts_body_exactly_equal_to_file_cap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            payload = b"%PDF-1.4\n"
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [payload],
                    headers={"Content-Length": str(len(payload))},
                ),
            ):
                staged, downloaded = acquisition._download_to_stage(
                    url="https://www.nta.ac.in/Download/ExamPaper/exact-file.pdf",
                    destination=staging_dir / "exact-file.pdf",
                    max_file_bytes=len(payload),
                    max_total_bytes=100,
                    total_bytes_used=0,
                    timeout_seconds=1.0,
                )

            self.assertEqual(downloaded, len(payload))
            self.assertEqual(staged.read_bytes(), payload)

    def test_download_accepts_body_exactly_equal_to_total_remaining_cap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            payload = b"%PDF-1.4\n"
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [payload],
                    headers={"Content-Length": str(len(payload))},
                ),
            ):
                staged, downloaded = acquisition._download_to_stage(
                    url="https://www.nta.ac.in/Download/ExamPaper/exact-total.pdf",
                    destination=staging_dir / "exact-total.pdf",
                    max_file_bytes=100,
                    max_total_bytes=10 + len(payload),
                    total_bytes_used=10,
                    timeout_seconds=1.0,
                )

            self.assertEqual(downloaded, len(payload))
            self.assertEqual(staged.read_bytes(), payload)

    def test_download_fails_one_byte_over_file_cap_and_charges_byte(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            payload = b"%PDF-1.4\n"
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [payload, b"x"],
                    headers={"Content-Length": str(len(payload) + 1)},
                ),
            ):
                with self.assertRaises(acquisition.DownloadTransferError) as ctx:
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/over-file.pdf",
                        destination=staging_dir / "over-file.pdf",
                        max_file_bytes=len(payload),
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

            self.assertEqual(ctx.exception.downloaded_bytes, len(payload) + 1)
            self.assertFalse((staging_dir / "over-file.pdf").exists())
            self.assertEqual((staging_dir / "over-file.pdf.part").read_bytes(), payload)

    def test_download_fails_one_byte_over_total_cap_and_charges_byte(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            payload = b"%PDF-1.4\n"
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [payload, b"x"],
                    headers={"Content-Length": str(len(payload) + 1)},
                ),
            ):
                with self.assertRaises(acquisition.DownloadTransferError) as ctx:
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/over-total.pdf",
                        destination=staging_dir / "over-total.pdf",
                        max_file_bytes=100,
                        max_total_bytes=5 + len(payload),
                        total_bytes_used=5,
                        timeout_seconds=1.0,
                    )

            self.assertEqual(ctx.exception.downloaded_bytes, len(payload) + 1)
            self.assertTrue(ctx.exception.total_exhausted)
            self.assertEqual((staging_dir / "over-total.pdf.part").read_bytes(), payload)

    def test_download_supports_range_resume_and_safe_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            destination = staging_dir / "resume.pdf"
            part_path = destination.with_suffix(".pdf.part")
            part_path.write_bytes(b"%PDF")
            requests: list[str | None] = []

            def resume_opener(request, _timeout):
                requests.append(request.headers.get("Range"))
                return _FakeResponse(
                    [b"-1.4\nrest\n"],
                    status=206,
                    headers={"Content-Range": "bytes 4-13/14"},
                )

            with patch("nta_jee_main_acquisition._open_request", side_effect=resume_opener):
                staged, downloaded = acquisition._download_to_stage(
                    url="https://www.nta.ac.in/Download/ExamPaper/resume.pdf",
                    destination=destination,
                    max_file_bytes=100,
                    max_total_bytes=100,
                    total_bytes_used=0,
                    timeout_seconds=1.0,
                )

            self.assertEqual(requests, ["bytes=4-"])
            self.assertEqual(staged, part_path)
            self.assertEqual(staged.read_bytes(), b"%PDF-1.4\nrest\n")
            self.assertEqual(downloaded, len(b"-1.4\nrest\n"))
            self.assertFalse(destination.exists())

            part_path.unlink()
            part_path.write_bytes(b"stale")
            requests.clear()

            def restart_opener(request, _timeout):
                requests.append(request.headers.get("Range"))
                return _FakeResponse([b"%PDF-1.4\nfresh\n"], status=200, headers={})

            with patch("nta_jee_main_acquisition._open_request", side_effect=restart_opener):
                staged, downloaded = acquisition._download_to_stage(
                    url="https://www.nta.ac.in/Download/ExamPaper/restart.pdf",
                    destination=destination,
                    max_file_bytes=100,
                    max_total_bytes=100,
                    total_bytes_used=0,
                    timeout_seconds=1.0,
                )

            self.assertEqual(requests, ["bytes=5-"])
            self.assertEqual(staged, part_path)
            self.assertEqual(staged.read_bytes(), b"%PDF-1.4\nfresh\n")
            self.assertEqual(downloaded, len(b"%PDF-1.4\nfresh\n"))
            self.assertFalse(destination.exists())

    def test_download_rejects_malformed_or_truncated_resume_ranges(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            destination = staging_dir / "resume.pdf"
            part_path = destination.with_suffix(".pdf.part")
            part_path.write_bytes(b"%PDF")

            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [b"-1.4\nrest\n"],
                    status=206,
                    headers={"Content-Range": "bytes 3-13/14"},
                ),
            ):
                with self.assertRaisesRegex(acquisition.AcquisitionError, "invalid Content-Range"):
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/resume.pdf",
                        destination=destination,
                        max_file_bytes=100,
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

            part_path.write_bytes(b"%PDF")
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [b"-1.4\nrest\n"],
                    status=206,
                    headers={"Content-Range": "bytes 4-3/14"},
                ),
            ):
                with self.assertRaisesRegex(acquisition.AcquisitionError, "invalid Content-Range"):
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/resume.pdf",
                        destination=destination,
                        max_file_bytes=100,
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

            part_path.write_bytes(b"%PDF")
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse(
                    [b"-1.4"],
                    status=206,
                    headers={"Content-Range": "bytes 4-13/14"},
                ),
            ):
                with self.assertRaisesRegex(acquisition.AcquisitionError, "truncated body"):
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/resume.pdf",
                        destination=destination,
                        max_file_bytes=100,
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

    def test_interrupted_download_leaves_resumable_part_without_promotion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            staging_dir = Path(tmp_dir)
            destination = staging_dir / "interrupted.pdf"
            with patch(
                "nta_jee_main_acquisition._open_request",
                return_value=_FakeResponse([b"%PDF-", OSError("socket lost")]),
            ):
                with self.assertRaises(acquisition.DownloadTransferError) as ctx:
                    acquisition._download_to_stage(
                        url="https://www.nta.ac.in/Download/ExamPaper/interrupted.pdf",
                        destination=destination,
                        max_file_bytes=100,
                        max_total_bytes=100,
                        total_bytes_used=0,
                        timeout_seconds=1.0,
                    )

            self.assertTrue(ctx.exception.preserve_part)
            self.assertFalse(destination.exists())
            self.assertEqual(destination.with_suffix(".pdf.part").read_bytes(), b"%PDF-")

    def test_existing_verified_stage_is_reused_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "reuse",
                                names=["BTech English"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                            )
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule([("2024-04-09", 2, "final_key_notice", False)]),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            staging_dir.mkdir()
            staged_path = acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
            )
            staged_path.write_bytes(b"%PDF-1.4\nreuse\n")
            sidecar_path = acquisition._sidecar_path(staged_path)
            sidecar = {
                "schema_version": acquisition.SIDECAR_SCHEMA_VERSION,
                "paper_url": "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
                "sha256": acquisition.sha256_file(staged_path),
                "size_bytes": staged_path.stat().st_size,
                "page_count": 11,
                "pdf_magic": True,
                "question_paper_name": "B.E./B.Tech. 9 Apr 2024 Shift 2",
                "subject_name": "B.E./B.Tech Paper 1",
                "creation_date": "2024-04-09",
                "language": "English",
                "official_key": "2024-04-09-shift-2",
                "retrieved_at": "2026-08-10T10:00:00Z",
                "warnings": [],
            }
            sidecar_path.write_text(
                json.dumps(sidecar, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    side_effect=AssertionError("network should not be used"),
                ),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=11),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    ),
                ),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            self.assertEqual(report["summary"]["verified_candidates"], 1)
            self.assertFalse((staging_dir / "reuse.pdf.part").exists())
            self.assertEqual(report["verified_candidates"][0]["retrieved_at"], "2026-08-10T10:00:00Z")

    def test_dry_run_ignores_existing_staged_state_and_does_not_probe_network(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "reuse",
                                names=["BTech English"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                            )
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule([("2024-04-09", 2, "final_key_notice", False)]),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            staging_dir.mkdir()
            staged_path = acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
            )
            staged_path.write_bytes(b"%PDF-1.4\nreuse\n")
            acquisition._sidecar_path(staged_path).write_text(
                json.dumps(
                    {
                        "schema_version": acquisition.SIDECAR_SCHEMA_VERSION,
                        "paper_url": "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
                        "sha256": acquisition.sha256_file(staged_path),
                        "size_bytes": staged_path.stat().st_size,
                        "page_count": 11,
                        "pdf_magic": True,
                        "question_paper_name": "B.E./B.Tech. 9 Apr 2024 Shift 2",
                        "subject_name": "B.E./B.Tech Paper 1",
                        "creation_date": "2024-04-09",
                        "language": "English",
                        "official_key": "2024-04-09-shift-2",
                        "retrieved_at": "2026-08-10T10:00:00Z",
                        "warnings": [],
                    },
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            with patch(
                "nta_jee_main_acquisition._open_request",
                side_effect=AssertionError("dry-run should not use network"),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=True,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            self.assertEqual(report["summary"]["verified_candidates"], 0)
            self.assertEqual(report["summary"]["canonical_candidates"], 0)
            self.assertEqual(report["verified_candidates"], [])
            self.assertEqual(report["canonical_candidates"], [])

    def test_invalid_header_is_quarantined_without_promoting_canonical_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "bad-header",
                                names=["PAPER - I"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                                candidate_status="candidate_generic_paper_1",
                            )
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule([("2024-04-09", 2, "final_key_notice", False)]),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    return_value=_FakeResponse([b"%PDF-1.4\nwrong\n"]),
                ),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=10),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024",
                        subject_name="B.E./B.Tech Paper 1",
                    ),
                ),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            canonical_path = staging_dir / "bad-header.pdf"
            quarantine = report["quarantined_candidates"][0]
            canonical_path = acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/bad-header.pdf",
            )
            self.assertFalse(canonical_path.exists())
            self.assertFalse(acquisition._sidecar_path(canonical_path).exists())
            self.assertEqual(quarantine["quarantine_reason"], "ambiguous_internal_schedule")
            self.assertIn(".quarantine", quarantine["quarantine_path"])
            self.assertTrue(Path(quarantine["quarantine_path"]).is_file())

    def test_forged_sidecar_metadata_does_not_override_actual_pdf_header(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "reuse",
                                names=["PAPER - I"],
                                dates=["08-04-2024"],
                                shifts=["1"],
                                years=[2024],
                                candidate_status="candidate_generic_paper_1",
                            )
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule(
                        [
                            ("2024-04-08", 1, "final_key_notice", False),
                            ("2024-04-09", 2, "final_key_notice", False),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            staging_dir.mkdir()
            staged_path = acquisition._staged_pdf_path(
                staging_dir,
                "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
            )
            staged_path.write_bytes(b"%PDF-1.4\nactual\n")
            acquisition._sidecar_path(staged_path).write_text(
                json.dumps(
                    {
                        "schema_version": acquisition.SIDECAR_SCHEMA_VERSION,
                        "paper_url": "https://www.nta.ac.in/Download/ExamPaper/reuse.pdf",
                        "sha256": acquisition.sha256_file(staged_path),
                        "size_bytes": staged_path.stat().st_size,
                        "page_count": 11,
                        "pdf_magic": True,
                        "question_paper_name": "Forged 8 Apr 2024 Shift 1",
                        "subject_name": "Forged",
                        "creation_date": "2024-04-08",
                        "language": "Hindi",
                        "official_key": "2024-04-08-shift-1",
                        "retrieved_at": "2026-08-10T08:00:00Z",
                        "warnings": [],
                    },
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    side_effect=AssertionError("reuse should not hit network"),
                ),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=11),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    ),
                ),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            verified = report["verified_candidates"][0]
            self.assertEqual(verified["official_key"], "2024-04-09-shift-2")
            self.assertEqual(verified["language"], "English")
            self.assertEqual(verified["retrieved_at"], "2026-08-10T08:00:00Z")
            self.assertIn("metadata_corrected", verified["warnings"])

    def test_same_basename_urls_stage_to_distinct_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            shared_basename = "/Download/ExamPaper/Paper_same.pdf"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "first",
                                names=["BTech English"],
                                dates=["08-04-2024"],
                                shifts=["1"],
                                years=[2024],
                                paper_file=shared_basename,
                                paper_url="https://www.nta.ac.in/Download/ExamPaper/Paper_same.pdf?one=1",
                            ),
                            _paper(
                                "second",
                                names=["BTech English"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                                paper_file=shared_basename,
                                paper_url="https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2024/04/Paper_same.pdf?two=2",
                            ),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule(
                        [
                            ("2024-04-08", 1, "final_key_notice", False),
                            ("2024-04-09", 2, "final_key_notice", False),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            def opener(request, _timeout):
                if "one=1" in request.full_url:
                    return _FakeResponse([b"%PDF-1.4\none\n"])
                return _FakeResponse([b"%PDF-1.4\ntwo\n"])

            def preview(path: Path) -> str:
                if b"one\n" in path.read_bytes():
                    return _pdf_preview(
                        question_paper_name="B.E./B.Tech. 8 Apr 2024 Shift 1",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    )
                return _pdf_preview(
                    question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                    subject_name="B.E./B.Tech Paper 1",
                    language="English",
                )

            with (
                patch("nta_jee_main_acquisition._open_request", side_effect=opener),
                patch("nta_jee_main_acquisition._utc_now", return_value="2026-08-10T09:00:00Z"),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=11),
                patch("nta_jee_main_acquisition._pdftotext_preview", side_effect=preview),
            ):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )

            paths = [Path(item["staged_path"]) for item in report["verified_candidates"]]
            self.assertEqual(len(paths), 2)
            self.assertNotEqual(paths[0], paths[1])
            self.assertTrue(all(path.is_file() for path in paths))
            self.assertTrue(all(acquisition._sidecar_path(path).is_file() for path in paths))
            self.assertEqual({path.read_bytes() for path in paths}, {b"%PDF-1.4\none\n", b"%PDF-1.4\ntwo\n"})

    def test_total_budget_exhaustion_stops_later_candidates_without_opening_them(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "first",
                                names=["BTech English"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                            ),
                            _paper(
                                "second",
                                names=["BTech English"],
                                dates=["08-04-2024"],
                                shifts=["1"],
                                years=[2024],
                            ),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule(
                        [
                            ("2024-04-08", 1, "final_key_notice", False),
                            ("2024-04-09", 2, "final_key_notice", False),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            opened: list[str] = []

            def opener(request, _timeout):
                opened.append(request.full_url)
                return _FakeResponse([b"%PDF-1.4\n1234"])

            with patch("nta_jee_main_acquisition._open_request", side_effect=opener):
                report = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=6,
                )

            self.assertEqual(opened, ["https://www.nta.ac.in/Download/ExamPaper/second.pdf"])
            self.assertEqual(report["verified_candidates"], [])
            self.assertEqual(len(report["quarantined_candidates"]), 2)
            quarantined = {item["paper_url"]: item for item in report["quarantined_candidates"]}
            attempted = quarantined["https://www.nta.ac.in/Download/ExamPaper/second.pdf"]
            skipped = quarantined["https://www.nta.ac.in/Download/ExamPaper/first.pdf"]
            self.assertEqual(
                attempted["quarantine_reason"],
                "total byte cap exceeded for https://www.nta.ac.in/Download/ExamPaper/second.pdf",
            )
            self.assertTrue(Path(attempted["quarantine_path"]).is_file())
            self.assertEqual(skipped["quarantine_reason"], "total_byte_cap_exhausted_before_attempt")

    def test_report_is_byte_stable_and_manifest_is_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            inventory_path = temp_root / "inventory.json"
            schedule_path = temp_root / "schedule.json"
            report_path = temp_root / "report.json"
            staging_dir = temp_root / "staging"
            manifest_path = temp_root / "manifest.jsonl"
            manifest_path.write_text("sentinel\n", encoding="utf-8")
            inventory_path.write_text(
                json.dumps(
                    _inventory(
                        [
                            _paper(
                                "stable",
                                names=["BTech English"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                            ),
                            _paper(
                                "suppressed",
                                names=["BArchPaper2"],
                                dates=["09-04-2024"],
                                shifts=["2"],
                                years=[2024],
                                candidate_status="ambiguous",
                            ),
                        ]
                    ),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            schedule_path.write_text(
                json.dumps(
                    _schedule([("2024-04-09", 2, "final_key_notice", False)]),
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    return_value=_FakeResponse([b"%PDF-1.4\nstable\n"]),
                ),
                patch("nta_jee_main_acquisition._utc_now", return_value="2026-08-10T11:00:00Z"),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=9),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    ),
                ),
            ):
                first = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )
            first_bytes = report_path.read_bytes()

            with (
                patch(
                    "nta_jee_main_acquisition._open_request",
                    side_effect=AssertionError("network should not be used on rerun"),
                ),
                patch("nta_jee_main_acquisition._pdf_page_count", return_value=9),
                patch(
                    "nta_jee_main_acquisition._pdftotext_preview",
                    return_value=_pdf_preview(
                        question_paper_name="B.E./B.Tech. 9 Apr 2024 Shift 2",
                        subject_name="B.E./B.Tech Paper 1",
                        language="English",
                    ),
                ),
            ):
                second = acquisition.run_acquisition(
                    inventory_path=inventory_path,
                    schedule_path=schedule_path,
                    staging_dir=staging_dir,
                    report_path=report_path,
                    dry_run=False,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )
            second_bytes = report_path.read_bytes()

            self.assertEqual(first, second)
            self.assertEqual(first_bytes, second_bytes)
            self.assertEqual(manifest_path.read_text(encoding="utf-8"), "sentinel\n")
            self.assertEqual(len(second["suppressed_candidates"]), 1)
            self.assertEqual(second["quarantined_candidates"], [])
            self.assertEqual(second["verified_candidates"][0]["retrieved_at"], "2026-08-10T11:00:00Z")


if __name__ == "__main__":
    unittest.main()
