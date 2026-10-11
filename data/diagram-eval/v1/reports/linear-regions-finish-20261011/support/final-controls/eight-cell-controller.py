"""One prospective full replacement development repeat in forty fixed one-row blocks; no retry."""
import argparse
import os
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from measurement_core import *
from budget_guard import budget_checkpoint, capture_anchor
from canonical_evidence import canonicalize_cell, freeze_block, verify_completed_evidence
import lease_guard
import secrets

FOLLOWUP_DEADLINE = None


def port_free(port):
    with socket.socket() as probe: return probe.connect_ex(("127.0.0.1", port)) != 0


def terminate_owned(process):
    if process is None or process.poll() is not None: return
    os.killpg(process.pid, signal.SIGTERM)
    try: process.wait(timeout=10)
    except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)


def metric_checkpoint(registration, prereg_path):
    result = budget_checkpoint(registration, prereg_path)
    require(result["mayDispatch"], "Finite-budget admission exposure reached stop threshold")
    return result


def settle_after_arm(registration, prereg_path, after, event):
    end = time.monotonic() + 900
    while True:
        require(FOLLOWUP_DEADLINE is None or time.monotonic() < FOLLOWUP_DEADLINE, "Full replacement logical-arm deadline exhausted")
        try:
            result = capture_anchor(registration, prereg_path, after)
            event({"event": "quiescent_block_settled", **result}); return result
        except ValueError as error:
            require(str(error) in ["Need eight distinct observations", "Need eight stable post-cleanup observations"], str(error))
            require(time.monotonic() < end, "Between-block Azure settlement timeout; no next-block dispatch")
            event({"event": "waiting_for_quiescent_settlement", "reason": str(error)})
            time.sleep(registration["metrics"]["pollSeconds"])


def start_server(registration, arm, label, env, event):
    spec = registration["builds"][arm]; wt = Path(spec["worktree"])
    require(port_free(spec["port"]), "Owned benchmark port is occupied; leave other processes alone")
    handle = (Path(registration["context"]) / "runs" / f"{label}-server.log").open("x")
    server = subprocess.Popen([registration["node"]["path"], str((wt / "apps/tutor/node_modules/next/dist/bin/next").resolve()),
        "dev", "--hostname", "127.0.0.1", "--port", str(spec["port"])], cwd=wt / "apps/tutor", env=env,
        stdout=handle, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    end = time.monotonic() + 60; ready = False
    while time.monotonic() < end and server.poll() is None:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{spec['port']}/api/chat", timeout=3) as reply: ready = reply.status == 405
        except urllib.error.HTTPError as error: ready = error.code == 405
        except (urllib.error.URLError, TimeoutError, OSError): pass
        if ready: break
        time.sleep(0.25)
    if not ready:
        event({"event": "server_warmup_failed", "label": label, "pid": server.pid, "serverExit": server.poll()})
        terminate_owned(server); handle.close(); raise ValueError("Nonpaid server warmup failed")
    event({"event": "server_warmed", "label": label, "pid": server.pid, "port": spec["port"]})
    return server, handle


def cell_command(registration, cell):
    """Pure argv/location construction, shared by actual launch and nonpaid tests."""
    arm, rep, cohort = cell["arm"], cell["rep"], cell["cohort"]
    require(cell in registration["dispatchBlocks"], "Only preregistered complete fixed blocks may dispatch")
    context = Path(registration["context"]); spec = registration["builds"][arm]; wt = Path(spec["worktree"])
    label = cell["label"]; out = Path(cell["out"])
    command = [registration["node"]["path"], str((wt / "apps/tutor/node_modules/tsx/dist/cli.mjs").resolve()), str(context / "controlled-run.ts"),
        "--eval", registration["assets"][cell["evalAsset"]]["path"], "--arm", "planner_examples_strict", "--production-strict-subjects", "maths",
        "--model", "configured", "--figure-only", "--scene-planner-limit-ms", "60000", "--concurrency", "3",
        "--spend-mode", "response_usage", "--max-usd", "20", "--yes", "--scene-decline-policy", "unchanged",
        "--narration", "english", "--familiarity", "normal", "--visual-need-replay", registration["assets"]["jevParked"]["path"],
        "--example-exclusions", registration["assets"]["exclusions"]["path"], "--origin", f"http://127.0.0.1:{spec['port']}", "--out", str(out)]
    return label, out, command


def abort_protocol(registration, cell, error, event):
    stop_path = Path(registration["context"]) / "dispatch-stop.json"
    if not stop_path.exists(): write_once(stop_path, {"at": utc_now(), "reason": "terminal protocol abort", "dispatchForbidden": True})
    try: lease_guard.revoke(registration, "terminal protocol abort", success=False)
    except Exception as lease_error: event({"event": "lease_revocation_failed_terminally", "errorType": type(lease_error).__name__})
    event({"event": "whole_arm_abort", **cell, "errorType": type(error).__name__, "reason": str(error),
        "ungradedAllPartialBlocks": True, "incurredSpendRetained": True})
    write_once(Path(registration["context"]) / "whole-arm-abort.json", {"at": utc_now(), **cell,
        "reason": str(error), "sourceTuning": False, "selectiveRetry": False, "allPartialBlocksUngraded": True})


def execute_block(registration, prereg, cell, env, event):
    context = Path(registration["context"]); run_dir = context / "runs"
    arm = cell["arm"]; spec = registration["builds"][arm]; wt = Path(spec["worktree"])
    label, out, command = cell_command(registration, cell)
    server, server_log, lab = None, None, None
    start = last_progress = time.monotonic(); previous_count = 0
    block_success = False
    try:
        try:
            verify_preregistration(prereg); before_metrics = metric_checkpoint(registration, prereg)
            server, server_log = start_server(registration, arm, label, env, event)
            verify_preregistration(prereg); metric_checkpoint(registration, prereg)
            proposal = lease_guard.create_lease(registration, prereg, cell)
            arm_env = {**env, "H3R8_PREREGISTRATION": str(prereg), "H3R8_ROUND_LABEL": label, "H3R8_ARM": arm,
                "H3R8_COHORT": cell["cohort"], "H3R8_BLOCK": str(cell["block"]), "H3R8_LAUNCH_NONCE": proposal["launchNonce"]}
            event({"event": "block_start", **{k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, "label": label, "head": spec["lock"]["head"], "beforeMetrics": before_metrics})
            with (run_dir / f"{label}.log").open("x") as log:
                lab = subprocess.Popen(command, cwd=wt / "apps/tutor", env=arm_env, stdout=log, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL, start_new_session=True)
                lease_guard.publish_launch(registration, cell, lab.pid)
                binding = context / "leases" / label / "binding.json"
                binding_end = time.monotonic() + 15
                while not binding.exists():
                    require(lab.poll() is None and time.monotonic() < binding_end, "Owned wrapper binding did not arrive")
                    time.sleep(0.01)
                lease_guard.activate_lease(registration, prereg, cell)
                while lab.poll() is None:
                    lease_guard.heartbeat(registration)
                    require(FOLLOWUP_DEADLINE is None or time.monotonic() < FOLLOWUP_DEADLINE, "Full replacement logical-arm deadline exhausted")
                    count = len(list((out / "runs").glob("*.json")))
                    if count > previous_count: previous_count = count; last_progress = time.monotonic()
                    metadata = {"event": "block_heartbeat", **{k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, "savedRows": count, "labPid": lab.pid, "serverPid": server.pid,
                                "serverExit": server.poll(), "armSeconds": time.monotonic() - start, "noProgressSeconds": time.monotonic() - last_progress}
                    event(metadata); print(canonical(metadata), flush=True)
                    require(server.poll() is None, "Owned server exited during arm")
                    metric_checkpoint(registration, prereg)
                    require(metadata["armSeconds"] <= CONTROLS["armAbortSeconds"] and metadata["noProgressSeconds"] <= CONTROLS["noProgressAbortSeconds"], "Metadata watchdog expired")
                    try: lab.wait(timeout=30)
                    except subprocess.TimeoutExpired: pass
            records = [read_json(p) for p in (out / "runs").glob("*.json")]
            require(lab.returncode == 0, "Whole-block transport/budget failure")
            verify_block_records(records, cell)
            verify_preregistration(prereg); after_metrics = budget_checkpoint(registration, prereg)
            event({"event": "block_rows_complete", **{k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, "records": len(records), "beforeMetrics": before_metrics, "afterMetrics": after_metrics})
            block_success = True
        finally:
            # Revoke before killing either owned group, never after a terminal
            # marker or cleanup. Every subsequent actual fetch fails closed.
            lease_error = None
            try: lease_guard.revoke(registration, "completed block" if block_success else "block cleanup", success=block_success)
            except Exception as error:
                lease_error = error
                write_once(context / "dispatch-stop.json", {"at": utc_now(), "reason": "lease revocation failure", "dispatchForbidden": True})
            event({"event": "pre_cleanup_server_state", **{k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, "serverPid": server.pid if server else None,
                   "serverExit": server.poll() if server else None, "labExit": lab.poll() if lab else None})
            terminate_owned(lab); terminate_owned(server)
            if server_log: server_log.close()
            if lease_error is not None: raise lease_error
        # Every fixed block, including the eighth, settles after owned cleanup.
        anchor = settle_after_arm(registration, prereg, utc_now(), event)
        item = freeze_block(registration, prereg, cell, anchor)
        event({"event": "block_complete", **{k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, "receiptSha256": item["receipt"]["sha256"]})
        return item
    except Exception as error:
        abort_protocol(registration, {k: cell[k] for k in ["cohort", "rep", "arm", "block"]}, error, event)
        raise


def main():
    global FOLLOWUP_DEADLINE
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True); p.add_argument("--execute", action="store_true")
    a = p.parse_args(); registration = verify_preregistration(a.preregistration)
    imports = verify_imported(registration); context = Path(registration["context"])
    if not a.execute:
        commands = [cell_command(registration, b)[2] for b in registration["dispatchBlocks"]]
        print(canonical({"readyForReview": True, "physicalBlocks": len(commands), "replacementRows": 40, "importedOutcomes": imports["outcomes"],
                         "configuredConcurrency": 3, "effectiveRowsPerDispatch": 1, "carryFloorUsd": CARRY_USD,
                         "runtimeCommit": registration["builds"]["candidate"]["lock"]["head"], "modelCalls": 0, "metricQueries": 0})); return
    require(Path(a.preregistration).name == "preregistration.json", "Paid dispatch requires final frozen protocol, never draft")
    require(not (context / "execution-start.json").exists() and not (context / "canonical-outputs").exists(), "Follow-up already started; no resume/retry/replacement")
    for block in registration["dispatchBlocks"]: require(not Path(block["out"]).exists(), "Prospective output already exists; no prefix reuse")
    (context / "runs").mkdir(exist_ok=True); (context / "live-outputs").mkdir(exist_ok=True)
    event = lambda value: append_event(context / "paid-events.jsonl", {"at": utc_now(), **value})
    write_once(context / "execution-start.json", {"at": utc_now(), "preregistrationSha256": sha(a.preregistration), "oneFullReplacementOnly": True,
                                                "controllerIdentity": lease_guard.process_identity(os.getpid()), "controllerNonce": secrets.token_hex(32),
                                                "originalProtocolStatus": "incomplete_not_ready", "allOldFailedSpendCharged": True})
    FOLLOWUP_DEADLINE = time.monotonic() + registration["hangGuardSeconds"]
    completed = list(imports["arms"]); physical = []
    atomic_json(context / "completed-arms.json", {"preregistrationSha256": sha(a.preregistration), "arms": completed})
    atomic_json(context / "completed-blocks.json", {"preregistrationSha256": sha(a.preregistration), "blocks": physical})
    env = launch_environment(registration["builds"]["main"]["worktree"], os.environ)
    cell = registration["order"][0]
    try:
        cleanup = verify_cleanup_receipt(registration)
        supplemental = read_json(registration["assets"]["supplementalPidCheck"]["path"])
        node = read_json(registration["assets"]["ownedNodeAbsence"]["path"])
        cutoff = max(cleanup["observedAt"], supplemental["observedAt"], node["observedAt"])
        settle_after_arm(registration, a.preregistration, cutoff, event)
        metric_checkpoint(registration, a.preregistration)
        for block in registration["dispatchBlocks"]:
            entry = execute_block(registration, a.preregistration, block, env, event)
            physical.append(entry)
            atomic_json(context / "completed-blocks.json", {"preregistrationSha256": sha(a.preregistration), "blocks": physical})
        completed.append(canonicalize_cell(registration, a.preregistration, cell, physical))
        atomic_json(context / "completed-arms.json", {"preregistrationSha256": sha(a.preregistration), "arms": completed})
        verify_completed_evidence(registration, a.preregistration, completed, physical)
        write_once(context / "all-arms-complete.json", {"at": utc_now(), "preregistrationSha256": sha(a.preregistration), "completedSha256": sha(context / "completed-arms.json"),
            "completedBlocksSha256": sha(context / "completed-blocks.json"), "physicalDispatchBlocks": 40, "outcomes": 240,
            "newModelOutcomes": 160, "reusedMainOutcomes": 80, "thisFollowupPaidOutcomes": 40, "importedOutcomes": 200,
            "originalProtocolStatus": "incomplete_not_ready", "abortedPrefixExcluded": True, "rootImageViews": 0, "qualityBlinded": True})
        event({"event": "all_unified_cells_complete", "outcomes": 240, "replacementRows": 40})
    except Exception as error:
        if not (context / "whole-arm-abort.json").exists(): abort_protocol(registration, cell, error, event)
        raise


if __name__ == "__main__": main()
