from __future__ import annotations

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import legacy_jee_sources as legacy


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _minimal_pdf(text: str) -> bytes:
    content = f"BT /F1 24 Tf 72 720 Td ({_escape_pdf_text(text)}) Tj ET\n".encode("utf-8")
    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n"
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\n"
            b"endobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        b"5 0 obj\n<< /Length %d >>\nstream\n" % len(content) + content + b"endstream\nendobj\n",
    ]

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(output))
        output.extend(obj)

    xref_start = len(output)
    output.extend(f"xref\n0 {len(offsets)}\n".encode("utf-8"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("utf-8"))
    output.extend(
        (
            "trailer\n"
            f"<< /Size {len(offsets)} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_start}\n"
            "%%EOF\n"
        ).encode("utf-8")
    )
    return bytes(output)


class LegacyJeeSourcesTests(unittest.TestCase):
    def test_artifact_spec_layout_matches_legacy_stage_semantics(self) -> None:
        specs = legacy._artifact_specs()
        years_and_stages = {(spec.year, spec.stage) for spec in specs}
        self.assertEqual(len(specs), 13)
        self.assertIn((2000, "screening"), years_and_stages)
        self.assertIn((2000, "main"), years_and_stages)
        self.assertIn((2001, "screening"), years_and_stages)
        self.assertIn((2001, "main"), years_and_stages)
        self.assertIn((2002, "screening"), years_and_stages)
        self.assertIn((2002, "main"), years_and_stages)
        self.assertIn((2003, "screening"), years_and_stages)
        self.assertIn((2003, "main"), years_and_stages)
        self.assertIn((2004, "screening"), years_and_stages)
        self.assertIn((2004, "main"), years_and_stages)
        self.assertIn((2005, "screening"), years_and_stages)
        self.assertIn((2005, "main"), years_and_stages)
        self.assertIn((2006, "single"), years_and_stages)

    def test_minimal_pdf_first_page_hashes_are_stable(self) -> None:
        pdf_bytes = _minimal_pdf("JEE 2004 MATHEMATICS PAPERS")
        image_hash, text_hash = legacy._first_page_hashes(pdf_bytes)
        self.assertIsNotNone(image_hash)
        self.assertIsNotNone(text_hash)
        again_image_hash, again_text_hash = legacy._first_page_hashes(pdf_bytes)
        self.assertEqual(image_hash, again_image_hash)
        self.assertEqual(text_hash, again_text_hash)

    def test_build_report_classifies_missing_candidate_verified_and_conflicting(self) -> None:
        artifact_specs = (
            legacy.ArtifactSpec(
                artifact_id="missing",
                year=2000,
                stage="screening",
                paper_label="Screening Paper",
                subject="Mathematics",
                language=None,
                set_label=None,
                source_urls=(),
                notes="missing",
            ),
            legacy.ArtifactSpec(
                artifact_id="candidate",
                year=2003,
                stage="screening",
                paper_label="Screening Paper",
                subject="Mathematics",
                language="English",
                set_label=None,
                source_urls=("https://example.edu/a.pdf",),
                notes="candidate",
            ),
            legacy.ArtifactSpec(
                artifact_id="verified",
                year=2004,
                stage="main",
                paper_label="Main Paper",
                subject="Mathematics",
                language="English",
                set_label=None,
                source_urls=("https://mirror-a.edu/a.pdf", "https://mirror-b.ac.in/b.pdf"),
                notes="verified",
            ),
            legacy.ArtifactSpec(
                artifact_id="conflict",
                year=2005,
                stage="main",
                paper_label="Main Paper",
                subject="Mathematics",
                language="English",
                set_label=None,
                source_urls=("https://mirror-c.edu/a.pdf", "https://mirror-d.ac.in/b.pdf"),
                notes="conflict",
            ),
        )

        probe_map = {
            "https://example.edu/a.pdf": legacy.SourceProbe(
                url="https://example.edu/a.pdf",
                final_url="https://example.edu/a.pdf",
                host="example.edu",
                status=200,
                content_type="application/pdf",
                title=None,
                body_sha256="aaa",
                magic="pdf",
                bytes_sha256="hash-one",
                page_count=1,
                page1_image_sha256="image-one",
                page1_text_sha256="text-one",
                staged_path=None,
                error=None,
            ),
            "https://mirror-a.edu/a.pdf": legacy.SourceProbe(
                url="https://mirror-a.edu/a.pdf",
                final_url="https://mirror-a.edu/a.pdf",
                host="mirror-a.edu",
                status=200,
                content_type="application/pdf",
                title=None,
                body_sha256="bbb",
                magic="pdf",
                bytes_sha256="same-bytes",
                page_count=1,
                page1_image_sha256="same-image",
                page1_text_sha256="same-text",
                staged_path=None,
                error=None,
            ),
            "https://mirror-b.ac.in/b.pdf": legacy.SourceProbe(
                url="https://mirror-b.ac.in/b.pdf",
                final_url="https://mirror-b.ac.in/b.pdf",
                host="mirror-b.ac.in",
                status=200,
                content_type="application/pdf",
                title=None,
                body_sha256="ccc",
                magic="pdf",
                bytes_sha256="same-bytes",
                page_count=1,
                page1_image_sha256="same-image",
                page1_text_sha256="same-text",
                staged_path=None,
                error=None,
            ),
            "https://mirror-c.edu/a.pdf": legacy.SourceProbe(
                url="https://mirror-c.edu/a.pdf",
                final_url="https://mirror-c.edu/a.pdf",
                host="mirror-c.edu",
                status=200,
                content_type="application/pdf",
                title=None,
                body_sha256="ddd",
                magic="pdf",
                bytes_sha256="bytes-a",
                page_count=1,
                page1_image_sha256="image-a",
                page1_text_sha256="text-a",
                staged_path=None,
                error=None,
            ),
            "https://mirror-d.ac.in/b.pdf": legacy.SourceProbe(
                url="https://mirror-d.ac.in/b.pdf",
                final_url="https://mirror-d.ac.in/b.pdf",
                host="mirror-d.ac.in",
                status=200,
                content_type="application/pdf",
                title=None,
                body_sha256="eee",
                magic="pdf",
                bytes_sha256="bytes-b",
                page_count=1,
                page1_image_sha256="image-b",
                page1_text_sha256="text-b",
                staged_path=None,
                error=None,
            ),
        }

        context_urls = {
            "https://jeeadv.ac.in/archive.html": legacy.SourceProbe(
                url="https://jeeadv.ac.in/archive.html",
                final_url="https://jeeadv.ac.in/archive.html",
                host="jeeadv.ac.in",
                status=200,
                content_type="text/html",
                title="JEE (Advanced) 2026",
                body_sha256="ctx-1",
                magic="html",
                bytes_sha256=None,
                page_count=None,
                page1_image_sha256=None,
                page1_text_sha256=None,
                staged_path=None,
                error=None,
            ),
            "https://www.civil.iitb.ac.in/tvm/4201-bioData/tvmcv/tvmcv.html": legacy.SourceProbe(
                url="https://www.civil.iitb.ac.in/tvm/4201-bioData/tvmcv/tvmcv.html",
                final_url="https://www.civil.iitb.ac.in/tvm/4201-bioData/tvmcv/tvmcv.html",
                host="civil.iitb.ac.in",
                status=200,
                content_type="text/html",
                title="Tom V. Mathew - Civil Department | IIT Bombay",
                body_sha256="ctx-2",
                magic="html",
                bytes_sha256=None,
                page_count=None,
                page1_image_sha256=None,
                page1_text_sha256=None,
                staged_path=None,
                error=None,
            ),
            "https://www.math.iitb.ac.in/~kdjoshi/jee": legacy.SourceProbe(
                url="https://www.math.iitb.ac.in/~kdjoshi/jee",
                final_url="https://www.math.iitb.ac.in/~kdjoshi/jee",
                host="math.iitb.ac.in",
                status=200,
                content_type="text/html",
                title="Personal Home Page of K. D. Joshi",
                body_sha256="ctx-3",
                magic="html",
                bytes_sha256=None,
                page_count=None,
                page1_image_sha256=None,
                page1_text_sha256=None,
                staged_path=None,
                error=None,
            ),
        }

        def fake_probe(
            url: str,
            *,
            expect_pdf: bool,
            timeout_seconds: float,
            max_bytes: int,
            staging_dir: Path | None,
            staged_name: str | None = None,
        ) -> legacy.SourceProbe:
            del expect_pdf, timeout_seconds, max_bytes, staging_dir, staged_name
            if url in probe_map:
                return probe_map[url]
            if url in context_urls:
                return context_urls[url]
            raise AssertionError(f"unexpected probe URL: {url}")

        original_artifact_specs = legacy._artifact_specs
        original_context_specs = legacy._context_specs
        original_probe_url = legacy._probe_url
        try:
            legacy._artifact_specs = lambda: artifact_specs  # type: ignore[assignment]
            legacy._context_specs = lambda: (  # type: ignore[assignment]
                legacy.ContextSpec(
                    context_id="archive",
                    label="archive",
                    url="https://jeeadv.ac.in/archive.html",
                    notes="archive",
                ),
                legacy.ContextSpec(
                    context_id="cv",
                    label="cv",
                    url="https://www.civil.iitb.ac.in/tvm/4201-bioData/tvmcv/tvmcv.html",
                    notes="cv",
                ),
                legacy.ContextSpec(
                    context_id="index",
                    label="index",
                    url="https://www.math.iitb.ac.in/~kdjoshi/jee",
                    notes="index",
                ),
            )
            legacy._probe_url = fake_probe  # type: ignore[assignment]
            report = legacy.build_report(
                staging_dir=None,
                timeout_seconds=1.0,
                max_bytes=1024,
            )
        finally:
            legacy._artifact_specs = original_artifact_specs  # type: ignore[assignment]
            legacy._context_specs = original_context_specs  # type: ignore[assignment]
            legacy._probe_url = original_probe_url  # type: ignore[assignment]

        by_id = {artifact["artifact_id"]: artifact for artifact in report["artifacts"]}
        self.assertEqual(by_id["missing"]["status"], "missing")
        self.assertEqual(by_id["candidate"]["status"], "candidate-only")
        self.assertEqual(by_id["verified"]["status"], "verified")
        self.assertEqual(by_id["conflict"]["status"], "conflicting")
        self.assertEqual(report["summary"]["missing"], 1)
        self.assertEqual(report["summary"]["candidate_only"], 1)
        self.assertEqual(report["summary"]["verified"], 1)
        self.assertEqual(report["summary"]["conflicting"], 1)


if __name__ == "__main__":
    unittest.main()
