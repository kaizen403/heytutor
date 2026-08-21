from __future__ import annotations


import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from corpus_sources import ImportError as CatalogError
from corpus_sources import _validate_catalog, _zip_pdf_hashes, build_catalog


class CorpusSourceTests(unittest.TestCase):
    def test_generated_catalog_is_structurally_valid(self) -> None:
        catalog = _validate_catalog(build_catalog())

        self.assertEqual(catalog["schema_version"], "question-bank-source-catalog/v1")
        self.assertEqual(len(catalog["artifacts"]), 67)
        self.assertEqual(
            len({item["artifact_id"] for item in catalog["artifacts"]}),
            len(catalog["artifacts"]),
        )

    def test_catalog_rejects_non_https_artifact(self) -> None:
        catalog = build_catalog()
        catalog["artifacts"][0]["url"] = "http://example.invalid/paper.pdf"

        with self.assertRaisesRegex(CatalogError, "expected an HTTPS URL"):
            _validate_catalog(catalog)

    def test_zip_member_hash_comes_from_the_declared_container(self) -> None:
        pdf_bytes = b"%PDF-1.4\nverified member\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            archive_path = Path(temporary_directory) / "papers.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("Physics/set-1.pdf", pdf_bytes)

            hashes = _zip_pdf_hashes(archive_path)

        self.assertEqual(
            hashes,
            {"Physics/set-1.pdf": hashlib.sha256(pdf_bytes).hexdigest()},
        )


if __name__ == "__main__":
    unittest.main()
