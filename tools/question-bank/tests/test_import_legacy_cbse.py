from __future__ import annotations


import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from import_legacy_cbse import import_legacy_cbse
from question_bank.models import load_documents


class LegacyCbseImportTests(unittest.TestCase):
    def test_imports_direct_and_archive_member_with_container_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            staging = root / "staging"
            raw = root / "raw"
            manifest = root / "manifest.jsonl"
            staging.mkdir()
            pdf_bytes = b"%PDF-1.4\nminimal fixture\n%%EOF\n"
            direct = staging / "direct.pdf"
            direct.write_bytes(pdf_bytes)
            archive = staging / "archive.zip"
            member = "maths/65-1 Mathematics.pdf"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr(member, pdf_bytes + b"member")

            common = {
                "accessibility_variant": "standard",
                "region": None,
                "session": "main",
                "set_label": "SET1",
                "source_page_url": "https://example.invalid/index.html",
                "verification_status": "verified",
                "year": 2015,
            }
            report = {
                "schema_version": "question-bank-legacy-cbse-sources/v1",
                "generated_at": "2025-01-01T00:00:00Z",
                "artifacts": [
                    {
                        **common,
                        "artifact_id": "cbse-2015-main-physics-set-1",
                        "kind": "pdf",
                        "members": None,
                        "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                        "staged_path": str(direct),
                        "subject": "Physics",
                        "url": "https://example.invalid/physics.pdf",
                    },
                    {
                        **common,
                        "artifact_id": "cbse-2015-main-mathematics-archive",
                        "kind": "zip",
                        "members": [member],
                        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                        "staged_path": str(archive),
                        "subject": "Mathematics",
                        "url": "https://example.invalid/mathematics.zip",
                    },
                ],
            }
            report_path = root / "report.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")

            result = import_legacy_cbse(report_path, staging, manifest, raw)
            documents = load_documents(manifest)

            self.assertEqual(result["imported_documents"], 2)
            self.assertEqual(len(documents), 2)
            archived = next(
                item for item in documents if item["artifact"]["member_path"] is not None
            )
            self.assertEqual(archived["artifact"]["member_path"], member)
            self.assertEqual(
                archived["artifact"]["container_sha256"],
                hashlib.sha256(archive.read_bytes()).hexdigest(),
            )
            self.assertTrue((raw / f"{archived['document_id']}.pdf").is_file())


if __name__ == "__main__":
    unittest.main()
