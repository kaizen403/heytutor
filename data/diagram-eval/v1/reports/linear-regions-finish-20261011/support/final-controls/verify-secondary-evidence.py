#!/usr/bin/env python3
"""Prove the prospectively fixed seven-cell secondary scope after an operational abort."""
import argparse
from pathlib import Path
import sys
from measurement_core import COHORTS, require, sha, read_json, verify_preregistration, verify_imported

MISSING_CELL = {"cohort": "development", "rep": 2, "arm": "candidate"}
SECONDARY_SCOPE = {"schema": "secondary-report-only/v1", "missingCell": MISSING_CELL,
                   "trigger": "operational-incomplete-replacement-before-quality",
                   "prefixesGraded": False, "ready": False}


def verify_secondary_evidence(preregistration):
    registration = verify_preregistration(preregistration, check_builds=False)
    context = Path(registration["context"])
    require(not (context / "all-arms-complete.json").exists(), "Completed replacement cannot use secondary scope")
    abort_path = context / "whole-arm-abort.json"
    abort = read_json(abort_path)
    require({k: abort.get(k) for k in MISSING_CELL} == MISSING_CELL, "Wrong operationally aborted cell")
    require(abort.get("sourceTuning") is False and abort.get("selectiveRetry") is False
            and abort.get("allPartialBlocksUngraded") is True, "Abort/source/prefix policy changed")
    require(isinstance(abort.get("reason"), str) and abort["reason"].strip(), "Missing operational abort reason")
    plan = registration["secondaryPlan"]
    imported = verify_imported(registration)
    expected = {(c, r, a) for c in COHORTS for r in (1, 2) for a in ("main", "candidate")}
    expected.remove(("development", 2, "candidate"))
    actual = [(a["cohort"], a["rep"], a["arm"]) for a in imported["arms"]]
    require(len(actual) == len(set(actual)) == 7 and set(actual) == expected, "Missing/duplicate/foreign imported logical cell")
    require(imported["outcomes"] == 200 and plan["schema"] == "secondary-report-only/v1"
            and plan["outcomes"] == 200 and plan["logicalCells"] == 7 and plan["missingCell"] == MISSING_CELL
            and plan["onlyIfFollowupAborts"] is True and plan["excludeAllOldAndNewAbortedPrefixes"] is True
            and plan["qualitySelection"] is False and plan["ready"] is False and plan["prEligible"] is False,
            "Secondary report-only scope changed")
    require(plan["cells"] == [{k: a[k] for k in ("cohort", "rep", "arm")} for a in imported["arms"]],
            "Prospectively registered imported cell order changed")
    require(sum(COHORTS[a["cohort"]] for a in imported["arms"]) == 200, "Wrong full-cell denominator")
    return registration, imported, {"path": str(abort_path), "sha256": sha(abort_path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preregistration", required=True)
    args = parser.parse_args()
    registration, imported, abort = verify_secondary_evidence(args.preregistration)
    print(__import__("json").dumps({"schema": "secondary-report-only-evidence/v1", "outcomes": 200,
          "logicalCells": 7, "missingCell": MISSING_CELL, "ready": False, "prEligible": False,
          "prefixesGraded": False, "operationalAbort": abort, "qualityUnblinded": False}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Secondary evidence rejected: {error}", file=sys.stderr)
        sys.exit(1)
