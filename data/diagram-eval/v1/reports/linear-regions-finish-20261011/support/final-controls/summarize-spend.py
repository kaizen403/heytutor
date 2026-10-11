"""Original-job cumulative Azure and response ledgers, including both aborts."""
import argparse
from measurement_core import *
from budget_guard import ledger_snapshots


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True); p.add_argument("--out", required=True)
    a = p.parse_args(); r = verify_preregistration(a.preregistration, check_builds=False); context = Path(r["context"])
    baseline_path = context / "metrics/baseline.json"; baseline = read_json(baseline_path)
    final_path = context / "metrics/final-settlement.json"; final = read_json(final_path)
    require(final["baselineSha256"] == sha(baseline_path) and final["job"] == r["job"], "Wrong cumulative settlement")
    whole_job = metric_delta(final["finalSnapshot"], baseline)
    require(whole_job["usd"] >= CARRY_USD, "Cumulative spend lost original carry")
    original = read_json(r["assets"]["originalSpend"]["path"])
    snapshots = ledger_snapshots(r, require_all=(context / "all-arms-complete.json").exists())
    ledgers = [{"path": path, **values} for path, values in snapshots.items()]
    result = {"schema": "h3r8-prospective-cumulative-spend/v1", "preregistrationSha256": sha(a.preregistration), "job": r["job"],
              "originalProtocolStatus": "incomplete_not_ready", "originalSpend": r["assets"]["originalSpend"], "originalSettlement": r["assets"]["originalSettlement"],
              "followupSettlement": {"path": str(final_path), "sha256": sha(final_path)}, "carryFloorUsd": CARRY_USD,
              "AzureTokenEstimate": whole_job, "postOriginalSettlementAzureUsd": whole_job["usd"] - CARRY_USD,
              "realCapUsd": 20, "stopAtUsd": 19.5, "hardIncrementWithinBudget": whole_job["usd"] <= 20,
              "previousJobInformationalUsd": 25.35188, "cumulativeIncludingPreviousJobUsd": 25.35188 + whole_job["usd"],
              "originalResponseUsage": original["responseUsage"], "newResponseLedgers": ledgers,
              "newResponseKnownUsd": sum(v["knownUsageUsd"] for v in snapshots.values()),
              "newResponseUnresolvedAllowanceUsd": sum(v["unresolvedAllowanceUsd"] for v in snapshots.values()),
              "newCheckpointReservedUsd": sum(v["reservedUsd"] for v in snapshots.values()),
              "newCheckpointInFlightCalls": sum(v["inFlightCalls"] for v in snapshots.values()),
              "originalFiveOrphanedSlotsPreserved": True, "allFailedPrefixSpendCharged": True, "canonicalCopiesCountedForSpend": False,
              "note": "Deployment and response estimates overlap and are never summed. Original job15.457060 is a floor, not a new budget. Every later exclusive-deployment token counts against same20cap, including late old completions. Orphaned checkpoint slots remain unchanged. Tokens/rates estimate, not invoice; native agent billing unexposed."}
    write_once(a.out, result)
    print(canonical({"out": str(Path(a.out).resolve()), "jobAzureEstimateUsd": whole_job["usd"], "afterOldSettlementUsd": whole_job["usd"] - CARRY_USD,
                     "within20": result["hardIncrementWithinBudget"], "newLedgers": len(ledgers)}))


if __name__ == "__main__": main()
