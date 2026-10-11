#!/usr/bin/env python3
"""Parent-only seven-cell report; all three first freezes precede quality reads; never PR ready."""
import argparse
from collections import Counter
import importlib.util
from pathlib import Path
import sys
from measurement_core import (COHORTS, GRADE_SCHEMA, GRADE_ARRAYS, canonical, require, sha, read_json,
                              read_jsonl, validate_grades, consensus_grades, write_once)

spec = importlib.util.spec_from_file_location("secondary_evidence", Path(__file__).with_name("verify-secondary-evidence.py"))
secondary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secondary)


def arm_counts(rows, grades, n):
    require(len(rows) == len({r["rowId"] for r in rows}) == n, "Incomplete/duplicate secondary cell")
    require(all(r["figureNeed"] == "required" and type(r["drawn"]) is bool for r in rows), "Changed required denominator")
    mapped = {r["rowId"]: {**r, "verdict": grades[r["cardId"]]["verdict"] if r["drawn"] else "empty_bad"} for r in rows}
    c = Counter(r["verdict"] for r in mapped.values())
    drawn = sum(r["drawn"] for r in rows)
    counts = {"n": n, "drawn": drawn, **{k: c[k] for k in ("right", "partial", "wrong", "empty_bad", "empty_ok")},
              "strict": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("strategy") == "strict" for r in rows),
              "classifiedMaths": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("classifiedSubject") == "maths" for r in rows),
              "runErrors": sum(bool(r.get("error").strip()) if isinstance(r.get("error"), str) else bool(r.get("error")) for r in rows),
              "omissionDenominatorDrawn": drawn, "requiredVisualDenominator": n, "correctRequiredVisuals": c["right"],
              "tierCounts": dict(Counter(r.get("tier") if isinstance(r.get("tier"), str) and r["tier"].strip() else "none" for r in rows)),
              "sourceCounts": dict(Counter(r.get("source") if isinstance(r.get("source"), str) and r["source"].strip() else "none" for r in rows)),
              "omissionRows": {k: sum(bool(grades[r["cardId"]][k]) for r in rows if r["drawn"]) for k in GRADE_ARRAYS}}
    require(sum(c.values()) == n, "Lost secondary denominator")
    return counts, mapped


def aggregate_secondary(outcomes, grades, registration):
    require(len(outcomes) == len({(r["cohort"], r["rep"], r["arm"], r["rowId"]) for r in outcomes}) == 200,
            "Incomplete/duplicate secondary outcomes")
    expected = {(c, r, a) for c in COHORTS for r in (1, 2) for a in ("main", "candidate")}
    expected.remove(("development", 2, "candidate"))
    require({(r["cohort"], r["rep"], r["arm"]) for r in outcomes} == expected, "Extra aborted prefix or missing imported cell")
    result = []
    for cohort, n in COHORTS.items():
        expected_ids = registration["cohorts"][cohort]["rowIds"]
        require(len(expected_ids) == len(set(expected_ids)) == n, "Wrong frozen secondary cohort")
        for rep in (1, 2):
            counts, maps = {}, {}
            for arm in ("main", "candidate"):
                if (cohort, rep, arm) == ("development", 2, "candidate"):
                    counts[arm] = None
                    continue
                rows = [r for r in outcomes if (r["cohort"], r["rep"], r["arm"]) == (cohort, rep, arm)]
                require({r["rowId"] for r in rows} == set(expected_ids), "Secondary cell row IDs changed")
                counts[arm], maps[arm] = arm_counts(rows, grades, n)
            left, right = counts["main"], counts["candidate"]
            if right is None:
                result.append({"cohort": cohort, "rep": rep, "arms": counts, "rightDelta": None, "wrongDelta": None,
                               "requiredEmptyDelta": None, "wrongNearZero": None, "pass": None,
                               "pairedTransitions": None, "newlyWrong": None})
                continue
            rd, wd, ed = right["right"] - left["right"], right["wrong"] - left["wrong"], right["empty_bad"] - left["empty_bad"]
            transitions = Counter(f"{maps['main'][row]['verdict']}->{maps['candidate'][row]['verdict']}" for row in sorted(expected_ids))
            wrong = [{"rowId": row, "mainVerdict": maps["main"][row]["verdict"], "candidateCardId": maps["candidate"][row]["cardId"],
                      "reason": grades[maps["candidate"][row]["cardId"]]["reason"]}
                     for row in sorted(expected_ids) if maps["candidate"][row]["verdict"] == "wrong" and maps["main"][row]["verdict"] != "wrong"]
            result.append({"cohort": cohort, "rep": rep, "arms": counts, "rightDelta": rd, "wrongDelta": wd,
                           "requiredEmptyDelta": ed, "wrongNearZero": right["wrong"] <= 1,
                           "pass": rd > 0 and wd <= 0 and right["wrong"] <= 1 and ed <= 2,
                           "pairedTransitions": dict(sorted(transitions.items())), "newlyWrong": wrong})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preregistration", required=True)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--all-first-streams-frozen", action="store_true", required=True)
    args = parser.parse_args()
    registration, imported, abort = secondary.verify_secondary_evidence(args.preregistration)
    packet = Path(args.packet).resolve()
    frozen = read_json(packet / "freeze.json")
    require(frozen["preregistrationSha256"] == sha(args.preregistration) and frozen["cohorts"] == COHORTS and frozen["outcomes"] == 200,
            "Foreign secondary packet/denominator")
    require(frozen.get("manifestMode") == "secondary200" and frozen.get("secondaryReportOnly") is True
            and frozen.get("readinessEligible") is False and frozen.get("missingCell") == secondary.MISSING_CELL
            and frozen.get("originalProtocolStatus") == "incomplete_not_ready",
            "Wrong secondary eligibility")
    for rel, key in (("queue.jsonl", "queueSha256"), ("parent/outcomes.jsonl", "outcomesSha256"),
                     ("parent/rejection-diagnostics.jsonl", "rejectionDiagnosticsSha256"), ("parent/image-map.jsonl", "imageMapSha256")):
        require(sha(packet / rel) == frozen[key], "Changed secondary packet evidence")
    firsts = {j: read_json(packet / f"judge-{j}-first-freeze.json") for j in ("a", "b", "c")}
    for first in firsts.values():
        require(first["gradeSchema"] == GRADE_SCHEMA and first["queueSha256"] == frozen["queueSha256"], "Foreign first stream")
        require(sha(first["gradePath"]) == first["gradeSha256"] and sha(first["identityPath"]) == first["identitySha256"], "First stream/identity changed")
    require(len({r["agentIdentity"] for r in firsts.values()}) == 3, "Three independent first identities required")
    queue = read_jsonl(packet / "queue.jsonl")
    ids = {r["id"] for r in queue}
    require(len(ids) == len(queue), "Duplicate queue ID")
    for card in queue:
        require(sha(card["cropped_png"]) == card["figureSha256"], "Graded crop changed")
    # All three immutable first-freeze bindings are established before grade content reads.
    raw = {j: read_jsonl(firsts[j]["gradePath"]) for j in ("a", "b", "c")}
    for rows in raw.values():
        validate_grades(rows, ids)
    expected_consensus = consensus_grades(raw["a"], raw["b"], raw["c"], ids)
    consensus_freeze = read_json(packet / "consensus/consensus-freeze.json")
    require(consensus_freeze["schema"] == "shaded-regions-consensus-freeze/v1" and consensus_freeze["gradeSchema"] == GRADE_SCHEMA
            and consensus_freeze["queueSha256"] == frozen["queueSha256"] and consensus_freeze["count"] == len(ids)
            and sha(packet / "consensus/consensus-final.jsonl") == consensus_freeze["consensusSha256"], "Consensus evidence changed")
    maps = {j: {r["id"]: r for r in raw[j]} for j in ("a", "b", "c")}
    agreed = sum(maps["a"][card]["verdict"] == maps["b"][card]["verdict"] for card in ids)
    require(set(consensus_freeze["firstInputs"]) == {"a", "b", "c"}
            and consensus_freeze["agreed"] == agreed and consensus_freeze["discordant"] == len(ids) - agreed
            and consensus_freeze["threeWayConservativeWrong"] == sum(r["threeWayConservativeWrong"] for r in expected_consensus)
            and consensus_freeze["armMapsRead"] is False
            and consensus_freeze["rule"] == "A/B agreement stands; complete blind C resolves disagreement; three different verdicts are wrong",
            "Changed consensus counts/authority")
    for j, first in firsts.items():
        require(consensus_freeze["firstInputs"][j] == {"freezeSha256": sha(packet / f"judge-{j}-first-freeze.json"),
                "gradePath": first["gradePath"], "gradeSha256": first["gradeSha256"], "agentIdentity": first["agentIdentity"]},
                "Consensus first binding changed")
    actual = read_jsonl(packet / "consensus/consensus-final.jsonl")
    require(sorted(actual, key=lambda r: r["id"]) == expected_consensus, "Forged consensus")
    outcomes = read_jsonl(packet / "parent/outcomes.jsonl")
    require({r["cardId"] for r in outcomes if r["drawn"]} == ids, "Secondary drawn-card identity mismatch")
    for row in outcomes:
        require(sha(row["runPath"]) == row["runSha256"], "Original recorded outcome changed")
    mappings = {j: {r["id"]: r for r in raw[j]} for j in ("a", "b")}
    mappings["consensus"] = {r["id"]: r for r in expected_consensus}
    reports = {j: aggregate_secondary(outcomes, grades, registration) for j, grades in mappings.items()}
    result = {"schema": "secondary-report-only/v1", "preregistrationSha256": sha(args.preregistration),
              "nPerCohortArm": COHORTS, "allRowOutcomes": 200, "noClassificationFiltering": True,
              "graders": reports, "ready": False, "prEligible": False, "missingDevelopmentCandidateRepeat2": None,
              "secondaryScope": secondary.SECONDARY_SCOPE, "consensusFreeze": consensus_freeze,
              "criterion": registration["readinessRule"], "noPoolingFailedRepeat": True, "rootImageViews": 0,
              "newModelOutcomes": 120, "reusedMainOutcomes": 80, "freshHeldoutOutcomes": 80,
              "repeatedDevelopmentOutcomes": 120, "originalProtocolStatus": "incomplete_not_ready",
              "operationalAbort": abort, "oldAndNewAbortedPrefixesGraded": False,
              "limitation": "Secondary seven-cell report after operational abort; no primary readiness or matched original protocol claim"}
    write_once(args.out, result)
    print(canonical({"out": str(Path(args.out).resolve()), "sha256": sha(args.out), "allRowOutcomes": 200,
                     "ready": False, "prEligible": False, "missingDevelopmentCandidateRepeat2": None}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Secondary aggregation rejected: {error}", file=sys.stderr)
        sys.exit(1)
