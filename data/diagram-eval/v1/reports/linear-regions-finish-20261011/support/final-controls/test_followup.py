"""Offline budget/protocol regressions. No network, image decoding or quality reads."""
import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
import measurement_core as core
import budget_guard as guard


def ledger(known=0, unknown=0, reserved=0, inflight=0):
    return {"knownUsageUsd": known, "unresolvedAllowanceUsd": unknown, "reservedUsd": reserved, "inFlightCalls": inflight}


class ExposureTests(unittest.TestCase):
    def test_original_carry_is_floor(self):
        self.assertEqual(guard.admission_exposure(0, 0, {}, {})["admissionExposureUsd"], core.CARRY_USD)

    def test_carry_plus_new_usage_not_new_twenty(self):
        r = guard.admission_exposure(15.8, core.CARRY_USD, {"new": ledger(known=.4)}, {})
        self.assertAlmostEqual(r["admissionExposureUsd"], 15.857060)

    def test_late_old_azure_tokens_count(self):
        r = guard.admission_exposure(19.4, core.CARRY_USD, {"new": ledger(reserved=.2, inflight=1)}, {})
        self.assertFalse(r["mayDispatch"])
        self.assertAlmostEqual(r["admissionExposureUsd"], 19.6)

    def test_no_duplicate_overlapping_estimates(self):
        self.assertEqual(guard.admission_exposure(16, core.CARRY_USD, {"new": ledger(known=.2)}, {})["admissionExposureUsd"], 16)

    def test_unknown_usage_is_not_free(self):
        r = guard.admission_exposure(core.CARRY_USD, core.CARRY_USD, {"new": ledger(unknown=4.1)}, {})
        self.assertFalse(r["mayDispatch"])

    def test_all_simultaneous_same_row_reservations_count(self):
        r = guard.admission_exposure(19, 19, {"a": ledger(reserved=.3, inflight=2), "b": ledger(reserved=.25, inflight=1)}, {})
        self.assertAlmostEqual(r["reservedInFlightUsd"], .55)
        self.assertFalse(r["mayDispatch"])

    def test_anchor_retires_only_closed_not_live(self):
        old = {"new": ledger(known=.1, unknown=.7)}
        current = {"new": ledger(known=.15, unknown=.8, reserved=.2, inflight=1)}
        r = guard.admission_exposure(16, 16, current, old)
        self.assertAlmostEqual(r["admissionExposureUsd"], 16.35)

    def test_rollback_refused(self):
        with self.assertRaises(ValueError): guard.admission_exposure(16, 16, {"a": ledger(known=.1)}, {"a": ledger(known=.2)})

    def test_anchored_ledger_cannot_disappear(self):
        with self.assertRaises(ValueError): guard.admission_exposure(16, 16, {}, {"a": ledger()})

    def test_stop_is_strict(self):
        self.assertFalse(guard.admission_exposure(19.5, 19.5, {}, {})["mayDispatch"])

    def test_invalid_exposure_refused(self):
        for value in [float("nan"), float("inf"), -1, True]:
            with self.subTest(value=value), self.assertRaises(ValueError): guard.admission_exposure(value, 16, {}, {})


class SettlementTests(unittest.TestCase):
    def observations(self):
        return [{"observedAt": f"2026-10-11T17:00:{i:02d}Z", "cumulative": {"promptTokens": 100, "generatedTokens": 200}} for i in range(8)]

    def test_eight_distinct_after_cleanup(self):
        self.assertTrue(core.stable_eight(self.observations(), "2026-10-11T16:59:59Z", {"promptTokens": 100, "generatedTokens": 200}))

    def test_old_settlement_cannot_credit_new_cleanup(self):
        with self.assertRaises(ValueError): core.stable_eight(self.observations(), "2026-10-11T17:01:00Z", {"promptTokens": 100, "generatedTokens": 200})

    def test_duplicate_poll_cannot_settle(self):
        rows = self.observations(); rows[-1] = rows[-2]
        with self.assertRaises(ValueError): core.stable_eight(rows, "2026-10-11T16:59:59Z", rows[0]["cumulative"])

    def test_delayed_azure_increment_breaks_settlement(self):
        rows = self.observations(); rows[-1]["cumulative"] = {"promptTokens": 101, "generatedTokens": 200}
        with self.assertRaises(ValueError): core.stable_eight(rows, "2026-10-11T16:59:59Z", rows[-1]["cumulative"])

    def test_new_live_slot_blocks_anchor_even_with_stable_metrics(self):
        with patch.object(guard, "fresh_metric", return_value=(Path("unused"), {}, {}, {})), patch.object(guard, "ledger_snapshots", return_value={"a": ledger(reserved=.25, inflight=1)}):
            with self.assertRaisesRegex(ValueError, "New live reservations"):
                guard.capture_anchor({"context": "/unused"}, "/unused", "2026-10-11T17:00:00Z")

    def test_original_orphan_slots_preserved(self):
        root = Path(__file__).resolve().parent.parent
        receipt = core.read_json(root / "ORIGINAL-CLEANUP-RECONCILIATION.json")
        raw = Path(receipt["originalCheckpoint"]["path"]).read_bytes()
        self.assertEqual(core.sha(receipt["originalCheckpoint"]["path"]), receipt["originalCheckpoint"]["sha256"])
        x = core.response_ledger_values(json.loads(raw))
        self.assertEqual(x["inFlightCalls"], 5); self.assertEqual(x["reservedUsd"], 1.268992)


class LedgerAndFreshnessTests(unittest.TestCase):
    def registration(self, root):
        return {"context": str(root), "dispatchBlocks": [{"out": str(root / "live-outputs" / f"b{i}")} for i in range(40)]}

    def test_canonical_copies_never_own_accounting(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "canonical-outputs/a").mkdir(parents=True)
            (root / "canonical-outputs/a/spend-checkpoint.json").write_text("bad copy")
            self.assertEqual(guard.ledger_snapshots(self.registration(root)), {})

    def test_unregistered_ledger_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "live-outputs/foreign").mkdir(parents=True)
            (root / "live-outputs/foreign/paid.json").write_text("{}")
            with self.assertRaises(ValueError): guard.ledger_snapshots(self.registration(root))

    def test_missing_started_accounting_is_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "live-outputs/b0").mkdir(parents=True)
            (root / "live-outputs/b0/run.json").write_text("{}")
            with self.assertRaises(ValueError): guard.ledger_snapshots(self.registration(root))

    def test_missing_never_started_blocks_not_charged(self):
        with tempfile.TemporaryDirectory() as tmp: self.assertEqual(guard.ledger_snapshots(self.registration(Path(tmp))), {})

    def test_full_completion_requires_every_ledger(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): guard.ledger_snapshots(self.registration(Path(tmp)), require_all=True)

    def test_freshness_identity_and_original_counters(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "metrics").mkdir()
            prereg = root / "p.json"; prereg.write_text("{}")
            original = {"cumulative": {"promptTokens": 100, "generatedTokens": 200}}
            old = root / "original.json"; old.write_text(json.dumps(original))
            identity = {"deployment": core.DEPLOYMENT, "filter": core.METRIC_FILTER, "windowStart": "2026-10-10T00:00:00Z", "resource": "resource"}
            baseline = {**identity, **original, "job": "test", "preregistrationSha256": core.sha(prereg), "originalBaselineSha256": core.sha(old)}
            path = root / "metrics/baseline.json"; path.write_text(json.dumps(baseline))
            latest = {**identity, "job": "test", "metricReadable": True, "baselineSha256": core.sha(path), "realCapUsd": 20, "stopAtUsd": 19.5,
                      "observedAt": core.utc_now(), "cumulative": {"promptTokens": 100 + 7728530, "generatedTokens": 200}}
            r = {"context": str(root), "job": "test", "assets": {"originalBaseline": {"path": str(old), "sha256": core.sha(old)}}}
            newest = root / "metrics/latest.json"; newest.write_text(json.dumps(latest))
            self.assertAlmostEqual(guard.fresh_metric(r, prereg)[3]["usd"], core.CARRY_USD)
            latest["observedAt"] = (core.datetime.now(core.timezone.utc) - timedelta(seconds=151)).isoformat()
            newest.write_text(json.dumps(latest))
            with self.assertRaisesRegex(ValueError, "stale"): guard.fresh_metric(r, prereg)
            latest["observedAt"] = core.utc_now(); latest["cumulative"]["promptTokens"] = 101
            newest.write_text(json.dumps(latest))
            with self.assertRaisesRegex(ValueError, "carry"): guard.fresh_metric(r, prereg)


class ProtocolTests(unittest.TestCase):
    def controller(self):
        spec = importlib.util.spec_from_file_location("followup_controller", Path(__file__).with_name("eight-cell-controller.py"))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

    def test_partition_identity_is_full_fixed_order(self):
        r = {"context": "/tmp/followup", "cohorts": {"development": {"rowIds": [f"row{i}" for i in range(40)]}}}
        blocks = core.prospective_blocks(r)
        self.assertEqual(len(blocks), 40); self.assertEqual([b["rowIds"][0] for b in blocks], r["cohorts"]["development"]["rowIds"])
        self.assertEqual(len({b["out"] for b in blocks}), 40); self.assertTrue(all(b["n"] == 1 and b["rep"] == 2 and b["arm"] == "candidate" for b in blocks))

    def test_gate_and_grade_functions_unchanged(self):
        import inspect, original_bridge
        for name in ["validate_grades", "consensus_grades", "aggregate_grader", "aggregate_cohorts", "ready_gate"]:
            self.assertEqual(inspect.getsource(getattr(core, name)), inspect.getsource(getattr(original_bridge, name)))

    def test_no_source_config_or_prompt_changes_in_argv(self):
        spec = importlib.util.spec_from_file_location("followup_controller", Path(__file__).with_name("eight-cell-controller.py")); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        r = {"context": "/tmp/followup", "node": {"path": "/node"}, "builds": {"candidate": {"port": 3534, "worktree": "/tmp/build"}}, "cohorts": {"development": {"rowIds": [f"r{i}" for i in range(40)]}}, "assets": {}}
        r["dispatchBlocks"] = core.prospective_blocks(r)
        for b in r["dispatchBlocks"]:
            r["assets"][b["evalAsset"]] = {"path": f"/eval/{b['block']}"}
        for key in ["jevParked", "exclusions"]: r["assets"][key] = {"path": f"/eval/{key}"}
        args = module.cell_command(r, r["dispatchBlocks"][0])[2]
        for key, value in [("--concurrency", "3"), ("--scene-planner-limit-ms", "60000"), ("--model", "configured"), ("--production-strict-subjects", "maths"), ("--max-usd", "20")]:
            self.assertEqual(args[args.index(key)+1], value)
        self.assertNotIn("--resume", args); self.assertNotIn("--sample", args)

    def test_current_runtime_and_imported_receipts_hashes(self):
        draft = Path(__file__).with_name("preregistration.draft.json")
        if not draft.exists(): self.skipTest("Prepare draft first for actual hash validation")
        r = core.verify_preregistration(draft, check_builds=True)
        self.assertEqual(r["builds"]["candidate"]["lock"]["head"], "689338462ae3d6ee54c5049c3b285b592b6b738d")
        imports = core.verify_imported(r); self.assertEqual(len(imports["arms"]), 7); self.assertEqual(imports["outcomes"], 200)
        self.assertFalse(r["secondaryPlan"]["ready"]); self.assertFalse(r["policy"]["selectiveRetry"])

    def test_started_followup_cannot_resume_even_without_rows(self):
        module = self.controller()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "execution-start.json").write_text("{}")
            r = {"context": str(root)}
            with patch.object(module, "verify_preregistration", return_value=r), patch.object(module, "verify_imported", return_value={"outcomes": 200}), patch("sys.argv", ["controller", "--preregistration", str(root / "preregistration.json"), "--execute"]):
                with self.assertRaisesRegex(ValueError, "no resume/retry"): module.main()

    def test_existing_one_row_output_cannot_be_selected_or_reused(self):
        module = self.controller()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); output = root / "live-outputs/b1"; output.mkdir(parents=True)
            r = {"context": str(root), "dispatchBlocks": [{"out": str(output)}]}
            with patch.object(module, "verify_preregistration", return_value=r), patch.object(module, "verify_imported", return_value={"outcomes": 200}), patch("sys.argv", ["controller", "--preregistration", str(root / "preregistration.json"), "--execute"]):
                with self.assertRaisesRegex(ValueError, "no prefix reuse"): module.main()

    def test_draft_can_never_dispatch(self):
        module = self.controller()
        with patch.object(module, "verify_preregistration", return_value={"context": "/tmp/none"}), patch.object(module, "verify_imported", return_value={"outcomes": 200}), patch("sys.argv", ["controller", "--preregistration", "/tmp/preregistration.draft.json", "--execute"]):
            with self.assertRaisesRegex(ValueError, "never draft"): module.main()

    def test_missing_candidate_repeat_is_not_ready(self):
        seven = [{"cohort": c, "rep": rep, "arm": arm, "n": core.COHORTS[c]} for c in core.COHORTS for rep in [1, 2] for arm in ["main", "candidate"] if (c, rep, arm) != ("development", 2, "candidate")]
        with self.assertRaisesRegex(ValueError, "Incomplete"): core.validate_complete_cells(seven)

    def test_original_partition_omission_and_reorder_refused(self):
        draft = Path(__file__).with_name("preregistration.draft.json")
        if not draft.exists(): self.skipTest("Prepare draft first")
        actual = core.read_json(draft)
        for mode in ["omit", "reverse", "duplicate"]:
            r = copy.deepcopy(actual)
            if mode == "omit": r["dispatchBlocks"] = r["dispatchBlocks"][:-1]
            elif mode == "reverse": r["dispatchBlocks"].reverse()
            else: r["dispatchBlocks"][-1] = r["dispatchBlocks"][0]
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "partition"): core.verify_partition(r)


if __name__ == "__main__": unittest.main(verbosity=2)
