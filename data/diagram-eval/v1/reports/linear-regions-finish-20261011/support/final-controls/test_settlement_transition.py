"""Synthetic controller/anchor transitions; no provider, network or question data."""
import contextlib
import copy
import importlib.util
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import budget_guard as guard
import measurement_core as core


def controller():
    spec = importlib.util.spec_from_file_location(
        "synthetic_settlement_controller", Path(__file__).with_name("eight-cell-controller.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def timestamp(value):
    return value.isoformat().replace("+00:00", "Z")


class SyntheticMetrics:
    """All accounting and receipts live in a new temporary directory."""

    def __init__(self, root, initial=True):
        self.root = root
        (root / "metrics").mkdir()
        self.prereg = root / "preregistration.json"
        self.prereg.write_text(json.dumps({"syntheticControlOnly": True, "job": "synthetic"}))
        self.cutoff_time = datetime.now(timezone.utc) - timedelta(seconds=80)
        self.cutoff = timestamp(self.cutoff_time)
        self.initial_counter = {"promptTokens": 100 + 7728530, "generatedTokens": 200}
        self.settled_counter = {**self.initial_counter, "promptTokens": self.initial_counter["promptTokens"] + 10}
        original = root / "synthetic-original-baseline.json"
        core.write_once(original, {"cumulative": {"promptTokens": 100, "generatedTokens": 200}})
        self.identity = {"deployment": core.DEPLOYMENT, "filter": core.METRIC_FILTER,
                         "windowStart": "2026-10-10T00:00:00Z", "resource": "synthetic-resource"}
        self.baseline_path = root / "metrics/baseline.json"
        core.write_once(self.baseline_path, {**self.identity, "job": "synthetic",
            "preregistrationSha256": core.sha(self.prereg), "originalBaselineSha256": core.sha(original),
            "cumulative": {"promptTokens": 100, "generatedTokens": 200}})
        receipt_time = timestamp(self.cutoff_time - timedelta(seconds=1))
        self.receipt = {"observedAt": receipt_time,
                        "originalCheckpoint": {"path": "synthetic-unused-checkpoint", "sha256": "0" * 64}}
        assets = {"originalBaseline": {"path": str(original), "sha256": core.sha(original)}}
        for key in ["supplementalPidCheck", "ownedNodeAbsence"]:
            path = root / f"synthetic-{key}.json"
            core.write_once(path, {"observedAt": receipt_time})
            assets[key] = {"path": str(path), "sha256": core.sha(path)}
        self.registration = {"context": str(root), "job": "synthetic", "assets": assets,
            "metrics": {"pollSeconds": 30}, "hangGuardSeconds": 21600,
            "dispatchBlocks": [{"out": str(root / "live-outputs" / f"synthetic-b{i:02d}")}
                               for i in range(40)]}
        # Eight older stable polls must contribute zero observations to a new cutoff.
        self.history = [self.observation(-8 + i, self.initial_counter) for i in range(8)]
        self.latest = self.snapshot(self.cutoff_time - timedelta(seconds=1), self.initial_counter)
        self.write_metrics()
        if not initial:
            self.seed_previous_anchor()

    def snapshot(self, observed, cumulative):
        return {**self.identity, "job": "synthetic", "metricReadable": True,
                "baselineSha256": core.sha(self.baseline_path), "realCapUsd": 20.0, "stopAtUsd": 19.5,
                "observedAt": timestamp(observed), "cumulative": copy.deepcopy(cumulative)}

    def observation(self, seconds, cumulative):
        return self.snapshot(self.cutoff_time + timedelta(seconds=seconds), cumulative)

    def write_metrics(self):
        core.atomic_json(self.root / "metrics/latest.json", self.latest)
        (self.root / "metrics/history.jsonl").write_text(
            "".join(core.canonical(row) + "\n" for row in self.history))

    def append(self, index):
        # Poll eight receives delayed usage; only polls 8..15 can settle it.
        counter = self.initial_counter if index < 8 else self.settled_counter
        self.latest = self.observation(index, counter)
        self.history.append(self.latest)
        self.write_metrics()

    def make_stable(self, counter=None):
        counter = self.settled_counter if counter is None else counter
        self.history.extend(self.observation(i, counter) for i in range(1, 9))
        self.latest = self.history[-1]
        self.write_metrics()

    def seed_previous_anchor(self):
        reconciliation = {"cleanupSha256": core.ORIGINAL_CLEANUP_SHA,
            "originalCheckpoint": self.receipt["originalCheckpoint"], "newPostCleanupEightObservations": True,
            "observations": copy.deepcopy(self.history), "slotsPreserved": 5,
            "reservedUsdPreserved": 1.268992, "creditedOnlyToCumulativeAzure": True}
        path = self.root / "metrics/budget-anchor-00.json"
        core.write_once(path, {"schema": "h3r8-followup-cumulative-anchor/v1", "job": "synthetic",
            "baselineSha256": core.sha(self.baseline_path), "preregistrationSha256": core.sha(self.prereg),
            "AzureEstimateUsd": core.CARRY_USD, "ledgers": {}, "stableObservations": copy.deepcopy(self.history),
            "quiescentAfter": self.history[0]["observedAt"], "inFlightCalls": 0,
            "originalOrphanReconciliation": reconciliation})
        core.atomic_json(self.root / "metrics/budget-anchor.json", {"path": str(path), "sha256": core.sha(path)})

    def add_live_reservation(self):
        path = Path(self.registration["dispatchBlocks"][0]["out"]) / "spend-checkpoint.json"
        path.parent.mkdir(parents=True)
        core.write_once(path, {"spendMode": "response_usage",
            "providerConfig": {"provider": "azure", "deployment": core.DEPLOYMENT},
            "knownUsageUsd": 0, "unresolvedAllowanceUsd": 0, "reservedUsd": .25,
            "inFlightCalls": 1, "unresolvedCalls": []})


class SettlementTransitionTests(unittest.TestCase):
    def setUp(self):
        self.module = controller()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(socket, "socket", side_effect=AssertionError("No synthetic network")))
        self.stack.enter_context(patch.object(urllib.request, "urlopen", side_effect=AssertionError("No synthetic API")))
        self.directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.now = 1000.0
        self.events = []
        self.sleep = Mock()
        self.stack.enter_context(patch.object(self.module.time, "monotonic", side_effect=lambda: self.now))
        self.stack.enter_context(patch.object(self.module.time, "sleep", self.sleep))

    def fixture(self, initial=True):
        fixture = SyntheticMetrics(Path(self.directory), initial)
        # Synthetic receipt provenance is isolated; capture/stability/accounting remain real.
        self.cleanup = self.stack.enter_context(patch.object(guard, "verify_cleanup_receipt", return_value=fixture.receipt))
        self.module.FOLLOWUP_DEADLINE = self.now + fixture.registration["hangGuardSeconds"]
        return fixture

    def settle(self, fixture):
        return self.module.settle_after_arm(fixture.registration, fixture.prereg, fixture.cutoff, self.events.append)

    def assert_transition(self, initial):
        fixture = self.fixture(initial)
        counter = 0

        def next_poll(seconds):
            nonlocal counter
            self.assertEqual(seconds, 30)
            self.now += seconds
            counter += 1
            fixture.append(counter)

        self.sleep.side_effect = next_poll
        result = self.settle(fixture)
        waits = [event["reason"] for event in self.events if event["event"] == "waiting_for_quiescent_settlement"]
        self.assertEqual(waits, ["Need eight distinct observations"] * 8 + ["Need eight stable post-cleanup observations"] * 7)
        self.assertEqual(self.sleep.call_count, 15)
        self.assertEqual(self.events[-1]["event"], "quiescent_block_settled")
        anchor = core.read_json(result["path"])
        rows = anchor["stableObservations"]
        self.assertEqual(len(rows), 8)
        self.assertEqual(len({row["observedAt"] for row in rows}), 8)
        self.assertEqual(rows, fixture.history[-8:])
        self.assertTrue(core.stable_eight(rows, fixture.cutoff, fixture.settled_counter))
        self.assertEqual(anchor["quiescentAfter"], fixture.cutoff)
        self.assertEqual(core.sha(result["path"]), result["sha256"])
        self.assertAlmostEqual(anchor["AzureEstimateUsd"], core.CARRY_USD + .000020)
        reconciliation = anchor["originalOrphanReconciliation"]
        self.assertTrue(reconciliation["newPostCleanupEightObservations"])
        self.assertEqual(reconciliation["slotsPreserved"], 5)
        self.assertEqual(reconciliation["reservedUsdPreserved"], 1.268992)
        if initial:
            self.cleanup.assert_called_once_with(fixture.registration)
            self.assertEqual(reconciliation["observations"], rows)
            self.assertEqual(Path(result["path"]).name, "budget-anchor-00.json")
        else:
            self.cleanup.assert_not_called()
            previous = core.read_json(fixture.root / "metrics/budget-anchor-00.json")
            self.assertEqual(reconciliation, previous["originalOrphanReconciliation"])
            self.assertEqual(Path(result["path"]).name, "budget-anchor-01.json")

    def test_initial_real_capture_waits_for_new_distinct_then_stable_polls(self):
        self.assert_transition(initial=True)

    def test_between_row_real_capture_waits_for_new_distinct_then_stable_polls(self):
        self.assert_transition(initial=False)

    def assert_immediately_fatal(self, fixture, message):
        with self.assertRaisesRegex(ValueError, message):
            self.settle(fixture)
        self.sleep.assert_not_called()
        self.assertEqual(self.events, [])
        self.assertFalse((fixture.root / "metrics/budget-anchor.json").exists())

    def test_live_reservation_is_fatal_even_with_eight_stable_polls(self):
        fixture = self.fixture()
        fixture.make_stable()
        fixture.add_live_reservation()
        self.assert_immediately_fatal(fixture, "New live reservations cannot be reconciled")

    def test_unreadable_metric_is_fatal(self):
        fixture = self.fixture()
        fixture.latest["metricReadable"] = False
        fixture.write_metrics()
        self.assert_immediately_fatal(fixture, "Metrics unreadable, stale or mismatched")

    def test_invalid_metric_cap_is_fatal(self):
        fixture = self.fixture()
        fixture.latest["realCapUsd"] = 21
        fixture.write_metrics()
        self.assert_immediately_fatal(fixture, "Wrong cumulative metric identity/cap")

    def test_invalid_counter_is_fatal(self):
        fixture = self.fixture()
        fixture.latest["cumulative"]["promptTokens"] = -1
        fixture.write_metrics()
        self.assert_immediately_fatal(fixture, "Invalid or negative metric counter")

    def test_settled_watch_provenance_mismatch_is_fatal(self):
        fixture = self.fixture()
        fixture.make_stable()
        fixture.history[8]["baselineSha256"] = "0" * 64
        fixture.write_metrics()
        self.assert_immediately_fatal(fixture, "Wrong settled watch observations")

    def test_admission_cap_still_stops_after_successful_settlement(self):
        fixture = self.fixture()
        fixture.make_stable({"promptTokens": 100 + 9750000, "generatedTokens": 200})
        self.settle(fixture)
        with self.assertRaisesRegex(ValueError, "Finite-budget admission exposure reached stop threshold"):
            self.module.metric_checkpoint(fixture.registration, fixture.prereg)
        self.sleep.assert_not_called()
        self.assertFalse(guard.budget_checkpoint(fixture.registration, fixture.prereg)["mayDispatch"])

    def test_terminal_marker_still_blocks_dispatch_after_settlement(self):
        fixture = self.fixture()
        fixture.make_stable()
        self.settle(fixture)
        core.write_once(fixture.root / "dispatch-stop.json", {"dispatchForbidden": True})
        with self.assertRaisesRegex(ValueError, "Finite-budget admission exposure reached stop threshold"):
            self.module.metric_checkpoint(fixture.registration, fixture.prereg)

    def test_obsolete_and_unrecognized_errors_are_immediately_fatal(self):
        fixture = self.fixture()
        for reason in ["Need eight distinct post-quiescence observations", "Azure tokens not settled for eight observations",
                       "Latest snapshot not in settled observations", "Lease is released, consumed, revoked or wrong phase"]:
            with self.subTest(reason=reason), patch.object(self.module, "capture_anchor", side_effect=ValueError(reason)):
                self.assert_immediately_fatal(fixture, reason)

    def test_settlement_still_expires_at_900_seconds(self):
        fixture = self.fixture()
        self.sleep.side_effect = lambda seconds: setattr(self, "now", self.now + 900)
        with self.assertRaisesRegex(ValueError, "Between-block Azure settlement timeout; no next-block dispatch"):
            self.settle(fixture)
        self.sleep.assert_called_once_with(30)
        self.assertEqual(len(self.events), 1)
        self.assertFalse((fixture.root / "metrics/budget-anchor.json").exists())

    def test_full_replacement_still_expires_at_21600_seconds(self):
        fixture = self.fixture()
        self.assertEqual(self.module.FOLLOWUP_DEADLINE - self.now, 21600)
        self.sleep.side_effect = lambda seconds: setattr(self, "now", self.now + 21600)
        with self.assertRaisesRegex(ValueError, "Full replacement logical-arm deadline exhausted"):
            self.settle(fixture)
        self.sleep.assert_called_once_with(30)
        self.assertFalse((fixture.root / "metrics/budget-anchor.json").exists())


class AbsolutePreregistrationIntegrationTests(unittest.TestCase):
    def test_actual_main_propagates_absolute_argument_into_child_private_cwd(self):
        module = controller()
        real_popen = subprocess.Popen
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            root = Path(temporary).resolve()
            fixture = SyntheticMetrics(root)
            private_cwd = root / "private-cwd"
            private_cwd.mkdir()
            worktree = root / "synthetic-worktree"
            child_cwd = worktree / "apps/tutor"
            child_cwd.mkdir(parents=True)
            audit = root / "synthetic-child-path-audit.json"
            block = {**fixture.registration["dispatchBlocks"][0], "arm": "candidate", "rep": 2,
                     "cohort": "development", "block": 1, "label": "synthetic-b00", "evalAsset": "syntheticEval"}
            registration = {**fixture.registration, "dispatchBlocks": [block], "order": [block],
                "node": {"path": sys.executable},
                "builds": {arm: {"worktree": str(worktree), "port": 1, "lock": {"head": "synthetic"}}
                           for arm in ["main", "candidate"]}}
            for name in ["syntheticEval", "jevParked", "exclusions"]:
                registration["assets"][name] = {"path": str(root / f"unused-{name}.json")}
            server = Mock(pid=0)
            server.poll.return_value = None
            server_log = io.StringIO()
            captured = []
            child_code = "\n".join([
                "import json, os", "from pathlib import Path",
                "p = Path(os.environ['H3R8_PREREGISTRATION'])",
                "assert p.is_absolute()",
                "r = json.loads(p.read_text())",
                "Path(os.environ['H3R8_SYNTHETIC_AUDIT']).write_text(json.dumps({'preregistration': str(p), 'cwd': str(Path.cwd()), 'job': r['job']}))",
            ])

            def synthetic_child(command, **options):
                captured.append({"command": command, "cwd": options["cwd"], "env": options["env"].copy()})
                # The real controlled-run argv is intercepted; this child only reads synthetic JSON.
                return real_popen([sys.executable, "-c", child_code], **options)

            def synthetic_binding(reg, cell, pid):
                binding = root / "leases" / cell["label"] / "binding.json"
                binding.parent.mkdir(parents=True)
                core.write_once(binding, {"syntheticBinding": True, "pid": pid})

            terminate_owned = module.terminate_owned
            stack.enter_context(patch.object(socket, "socket", side_effect=AssertionError("No synthetic network")))
            stack.enter_context(patch.object(urllib.request, "urlopen", side_effect=AssertionError("No synthetic API")))
            stack.enter_context(patch.object(module, "verify_preregistration", return_value=registration))
            stack.enter_context(patch.object(module, "verify_imported", return_value={"outcomes": 200, "arms": []}))
            stack.enter_context(patch.object(module, "verify_cleanup_receipt", return_value=fixture.receipt))
            stack.enter_context(patch.object(module, "metric_checkpoint", return_value={"mayDispatch": True}))
            stack.enter_context(patch.object(module, "budget_checkpoint", return_value={"mayDispatch": True}))
            stack.enter_context(patch.object(module, "start_server", return_value=(server, server_log)))
            stack.enter_context(patch.object(module, "terminate_owned", side_effect=lambda p: None if p is server else terminate_owned(p)))
            stack.enter_context(patch.object(module, "settle_after_arm", return_value={"syntheticAnchor": True}))
            stack.enter_context(patch.object(module, "freeze_block", return_value={"receipt": {"sha256": "0" * 64}}))
            stack.enter_context(patch.object(module, "verify_block_records", return_value=True))
            stack.enter_context(patch.object(module, "canonicalize_cell", return_value={"syntheticCell": True}))
            stack.enter_context(patch.object(module, "verify_completed_evidence", return_value=True))
            stack.enter_context(patch.object(module, "launch_environment", return_value={
                "PATH": os.defpath, "H3R8_SYNTHETIC_AUDIT": str(audit)}))
            stack.enter_context(patch.object(module.lease_guard, "process_identity", return_value={"pid": os.getpid()}))
            stack.enter_context(patch.object(module.lease_guard, "create_lease", return_value={"launchNonce": "synthetic"}))
            stack.enter_context(patch.object(module.lease_guard, "publish_launch", side_effect=synthetic_binding))
            stack.enter_context(patch.object(module.lease_guard, "activate_lease", return_value=True))
            stack.enter_context(patch.object(module.lease_guard, "heartbeat", return_value=True))
            stack.enter_context(patch.object(module.lease_guard, "revoke", return_value=True))
            stack.enter_context(patch.object(module.subprocess, "Popen", side_effect=synthetic_child))
            stack.enter_context(patch.object(sys, "argv", ["controller", "--preregistration", str(fixture.prereg.resolve()), "--execute"]))
            original_cwd = Path.cwd()
            try:
                os.chdir(private_cwd)
                with contextlib.redirect_stdout(io.StringIO()):
                    module.main()
            finally:
                os.chdir(original_cwd)
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0]["env"]["H3R8_PREREGISTRATION"], str(fixture.prereg.resolve()))
            self.assertEqual(captured[0]["cwd"], child_cwd)
            self.assertIn(str(root / "controlled-run.ts"), captured[0]["command"])
            self.assertEqual(core.read_json(audit), {"preregistration": str(fixture.prereg.resolve()),
                                                   "cwd": str(child_cwd), "job": "synthetic"})
            self.assertTrue((root / "all-arms-complete.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
