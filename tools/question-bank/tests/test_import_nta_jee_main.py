from __future__ import annotations


import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'importers'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import import_nta_jee_main as importer
from question_bank.models import load_documents


def _pdf_bytes(tag: str) -> bytes:
    return f"%PDF-1.4\n{tag}\n%%EOF\n".encode("utf-8")


def _preview(exam_date: str, shift: int, *, language: str | None = None) -> str:
    month_names = {
        "01": "Jan",
        "02": "Feb",
        "03": "Mar",
        "04": "Apr",
        "05": "May",
        "06": "Jun",
        "07": "Jul",
        "08": "Aug",
        "09": "Sep",
        "10": "Oct",
        "11": "Nov",
        "12": "Dec",
    }
    year, month, day = exam_date.split("-")
    month_label = month_names[month]
    pieces = [
        f"Question Paper Name : B TECH {int(day)}th {month_label} {year} Shift {shift}",
        "Subject Name : B TECH",
        "Creation Date : 2021-02-23 19:48:09",
    ]
    if language is not None:
        pieces.append(f"Lang {language}")
    return "\n".join(pieces)


def _candidate_entry(
    *,
    staged_path: Path,
    paper_url: str,
    exam_date: str,
    shift: int,
    pdf_bytes: bytes,
    page_count: int = 53,
    retrieved_at: str = "2026-08-10T20:44:56.334923Z",
    language: str | None = None,
    language_variant: str = "english",
    regional_fallback: bool = False,
) -> dict[str, object]:
    official_key = f"{exam_date}-shift-{shift}"
    question_paper_name = _preview(exam_date, shift, language=language).splitlines()[0].split(":", 1)[1].strip()
    subject_name = "B TECH"
    creation_date = "2021-02-23 19:48:09"
    sidecar = {
        "schema_version": importer.acquisition.SIDECAR_SCHEMA_VERSION,
        "paper_url": paper_url,
        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
        "size_bytes": len(pdf_bytes),
        "page_count": page_count,
        "pdf_magic": True,
        "question_paper_name": question_paper_name,
        "subject_name": subject_name,
        "creation_date": creation_date,
        "language": language,
        "official_key": official_key,
        "retrieved_at": retrieved_at,
        "warnings": [],
    }
    importer.acquisition._sidecar_path(staged_path).write_text(
        json.dumps(sidecar, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return {
        "official_key": official_key,
        "exam_date": exam_date,
        "shift": shift,
        "evidence_type": "final_key_notice",
        "expected_gap": False,
        "session_id": f"{exam_date[:4]}-session",
        "session_label": exam_date[:7],
        "source_url": "https://www.nta.ac.in/notice.pdf",
        "alternate_source_urls": [],
        "year": int(exam_date[:4]),
        "canonical": {
            "official_key": official_key,
            "paper_url": paper_url,
            "staged_path": str(staged_path),
            "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
            "size_bytes": len(pdf_bytes),
            "page_count": page_count,
            "reported_schedule_keys": [official_key],
            "plan_reason": "reported_schedule_match",
            "question_paper_name": question_paper_name,
            "subject_name": subject_name,
            "creation_date": creation_date,
            "retrieved_at": retrieved_at,
            "language": language,
            "language_variant": language_variant,
            "variant_rank": 1 if not regional_fallback else 4,
            "internal_exam_date": exam_date,
            "internal_shift": shift,
            "warnings": [],
        },
        "alternates": [],
        "regional_fallback": regional_fallback,
    }


def _acquisition_report(
    canonical_candidates: list[dict[str, object]],
    *,
    dry_run: bool = False,
    missing_schedule_keys: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    if missing_schedule_keys is None:
        missing_schedule_keys = []
    return {
        "schema_version": importer.acquisition.REPORT_SCHEMA_VERSION,
        "inventory_report_path": "/tmp/inventory.json",
        "inventory_observed_at": "2026-08-10T00:00:00Z",
        "inventory_report_filename_date": "2026-08-10",
        "schedule_path": "/tmp/schedule.json",
        "schedule_as_of": "2026-08-10",
        "dry_run": dry_run,
        "config": {
            "staging_dir": "/tmp/staging",
            "max_file_bytes": 33554432,
            "max_total_bytes": 2147483648,
            "timeout_seconds": 30.0,
        },
        "expected_schedule_keys": [],
        "planned_candidates": [],
        "suppressed_candidates": [],
        "verified_candidates": [],
        "quarantined_candidates": [],
        "canonical_candidates": canonical_candidates,
        "missing_schedule_keys": missing_schedule_keys,
        "summary": {
            "expected_schedule_keys": len(canonical_candidates) + len(missing_schedule_keys),
            "planned_candidates": 0,
            "suppressed_candidates": 0,
            "verified_candidates": len(canonical_candidates),
            "quarantined_candidates": 0,
            "canonical_candidates": len(canonical_candidates),
            "missing_schedule_keys": len(missing_schedule_keys),
        },
        "notes": [],
    }


def _reverify_report(records: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": importer.reverify_quarantine.REPORT_SCHEMA_VERSION,
        "inventory_report": "/tmp/inventory.json",
        "schedule_path": "/tmp/schedule.json",
        "selectors": {"paper_files": [], "official_keys": [], "quarantine_paths": []},
        "unresolved_selectors": [],
        "all_records_jsonl": "/tmp/all.jsonl",
        "verified_records_jsonl": "/tmp/verified.jsonl",
        "summary": {
            "selected_candidates": len(records),
            "verified": len(records),
            "quarantined": 0,
            "missing_local_quarantine": 0,
            "ambiguous_local_quarantine": 0,
        },
        "records": records,
    }


class ImportNtaJeeMainTests(unittest.TestCase):
    def _run_import(
        self,
        root: Path,
        report_payload: dict[str, object],
        *,
        page_counts: dict[str, int] | None = None,
        previews: dict[str, str] | None = None,
        allow_regional_fallback: bool = False,
    ) -> dict[str, object]:
        staging = root / "staging"
        raw = root / "raw"
        manifest = root / "manifest.jsonl"
        report_path = root / "acquisition-report.json"
        output_report = root / "import-report.json"
        report_path.write_text(json.dumps(report_payload, indent=2), encoding="utf-8")
        page_counts = page_counts or {}
        previews = previews or {}

        def fake_page_count(path: Path) -> int:
            resolved = str(Path(path).resolve())
            for stored, value in page_counts.items():
                if str(Path(stored).resolve()) == resolved:
                    return value
            return page_counts[str(path)]

        def fake_preview(path: Path) -> str:
            resolved = str(Path(path).resolve())
            for stored, value in previews.items():
                if str(Path(stored).resolve()) == resolved:
                    return value
            return previews[str(path)]

        with patch.object(importer.acquisition, "_pdf_page_count", side_effect=fake_page_count), patch.object(
            importer.acquisition,
            "_pdftotext_preview",
            side_effect=fake_preview,
        ):
            return importer.import_nta_jee_main(
                report_path,
                staging,
                manifest,
                raw,
                output_report,
                allow_regional_fallback=allow_regional_fallback,
            )

    def test_imports_partial_official_batch_and_stays_candidate_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_one = _pdf_bytes("one")
            pdf_two = _pdf_bytes("two")
            path_one = staging / "paper-one.pdf"
            path_two = staging / "paper-two.pdf"
            path_one.write_bytes(pdf_one)
            path_two.write_bytes(pdf_two)
            candidate_one = _candidate_entry(
                staged_path=path_one,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper-one.pdf",
                exam_date="2021-02-24",
                shift=1,
                pdf_bytes=pdf_one,
            )
            candidate_two = _candidate_entry(
                staged_path=path_two,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper-two.pdf",
                exam_date="2021-02-25",
                shift=2,
                pdf_bytes=pdf_two,
                page_count=61,
                language="EnglishHindi",
                language_variant="english_hindi",
            )
            report = _acquisition_report(
                [candidate_one, candidate_two],
                missing_schedule_keys=[
                    {
                        "official_key": "2021-02-26-shift-1",
                        "exam_date": "2021-02-26",
                        "shift": 1,
                        "evidence_type": "final_key_notice",
                        "expected_gap": False,
                        "session_id": "2021-session",
                        "session_label": "2021-02",
                        "source_url": "https://www.nta.ac.in/notice.pdf",
                        "alternate_source_urls": [],
                        "year": 2021,
                    }
                ],
            )

            result = self._run_import(
                root,
                report,
                page_counts={str(path_one): 53, str(path_two): 61},
                previews={
                    str(path_one): _preview("2021-02-24", 1),
                    str(path_two): _preview("2021-02-25", 2, language="EnglishHindi"),
                },
            )

            documents = load_documents(root / "manifest.jsonl")
            self.assertEqual(result["source_release_status"], "candidate_only")
            self.assertEqual(result["summary"]["imported_documents"], 2)
            self.assertEqual(result["summary"]["missing_schedule_keys"], 1)
            self.assertEqual(len(documents), 2)
            self.assertEqual(
                [document["document_id"] for document in documents],
                ["jee-main-2021-02-24-shift-1", "jee-main-2021-02-25-shift-2"],
            )
            self.assertEqual(documents[0]["status"], "acquired")
            self.assertEqual(documents[1]["paper"]["language"], "English/Hindi")
            self.assertTrue((root / "raw" / "jee-main-2021-02-24-shift-1.pdf").is_file())
            self.assertTrue((root / "import-report.json").is_file())

    def test_imports_verified_reverify_records_without_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("legacy-reverify")
            quarantine = staging / "Paper_20230320112124-a.pdf.non-paper1-subject-evidence.quarantine"
            quarantine.write_bytes(pdf_bytes)
            report = _reverify_report(
                [
                    {
                        "schema_version": importer.reverify_quarantine.RECORD_SCHEMA_VERSION,
                        "status": "verified",
                        "paper_file": "/Download/ExamPaper/Paper_20230320112124.pdf",
                        "paper_url": "https://www.nta.ac.in/Download/ExamPaper/Paper_20230320112124.pdf",
                        "reported_schedule_keys": ["2022-06-24-shift-1"],
                        "candidate_status": "candidate",
                        "plan_reason": "reported_schedule_match",
                        "candidate_language_variant": "english",
                        "language_variant": "english",
                        "official_key": "2022-06-24-shift-1",
                        "question_paper_name": None,
                        "subject_name": "B.E/B.Tech.(Paper I)",
                        "creation_date": None,
                        "language": "English",
                        "internal_exam_date": "2022-06-24",
                        "internal_shift": 1,
                        "year": 2022,
                        "session_id": "2022-s1",
                        "session_label": "2022-s1",
                        "source_url": "https://www.nta.ac.in/notice.pdf",
                        "alternate_source_urls": [],
                        "evidence_type": "final_key_notice",
                        "expected_gap": False,
                        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                        "size_bytes": len(pdf_bytes),
                        "page_count": 26,
                        "pdf_magic": True,
                        "staged_path": str(quarantine),
                        "staged_basename": quarantine.name,
                        "quarantine_path": str(quarantine),
                        "evaluation_path": "legacy_english_header_fallback",
                        "retrieved_at": "2026-08-10T10:00:00Z",
                    }
                ]
            )

            result = self._run_import(
                root,
                report,
                page_counts={str(quarantine): 26},
                previews={
                    str(quarantine): "\n".join(
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
                },
            )

            documents = load_documents(root / "manifest.jsonl")
            self.assertEqual(result["summary"]["imported_documents"], 1)
            self.assertEqual(result["summary"]["missing_schedule_keys"], 0)
            self.assertEqual(documents[0]["document_id"], "jee-main-2022-06-24-shift-1")
            self.assertEqual(documents[0]["paper"]["language"], "English")
            self.assertTrue((root / "raw" / "jee-main-2022-06-24-shift-1.pdf").is_file())

    def test_idempotent_rerun_reuses_manifest_and_raw(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("stable")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-03-16",
                shift=1,
                pdf_bytes=pdf_bytes,
                page_count=42,
            )
            report = _acquisition_report([candidate])
            page_counts = {str(staged): 42}
            previews = {str(staged): _preview("2021-03-16", 1)}

            first = self._run_import(root, report, page_counts=page_counts, previews=previews)
            second = self._run_import(root, report, page_counts=page_counts, previews=previews)

            self.assertEqual(first["summary"]["imported_documents"], 1)
            self.assertEqual(second["summary"]["imported_documents"], 0)
            self.assertEqual(second["summary"]["reused_manifest_documents"], 1)
            self.assertEqual(second["summary"]["reused_raw_documents"], 1)
            self.assertEqual(len(load_documents(root / "manifest.jsonl")), 1)

    def test_manifest_hash_conflict_is_fatal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            raw = root / "raw"
            staging.mkdir()
            raw.mkdir()
            pdf_bytes = _pdf_bytes("new")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-07-20",
                shift=2,
                pdf_bytes=pdf_bytes,
            )
            existing = importer._document_record(
                {
                    "document_id": "jee-main-2021-07-20-shift-2",
                    "official_key": "2021-07-20-shift-2",
                    "exam_date": "2021-07-20",
                    "shift": 2,
                    "year": 2021,
                    "session_label": "2021-07",
                    "session_id": "2021-session",
                    "schedule_source_url": "https://www.nta.ac.in/notice.pdf",
                    "alternate_source_urls": [],
                    "evidence_type": "final_key_notice",
                    "expected_gap": False,
                    "paper_url": "https://www.nta.ac.in/Download/ExamPaper/old.pdf",
                    "sha256": hashlib.sha256(_pdf_bytes("old")).hexdigest(),
                    "size_bytes": len(_pdf_bytes("old")),
                    "page_count": 20,
                    "retrieved_at": "2026-08-10T00:00:00Z",
                    "language": "English",
                    "language_variant": "english",
                    "question_paper_name": "B TECH 20th Jul 2021 Shift 2",
                    "subject_name": "B TECH",
                    "creation_date": "2021-02-23 19:48:09",
                    "staged_path": staged,
                    "raw_path": raw / "jee-main-2021-07-20-shift-2.pdf",
                    "regional_fallback": False,
                }
            )
            importer.write_jsonl(root / "manifest.jsonl", [existing])
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "manifest hash conflict"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-07-20", 2)},
                )

    def test_raw_hash_conflict_is_fatal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            raw = root / "raw"
            staging.mkdir()
            raw.mkdir()
            pdf_bytes = _pdf_bytes("new")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-07-21",
                shift=1,
                pdf_bytes=pdf_bytes,
            )
            (raw / "jee-main-2021-07-21-shift-1.pdf").write_bytes(_pdf_bytes("other"))
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "raw PDF hash conflict"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-07-21", 1)},
                )

    def test_rejects_staged_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            external = root / "external.pdf"
            pdf_bytes = _pdf_bytes("external")
            external.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=external,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-08-26",
                shift=2,
                pdf_bytes=pdf_bytes,
            )
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "escapes --staging-dir"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(external): 53},
                    previews={str(external): _preview("2021-08-26", 2)},
                )

    def test_rejects_forged_sidecar_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("forged")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-01",
                shift=1,
                pdf_bytes=pdf_bytes,
            )
            sidecar_path = importer.acquisition._sidecar_path(staged)
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
            sidecar["sha256"] = "0" * 64
            sidecar_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "sidecar sha256 does not match staged file"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-09-01", 1)},
                )

    def test_rejects_forged_sidecar_page_count(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("pages")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-02",
                shift=2,
                pdf_bytes=pdf_bytes,
                page_count=59,
            )
            sidecar_path = importer.acquisition._sidecar_path(staged)
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
            sidecar["page_count"] = 60
            sidecar_path.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "sidecar page_count does not match staged file"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 59},
                    previews={str(staged): _preview("2021-09-02", 2)},
                )

    def test_rejects_header_schedule_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("header")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-03",
                shift=1,
                pdf_bytes=pdf_bytes,
            )
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "preview header resolved"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-09-04", 1)},
                )

    def test_rejects_dry_run_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("dry")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-04",
                shift=2,
                pdf_bytes=pdf_bytes,
            )
            report = _acquisition_report([candidate], dry_run=True)

            with self.assertRaisesRegex(importer.ImportError, "dry_run reports cannot be imported"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-09-04", 2)},
                )

    def test_rejects_reverify_record_that_no_longer_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("broken-reverify")
            quarantine = staging / "Paper_20230926123934-a.pdf.ambiguous-internal-schedule.quarantine"
            quarantine.write_bytes(pdf_bytes)
            report = _reverify_report(
                [
                    {
                        "schema_version": importer.reverify_quarantine.RECORD_SCHEMA_VERSION,
                        "status": "verified",
                        "paper_file": "/Download/ExamPaper/Paper_20230926123934.pdf",
                        "paper_url": "https://www.nta.ac.in/Download/ExamPaper/Paper_20230926123934.pdf",
                        "reported_schedule_keys": ["2023-04-06-shift-2"],
                        "candidate_status": "candidate",
                        "plan_reason": "reported_schedule_match",
                        "candidate_language_variant": "english_hindi",
                        "language_variant": "english_hindi",
                        "official_key": "2023-04-06-shift-2",
                        "question_paper_name": "111",
                        "subject_name": "B TECH",
                        "creation_date": "2023-04-06 20:52:20",
                        "language": None,
                        "internal_exam_date": "2023-04-06",
                        "internal_shift": 2,
                        "year": 2023,
                        "session_id": "2023-s2",
                        "session_label": "2023-s2",
                        "source_url": "https://www.nta.ac.in/notice.pdf",
                        "alternate_source_urls": [],
                        "evidence_type": "final_key_notice",
                        "expected_gap": False,
                        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                        "size_bytes": len(pdf_bytes),
                        "page_count": 48,
                        "pdf_magic": True,
                        "staged_path": str(quarantine),
                        "staged_basename": quarantine.name,
                        "quarantine_path": str(quarantine),
                        "evaluation_path": "english_hindi_numeric_fallback",
                        "retrieved_at": "2026-08-10T10:00:00Z",
                    }
                ]
            )

            with self.assertRaisesRegex(importer.ImportError, "local re-verification no longer passes"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(quarantine): 48},
                    previews={str(quarantine): "Question Paper Name : x\nSubject Name : B ARCH\nCreation Date : 2023-04-06"},
                )

    def test_rejects_regional_fallback_without_flag(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_bytes = _pdf_bytes("regional")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-05",
                shift=1,
                pdf_bytes=pdf_bytes,
                language="Hindi",
                language_variant="regional",
                regional_fallback=True,
            )
            report = _acquisition_report([candidate])

            with self.assertRaisesRegex(importer.ImportError, "requires --allow-regional-fallback"):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): _preview("2021-09-05", 1, language="Hindi")},
                )

    def test_rolls_back_new_raw_files_when_copy_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            staging.mkdir()
            pdf_one = _pdf_bytes("one")
            pdf_two = _pdf_bytes("two")
            path_one = staging / "paper-one.pdf"
            path_two = staging / "paper-two.pdf"
            path_one.write_bytes(pdf_one)
            path_two.write_bytes(pdf_two)
            report = _acquisition_report(
                [
                    _candidate_entry(
                        staged_path=path_one,
                        paper_url="https://www.nta.ac.in/Download/ExamPaper/paper-one.pdf",
                        exam_date="2021-09-06",
                        shift=1,
                        pdf_bytes=pdf_one,
                    ),
                    _candidate_entry(
                        staged_path=path_two,
                        paper_url="https://www.nta.ac.in/Download/ExamPaper/paper-two.pdf",
                        exam_date="2021-09-07",
                        shift=2,
                        pdf_bytes=pdf_two,
                    ),
                ]
            )
            page_counts = {str(path_one): 53, str(path_two): 53}
            previews = {
                str(path_one): _preview("2021-09-06", 1),
                str(path_two): _preview("2021-09-07", 2),
            }
            original_write = importer._atomic_write_bytes
            state = {"calls": 0}

            def flaky_write(path: Path, data: bytes) -> None:
                state["calls"] += 1
                if state["calls"] == 2:
                    raise OSError("simulated raw write failure")
                original_write(path, data)

            with patch.object(importer, "_atomic_write_bytes", side_effect=flaky_write):
                with self.assertRaises(OSError):
                    self._run_import(root, report, page_counts=page_counts, previews=previews)

            self.assertFalse((root / "raw" / "jee-main-2021-09-06-shift-1.pdf").exists())
            self.assertFalse((root / "raw" / "jee-main-2021-09-07-shift-2.pdf").exists())
            self.assertFalse((root / "manifest.jsonl").exists())

    def test_preflight_failure_leaves_manifest_and_raw_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            raw = root / "raw"
            staging.mkdir()
            raw.mkdir()
            manifest = root / "manifest.jsonl"
            manifest.write_text("", encoding="utf-8")
            sentinel = raw / "sentinel.pdf"
            sentinel.write_bytes(b"sentinel")
            pdf_bytes = _pdf_bytes("bad-header")
            staged = staging / "paper.pdf"
            staged.write_bytes(pdf_bytes)
            candidate = _candidate_entry(
                staged_path=staged,
                paper_url="https://www.nta.ac.in/Download/ExamPaper/paper.pdf",
                exam_date="2021-09-08",
                shift=1,
                pdf_bytes=pdf_bytes,
            )
            report = _acquisition_report([candidate])

            with self.assertRaises(importer.ImportError):
                self._run_import(
                    root,
                    report,
                    page_counts={str(staged): 53},
                    previews={str(staged): "Question Paper Name : B ARCH 8th Sep 2021 Shift 1\nSubject Name : B ARCH"},
                )

            self.assertEqual(manifest.read_text(encoding="utf-8"), "")
            self.assertEqual(sentinel.read_bytes(), b"sentinel")


if __name__ == "__main__":
    unittest.main()
