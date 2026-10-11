"""Synthetic source-adapter integration; no recorded outcomes or grades are read."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


evidence = module("followup_secondary_evidence_test", "verify-secondary-evidence.py")
aggregation = module("followup_secondary_aggregation_test", "aggregate-secondary-results.py")


class SecondaryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.context = Path(self.tmp.name)
        cells = [{"cohort": c, "rep": r, "arm": a}
                 for c in evidence.COHORTS for r in (1, 2) for a in ("main", "candidate")
                 if (c, r, a) != ("development", 2, "candidate")]
        self.imported = {"arms": cells, "outcomes": 200}
        self.registration = {"context": str(self.context), "secondaryPlan": {
            "schema": "secondary-report-only/v1", "outcomes": 200, "logicalCells": 7,
            "missingCell": dict(evidence.MISSING_CELL), "onlyIfFollowupAborts": True,
            "excludeAllOldAndNewAbortedPrefixes": True, "qualitySelection": False,
            "ready": False, "prEligible": False, "cells": copy.deepcopy(cells)},
            "cohorts": {c: {"rowIds": [f"synthetic-{c}-{i}" for i in range(n)]}
                        for c, n in evidence.COHORTS.items()}}
        self.abort = {**evidence.MISSING_CELL, "sourceTuning": False, "selectiveRetry": False,
                      "allPartialBlocksUngraded": True, "reason": "synthetic operational budget stop"}

    def verify(self):
        with patch.object(evidence, "verify_preregistration", return_value=self.registration) as prereg, \
             patch.object(evidence, "verify_imported", return_value=self.imported), \
             patch.object(evidence, "read_json", return_value=self.abort), \
             patch.object(evidence, "sha", return_value="synthetic-hash"):
            result = evidence.verify_secondary_evidence("synthetic-preregistration.json")
            prereg.assert_called_once_with("synthetic-preregistration.json", check_builds=False)
            return result

    def outcomes(self):
        return [{**cell, "rowId": row, "figureNeed": "required", "drawn": False, "cardId": None}
                for cell in self.imported["arms"]
                for row in self.registration["cohorts"][cell["cohort"]]["rowIds"]]

    def test_actual_adapter_imports_and_bridge_interface(self):
        reg, imported, abort = self.verify()
        self.assertEqual(imported["outcomes"], 200)
        self.assertEqual(abort["sha256"], "synthetic-hash")
        self.assertFalse(reg["secondaryPlan"]["ready"])

    def test_operational_abort_is_required(self):
        self.abort["reason"] = ""
        with self.assertRaises(ValueError): self.verify()

    def test_quality_selection_or_prefix_grading_rejected(self):
        for key, value in (("sourceTuning", True), ("selectiveRetry", True), ("allPartialBlocksUngraded", False)):
            with self.subTest(key=key):
                previous = self.abort[key]; self.abort[key] = value
                with self.assertRaises(ValueError): self.verify()
                self.abort[key] = previous

    def test_completed_primary_cannot_select_secondary(self):
        (self.context / "all-arms-complete.json").write_text("{}")
        with self.assertRaises(ValueError): self.verify()

    def test_missing_or_duplicate_imported_cell_rejected(self):
        original = copy.deepcopy(self.imported["arms"])
        for changed in (original[:-1], original[:-1] + [original[0]]):
            self.imported["arms"] = changed
            with self.assertRaises(ValueError): self.verify()

    def test_wrong_abort_cell_rejected(self):
        self.abort["rep"] = 1
        with self.assertRaises(ValueError): self.verify()

    def test_prospective_scope_cannot_become_ready_or_reordered(self):
        self.registration["secondaryPlan"]["ready"] = True
        with self.assertRaises(ValueError): self.verify()
        self.registration["secondaryPlan"]["ready"] = False
        self.registration["secondaryPlan"]["cells"].reverse()
        with self.assertRaises(ValueError): self.verify()

    def test_synthetic_full_seven_cells_have_explicit_missing_pair(self):
        reports = aggregation.aggregate_secondary(self.outcomes(), {}, self.registration)
        self.assertEqual(len(reports), 4)
        missing = next(r for r in reports if r["cohort"] == "development" and r["rep"] == 2)
        for key in ("rightDelta", "wrongDelta", "requiredEmptyDelta", "pass", "pairedTransitions", "newlyWrong"):
            self.assertIsNone(missing[key])
        self.assertIsNone(missing["arms"]["candidate"])
        self.assertEqual(sum(a["n"] for r in reports for a in r["arms"].values() if a), 200)

    def test_synthetic_aborted_prefix_or_missing_outcome_rejected(self):
        original = self.outcomes()
        prefix = {**original[0], "rep": 2, "arm": "candidate"}
        for rows in (original[:-1], original + [prefix], original[:-1] + [prefix]):
            with self.assertRaises(ValueError): aggregation.aggregate_secondary(rows, {}, self.registration)

    def test_synthetic_foreign_row_id_rejected(self):
        rows = self.outcomes(); rows[0]["rowId"] = "foreign-synthetic-id"
        with self.assertRaises(ValueError): aggregation.aggregate_secondary(rows, {}, self.registration)


if __name__ == "__main__":
    unittest.main()
