"""Cumulative original-job budget. No metrics queries or model calls."""
import argparse
import math
from measurement_core import *


def fresh_metric(registration, prereg_path):
    context = Path(registration["context"])
    baseline_path = context / "metrics/baseline.json"
    baseline, latest = read_json(baseline_path), read_json(context / "metrics/latest.json")
    original = read_json(registration["assets"]["originalBaseline"]["path"])
    require(baseline["job"] == registration["job"] and baseline["preregistrationSha256"] == sha(prereg_path) and
            baseline["originalBaselineSha256"] == registration["assets"]["originalBaseline"]["sha256"] and baseline["cumulative"] == original["cumulative"], "Wrong original-counter baseline")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(latest["observedAt"].replace("Z", "+00:00"))).total_seconds()
    require(latest.get("metricReadable") and -5 <= age <= 150 and latest.get("baselineSha256") == sha(baseline_path), "Metrics unreadable, stale or mismatched")
    require(latest.get("job") == registration["job"] and latest.get("realCapUsd") == 20.0 and latest.get("stopAtUsd") == 19.5, "Wrong cumulative metric identity/cap")
    delta = metric_delta(latest, baseline)
    require(delta["usd"] + 1e-9 >= CARRY_USD, "Original-job token counter fell below settled carry")
    return baseline_path, baseline, latest, delta


def ledger_snapshots(registration, require_all=False):
    context = Path(registration["context"])
    blocks = registration["dispatchBlocks"]
    expected = {Path(b["out"]).resolve() for b in blocks}
    require(len(blocks) == len(expected) == 40 and all(p.parent == (context / "live-outputs").resolve() for p in expected), "Invalid prospective accounting paths")
    for directory in (context / "live-outputs").glob("*"):
        require(not directory.is_dir() or directory.resolve() in expected or not any(p.is_file() for p in directory.rglob("*")), "Unregistered prospective paid evidence")
    result = {}
    for root in sorted(expected):
        path = root / "spend-checkpoint.json"
        if not path.exists():
            require(not require_all and not any(p.is_file() for p in root.rglob("*")), "Started block has missing accounting")
            continue
        result[str(path)] = {"sha256": sha(path), **response_ledger_values(read_json(path))}
    return result


def admission_exposure(metric_usd, anchor_usd, current, anchored):
    closed = reserved = 0.0
    require(set(anchored) <= set(current), "Anchored prospective ledger disappeared")
    for path, values in current.items():
        old = anchored.get(path, {"knownUsageUsd": 0, "unresolvedAllowanceUsd": 0})
        for key in ["knownUsageUsd", "unresolvedAllowanceUsd"]:
            require(values[key] + 1e-9 >= old[key], "Prospective ledger rolled back")
            closed += max(0, values[key] - old[key])
        reserved += values["reservedUsd"]
    require(all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x >= 0 for x in [metric_usd, anchor_usd, closed, reserved]), "Invalid cumulative budget exposure")
    total = max(metric_usd, CARRY_USD, anchor_usd + closed) + reserved
    return {"AzureEstimateUsd": metric_usd, "carryFloorUsd": CARRY_USD, "settledEarlierAzureUsd": anchor_usd,
            "unreconciledClosedUsageAndAllowanceUsd": closed, "reservedInFlightUsd": reserved,
            "admissionExposureUsd": total, "mayDispatch": total < 19.5 and total < 20.0}


def budget_checkpoint(registration, prereg_path, require_active=None, wrapper_pid=None, nonce=None):
    if require_active is not None:
        from lease_guard import verify_request_lease
        require(wrapper_pid is not None and nonce, "Actual request lacks wrapper PID/launch nonce")
        verify_request_lease(registration, prereg_path, require_active, wrapper_pid, nonce)
    baseline_path, baseline, latest, delta = fresh_metric(registration, prereg_path)
    context = Path(registration["context"])
    pointer = read_json(context / "metrics/budget-anchor.json")
    require(sha(pointer["path"]) == pointer["sha256"], "Cumulative budget anchor changed")
    anchor = read_json(pointer["path"])
    require(anchor["baselineSha256"] == sha(baseline_path) and anchor["preregistrationSha256"] == sha(prereg_path), "Wrong anchor identity")
    require(anchor["originalOrphanReconciliation"]["newPostCleanupEightObservations"] is True and anchor["originalOrphanReconciliation"]["cleanupSha256"] == ORIGINAL_CLEANUP_SHA, "Old orphan slots not freshly reconciled")
    current = ledger_snapshots(registration)
    if require_active is not None:
        active = current.get(str(Path(require_active).resolve()))
        require(active is not None and active["reservedUsd"] > 0 and active["inFlightCalls"] > 0, "Actual request has no individual reservation")
    risk = admission_exposure(delta["usd"], anchor["AzureEstimateUsd"], current, anchor["ledgers"])
    if any((context / name).exists() for name in ["whole-arm-abort.json", "all-arms-complete.json", "dispatch-stop.json"]): risk["mayDispatch"] = False
    return {"baselineSha256": sha(baseline_path), "latestSha256": sha(context / "metrics/latest.json"), "observedAt": latest["observedAt"],
            "anchorSha256": pointer["sha256"], **risk, "inFlightCalls": sum(v["inFlightCalls"] for v in current.values()), "realCapUsd": 20.0, "stopAtUsd": 19.5}


def capture_anchor(registration, prereg_path, quiescent_after=None):
    require(quiescent_after is not None, "Every follow-up anchor requires a post-cleanup cutoff")
    baseline_path, baseline, latest, delta = fresh_metric(registration, prereg_path)
    context = Path(registration["context"]); ledgers = ledger_snapshots(registration)
    require(all(v["reservedUsd"] == 0 and v["inFlightCalls"] == 0 for v in ledgers.values()), "New live reservations cannot be reconciled by stable metrics")
    cutoff = datetime.fromisoformat(quiescent_after.replace("Z", "+00:00"))
    observations = [x for x in read_jsonl(context / "metrics/history.jsonl") if datetime.fromisoformat(x["observedAt"].replace("Z", "+00:00")) >= cutoff][-8:]
    stable_eight(observations, quiescent_after, latest["cumulative"])
    require(observations[-1]["observedAt"] == latest["observedAt"] and all(o["baselineSha256"] == sha(baseline_path) for o in observations), "Wrong settled watch observations")
    existing = sorted((context / "metrics").glob("budget-anchor-[0-9]*.json"))
    if not existing:
        receipt = verify_cleanup_receipt(registration)
        supplemental = read_json(registration["assets"]["supplementalPidCheck"]["path"])
        node = read_json(registration["assets"]["ownedNodeAbsence"]["path"])
        require(not ledgers and cutoff >= max(datetime.fromisoformat(r["observedAt"].replace("Z", "+00:00")) for r in [receipt, supplemental, node]), "Initial orphan reconciliation must follow receipt/PID check and precede every new request")
        reconciliation = {"cleanupSha256": ORIGINAL_CLEANUP_SHA, "originalCheckpoint": receipt["originalCheckpoint"],
                          "newPostCleanupEightObservations": True, "observations": observations,
                          "slotsPreserved": 5, "reservedUsdPreserved": 1.268992, "creditedOnlyToCumulativeAzure": True}
    else:
        previous = read_json(existing[-1])
        reconciliation = previous["originalOrphanReconciliation"]
    path = context / "metrics" / f"budget-anchor-{len(existing):02d}.json"
    value = {"schema": "h3r8-followup-cumulative-anchor/v1", "at": utc_now(), "job": registration["job"], "baselineSha256": sha(baseline_path),
             "preregistrationSha256": sha(prereg_path), "AzureEstimateUsd": max(CARRY_USD, delta["usd"]), "ledgers": ledgers,
             "stableObservations": observations, "quiescentAfter": quiescent_after, "inFlightCalls": 0,
             "originalOrphanReconciliation": reconciliation, "ratesNotInvoice": True}
    write_once(path, value)
    atomic_json(context / "metrics/budget-anchor.json", {"path": str(path), "sha256": sha(path)})
    return {"path": str(path), "sha256": sha(path), "AzureEstimateUsd": value["AzureEstimateUsd"]}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--preregistration", required=True); p.add_argument("--capture-anchor", action="store_true")
    p.add_argument("--quiescent-after"); p.add_argument("--require-active")
    p.add_argument("--wrapper-pid", type=int); p.add_argument("--nonce")
    a = p.parse_args(); registration = verify_preregistration(a.preregistration, check_builds=False)
    print(canonical(capture_anchor(registration, a.preregistration, a.quiescent_after) if a.capture_anchor else budget_checkpoint(registration, a.preregistration, a.require_active, a.wrapper_pid, a.nonce)))


if __name__ == "__main__": main()
