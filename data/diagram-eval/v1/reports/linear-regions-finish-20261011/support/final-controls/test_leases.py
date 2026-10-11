"""Synthetic owned-process lease admission; zero model/network/image access."""
import copy
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
import measurement_core as core
import lease_guard as lease
import budget_guard as budget


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.prereg = self.root / "preregistration.json"; self.prereg.write_text("{}")
        self.block = {"label": "h3r8f-development-r2-candidate-b01", "block": 1, "cohort": "development", "rep": 2, "arm": "candidate", "n": 1,
                      "out": str(self.root / "live-outputs/b01"), "rowIds": ["r1"], "evalAsset": "row01"}
        self.registration = {"context": str(self.root), "dispatchBlocks": [self.block]}
        self.processes = {100: {"pid": 100, "ppid": 90, "pgid": 100, "started": "controller-start"},
                          200: {"pid": 200, "ppid": 100, "pgid": 200, "started": "tsx-start"},
                          201: {"pid": 201, "ppid": 200, "pgid": 200, "started": "node-start"},
                          202: {"pid": 202, "ppid": 200, "pgid": 200, "started": "other-node"}}
        self.start = {"preregistrationSha256": core.sha(self.prereg), "oneFullReplacementOnly": True, "controllerIdentity": self.processes[100], "controllerNonce": "controller-nonce"}
        core.write_once(self.root / "execution-start.json", self.start)
        self.directory = self.root / "leases" / self.block["label"]
        self.proposal = {"block": self.block, "preregistrationSha256": core.sha(self.prereg), "executionStart": lease.ref(self.root / "execution-start.json"),
                         "controllerIdentity": self.processes[100], "controllerNonce": "controller-nonce", "launchNonce": "launch-nonce"}
        core.write_once(self.directory / "proposal.json", self.proposal)
        self.proposal_ref = lease.ref(self.directory / "proposal.json")
        core.write_once(self.directory / "launch.json", {"proposal": self.proposal_ref, "launchIdentity": self.processes[200]})
        self.launch_ref = lease.ref(self.directory / "launch.json")
        core.write_once(self.directory / "binding.json", {"proposal": self.proposal_ref, "launch": self.launch_ref, "wrapperIdentity": self.processes[201]})
        self.pointer = {"state": "active", "updatedAt": core.utc_now(), "proposal": self.proposal_ref, "launch": self.launch_ref, "binding": lease.ref(self.directory / "binding.json")}
        self.update()
        self.checkpoint = Path(self.block["out"]) / "spend-checkpoint.json"
        self.patch = patch.object(lease, "process_identity", side_effect=lambda pid: self.processes.get(pid)); self.patch.start(); self.addCleanup(self.patch.stop)

    def update(self): core.atomic_json(self.root / "active-lease.json", self.pointer)
    def validate(self, pid=201, checkpoint=None, nonce="launch-nonce", prereg=None):
        with patch.object(lease.os, "getppid", return_value=pid):
            return lease.verify_request_lease(self.registration, prereg or self.prereg, checkpoint or self.checkpoint, pid, nonce)

    def test_bound_actual_node_pid_authorizes(self): self.assertEqual(self.validate()[2]["pid"], 201)

    def test_missing_lease_rejected(self):
        (self.root / "active-lease.json").unlink()
        with self.assertRaises((ValueError, FileNotFoundError)): self.validate()

    def test_wrong_block_output_rejected(self):
        with self.assertRaisesRegex(ValueError, "output mismatch"): self.validate(checkpoint=self.root / "foreign/spend-checkpoint.json")

    def test_foreign_actual_node_even_in_same_group_rejected(self):
        with self.assertRaisesRegex(ValueError, "another wrapper"): self.validate(pid=202)

    def test_missing_controller_rejected(self):
        del self.processes[100]
        with self.assertRaisesRegex(ValueError, "controller dead"): self.validate()

    def test_recycled_controller_identity_rejected(self):
        self.processes[100] = {**self.processes[100], "started": "recycled"}
        with self.assertRaisesRegex(ValueError, "controller dead"): self.validate()

    def test_dead_actual_node_rejected(self):
        del self.processes[201]
        with self.assertRaisesRegex(ValueError, "wrapper PID dead"): self.validate()

    def test_dead_tsx_launch_rejected(self):
        del self.processes[200]
        with self.assertRaisesRegex(ValueError, "launch PID dead"): self.validate()

    def test_wrong_nonce_rejected(self):
        with self.assertRaisesRegex(ValueError, "nonce identity"): self.validate(nonce="foreign")

    def test_stale_controller_heartbeat_rejected(self):
        self.pointer["updatedAt"] = (core.datetime.now(core.timezone.utc) - timedelta(seconds=91)).isoformat(); self.update()
        with self.assertRaisesRegex(ValueError, "heartbeat stale"): self.validate()

    def test_draft_cannot_authorize_actual_request(self):
        with self.assertRaisesRegex(ValueError, "final frozen"): self.validate(prereg=self.root / "preregistration.draft.json")

    def test_post_abort_and_post_complete_and_dispatch_stop_rejected(self):
        for name in ["whole-arm-abort.json", "all-arms-complete.json", "dispatch-stop.json"]:
            path = self.root / name; path.write_text("{}")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Terminal"): self.validate()
            path.unlink()

    def test_consumed_and_revoked_and_launching_cannot_dispatch(self):
        for state in ["consumed", "revoked", "launching"]:
            self.pointer["state"] = state; self.update()
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "wrong phase"): self.validate()

    def test_revocation_receipt_blocks_stale_active_pointer(self):
        (self.directory / "revocation.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "revoked lease"): self.validate()

    def test_changed_proposal_hash_rejected(self):
        (self.directory / "proposal.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "identity file changed"): self.validate()

    def test_changed_execution_hash_rejected(self):
        altered = {**self.start, "other": True}; core.atomic_json(self.root / "execution-start.json", altered)
        with self.assertRaisesRegex(ValueError, "execution|nonce"): self.validate()

    def test_changed_final_prereg_hash_rejected(self):
        self.prereg.write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, "execution-start"): self.validate()

    def test_duplicate_wrapper_binding_rejected(self):
        self.pointer["state"] = "launching"; self.update()
        with patch.object(lease.os, "getppid", return_value=201):
            with self.assertRaisesRegex(ValueError, "Duplicate simultaneous"):
                lease.bind_wrapper(self.registration, self.prereg, self.checkpoint, 201, "launch-nonce")

    def test_request_guard_parent_must_be_bound_node(self):
        with patch.object(lease.os, "getppid", return_value=202):
            with self.assertRaisesRegex(ValueError, "not called by bound wrapper"):
                lease.verify_request_lease(self.registration, self.prereg, self.checkpoint, 201, "launch-nonce")

    def test_actual_budget_admission_cannot_skip_pid_nonce(self):
        with self.assertRaisesRegex(ValueError, "wrapper PID/launch nonce"):
            budget.budget_checkpoint(self.registration, self.prereg, self.checkpoint)

    def test_actual_budget_admission_calls_lease_before_financial_check(self):
        with patch.object(lease, "verify_request_lease", side_effect=ValueError("missing lease")), patch.object(budget, "fresh_metric") as fresh:
            with self.assertRaisesRegex(ValueError, "missing lease"):
                budget.budget_checkpoint(self.registration, self.prereg, self.checkpoint, 201, "launch-nonce")
            fresh.assert_not_called()

    def test_create_lease_cannot_skip_prior_registered_block(self):
        core.atomic_json(self.root / "completed-blocks.json", {"blocks": []})
        second = {**self.block, "block": 2, "label": "b02"}; self.registration["dispatchBlocks"].append(second)
        with patch.object(lease.os, "getpid", return_value=100):
            with self.assertRaisesRegex(ValueError, "skip, duplicate or resume"):
                lease.create_lease(self.registration, self.prereg, second)

    def test_current_controller_process_identity_is_readable(self):
        self.patch.stop()
        identity = lease.process_identity(lease.os.getpid())
        self.assertEqual(identity["pid"], lease.os.getpid()); self.assertTrue(identity["started"])
        self.patch.start()


if __name__ == "__main__": unittest.main(verbosity=2)
