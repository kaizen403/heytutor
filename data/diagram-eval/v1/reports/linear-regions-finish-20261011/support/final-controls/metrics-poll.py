"""Fresh exclusive-deployment accounting, no model calls. Root starts after final freeze."""
import argparse
import fcntl
import subprocess
import time
from pathlib import Path
from datetime import datetime, timezone
from measurement_core import *
from budget_guard import budget_checkpoint


def observe(spec, job):
    now = utc_now()
    result = subprocess.run(["az", "monitor", "metrics", "list", "--resource", spec["resource"],
        "--metric", "ProcessedPromptTokens", "GeneratedTokens", "--filter", METRIC_FILTER,
        "--interval", "PT1H", "--aggregation", "Total", "--start-time", spec["windowStart"], "--end-time", now, "-o", "json"],
        capture_output=True, text=True, timeout=30)
    require(result.returncode == 0, "Azure Monitor query failed; preserve error code without credential output")
    totals, buckets = azure_metric_totals(json.loads(result.stdout))
    return {"job": job, "deployment": DEPLOYMENT, "filter": METRIC_FILTER, "resource": spec["resource"], "windowStart": spec["windowStart"],
            "observedAt": now, "metricReadable": True, "cumulative": {"promptTokens": totals["ProcessedPromptTokens"], "generatedTokens": totals["GeneratedTokens"]},
            "realCapUsd": 20.0, "stopAtUsd": 19.5, "stopRequired": False, "rates": {"inputPerMillion": 2, "outputPerMillion": 10}, "buckets": buckets}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--preregistration", required=True)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--watch", action="store_true"); modes.add_argument("--settle", action="store_true"); parser.set_defaults(capture_baseline=False)
    parser.add_argument("--confirm-exclusive", action="store_true"); parser.add_argument("--once", action="store_true")
    args = parser.parse_args(); registration = verify_preregistration(args.preregistration, check_builds=args.capture_baseline)
    spec = registration["metrics"]; context = Path(registration["context"]); directory = context / "metrics"; directory.mkdir(exist_ok=True)
    baseline_path = directory / "baseline.json"; history = directory / "history.jsonl"; latest_path = directory / "latest.json"
    if args.capture_baseline:
        require(args.confirm_exclusive, "Capture requires an explicit exclusive-deployment ownership assertion")
        require(not baseline_path.exists(), "Fresh baseline already exists; never overwrite prior spend")
        require(not args.once, "Fresh baseline requires eight stable observations, not --once")
    else:
        require(baseline_path.exists(), "Fresh job baseline missing")
        baseline = read_json(baseline_path); require(baseline["job"] == registration["job"], "Foreign/old job baseline")
        require(baseline["preregistrationSha256"] == sha(args.preregistration), "Baseline belongs to a different preregistration")
    if args.settle:
        # The owned watch process remains the single Azure/query/latest/history writer.
        # Settlement consumes eight distinct fresh watch observations, avoiding competing .tmp writes.
        stable = 0; previous = None; last_observed = None; observations = []
        while True:
            current = read_json(latest_path)
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(current["observedAt"].replace("Z", "+00:00"))).total_seconds()
            require(current.get("metricReadable") and -5 <= age <= 150 and current.get("baselineSha256") == sha(baseline_path), "Settlement needs the fresh owned watcher")
            require(current.get("job") == registration["job"], "Foreign settlement observation")
            metric_delta(current, baseline)
            if current["observedAt"] != last_observed:
                counters = current["cumulative"]; stable = stable + 1 if counters == previous else 1
                previous = counters; last_observed = current["observedAt"]
                observations.append({"observedAt": last_observed, "cumulative": counters, "stableCount": stable})
                print(canonical({"settlementObservedAt": last_observed, "AzureEstimateUsd": current["attributable"]["usd"], "stableCount": stable}), flush=True)
            if stable >= spec["stableObservations"]:
                write_once(directory / "final-settlement.json", {"job": registration["job"], "baselineSha256": sha(baseline_path),
                    "finalSnapshot": current, "stableObservations": observations[-spec["stableObservations"]:]}); return
            require(not args.once, "Settlement is not complete after one observation")
            time.sleep(spec["pollSeconds"])
    writer_lock = (directory / ".writer.lock").open("a")
    try: fcntl.flock(writer_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise ValueError("Another owned metrics writer is active; do not run competing pollers")
    stable = 0; previous = None; observations = []
    while True:
        try:
            current = observe(spec, registration["job"])
            counters = current["cumulative"]
            stable = stable + 1 if counters == previous else 1; previous = counters
            observations.append({"observedAt": current["observedAt"], "cumulative": counters, "stableCount": stable})
            if args.capture_baseline:
                append_event(directory / "pre-baseline-observations.jsonl", observations[-1])
                if stable >= spec["stableObservations"]:
                    baseline = {**current, "preregistrationSha256": sha(args.preregistration), "exclusiveOwnershipAsserted": True,
                                "stableObservations": observations[-spec["stableObservations"]:]}
                    write_once(baseline_path, baseline)
                    current.update({"baselineSha256": sha(baseline_path), "attributable": metric_delta(current, baseline)})
                    atomic_json(latest_path, current)
                    print(canonical({"event": "fresh_baseline_frozen", "observedAt": current["observedAt"], "baselineSha256": sha(baseline_path), "newJobUsd": 0})); return
            else:
                current.update({"baselineSha256": sha(baseline_path), "attributable": metric_delta(current, baseline)})
                atomic_json(latest_path, current)
                risk = budget_checkpoint(registration, args.preregistration) if (directory / "budget-anchor.json").exists() else {"mayDispatch": False, "admissionExposureUsd": max(CARRY_USD, current["attributable"]["usd"]) + 1.268992, "reservedInFlightUsd": 1.268992, "anchorSha256": None}
                current.update({"stopRequired": not risk["mayDispatch"], "admissionExposureUsd": risk["admissionExposureUsd"],
                                "reservedInFlightUsd": risk["reservedInFlightUsd"], "anchorSha256": risk["anchorSha256"]})
                atomic_json(latest_path, current)
                append_event(history, {k: current[k] for k in ["observedAt", "cumulative", "attributable", "baselineSha256"]})
                print(canonical({"observedAt": current["observedAt"], "AzureEstimateUsd": current["attributable"]["usd"], "stableCount": stable}), flush=True)
        except Exception as error:
            if not args.capture_baseline: atomic_json(latest_path, {"job": registration["job"], "deployment": DEPLOYMENT, "observedAt": utc_now(), "metricReadable": False, "realCapUsd": 20.0, "stopAtUsd": 19.5, "stopRequired": True, "errorType": type(error).__name__})
            print(canonical({"event": "metric_read_failed", "errorType": type(error).__name__}), flush=True)
            stable = 0; previous = None
            if args.once: raise
        if args.once: return
        time.sleep(spec["pollSeconds"])


if __name__ == "__main__": main()
