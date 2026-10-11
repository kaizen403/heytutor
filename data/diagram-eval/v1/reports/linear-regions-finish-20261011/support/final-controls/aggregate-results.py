"""Parent-only unblinding after complete source-frozen arms and immutable first/consensus grades."""
import argparse
from pathlib import Path
from measurement_core import *


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preregistration", required=True); parser.add_argument("--packet", required=True); parser.add_argument("--out", required=True)
    args = parser.parse_args(); registration = verify_preregistration(args.preregistration, check_builds=False); packet = Path(args.packet).resolve()
    frozen = read_json(packet / "freeze.json"); require(frozen["preregistrationSha256"] == sha(args.preregistration), "Foreign packet")
    require(frozen["cohorts"] == COHORTS and frozen["outcomes"] == registration["totalOutcomes"], "Wrong denominator")
    require(sha(packet / "queue.jsonl") == frozen["queueSha256"] and sha(packet / "parent/outcomes.jsonl") == frozen["outcomesSha256"], "Frozen packet changed")
    require(sha(packet / "parent/rejection-diagnostics.jsonl") == frozen["rejectionDiagnosticsSha256"], "Detailed rejection evidence changed")
    queue = read_jsonl(packet / "queue.jsonl"); ids = {r["id"] for r in queue}; require(len(ids) == len(queue), "Duplicate card IDs")
    for card in queue: require(sha(card["cropped_png"]) == card["figureSha256"], "Graded image changed")
    consensus_freeze = read_json(packet / "consensus/consensus-freeze.json")
    require(consensus_freeze["queueSha256"] == frozen["queueSha256"] and consensus_freeze["count"] == len(ids), "Wrong consensus identity")
    require(sha(packet / "consensus/consensus-final.jsonl") == consensus_freeze["consensusSha256"], "Consensus changed")
    grades = {}
    for judge in ["a", "b", "c"]:
        freeze_path = packet / f"judge-{judge}-first-freeze.json"; first = read_json(freeze_path)
        require(sha(freeze_path) == consensus_freeze["firstInputs"][judge]["freezeSha256"] and sha(first["gradePath"]) == first["gradeSha256"], "First stream changed")
        require(sha(first["identityPath"]) == first["identitySha256"], "Grader identity metadata changed")
        rows = read_jsonl(first["gradePath"]); validate_grades(rows, ids)
        if judge in ["a", "b"]: grades[judge] = {r["id"]: r for r in rows}
    consensus = read_jsonl(packet / "consensus/consensus-final.jsonl")
    require(len(consensus) == len(ids) and {r["id"] for r in consensus} == ids, "Incomplete consensus")
    grades["consensus"] = {r["id"]: r for r in consensus}
    outcomes = read_jsonl(packet / "parent/outcomes.jsonl")
    require({r["cardId"] for r in outcomes if r["drawn"]} == ids, "Drawn outcome-card identity mismatch")
    for row in outcomes: require(sha(row["runPath"]) == row["runSha256"], "Original measured record changed")
    reports = {judge: aggregate_cohorts(outcomes, mapping) for judge, mapping in grades.items()}
    result = {"schema": "shaded-regions-results/v1", "preregistrationSha256": sha(args.preregistration), "nPerCohortArm": COHORTS,
              "allRowOutcomes": len(outcomes), "noClassificationFiltering": True, "graders": reports, "ready": ready_gate(reports),
              "consensusFreeze": consensus_freeze, "criterion": registration["readinessRule"], "noPoolingFailedRepeat": True,
              "rootImageViews": 0, "limitation": "Figure-only blind model judgments; no human-gold, full lecture, persistence/replay or syllabus acceptance claim"}
    result.update({"newModelOutcomes": 160, "reusedMainOutcomes": 80,
                   "repeatedDevelopmentRows": True, "freshHeldoutClaim": True, "freshHeldoutOutcomes": 80, "repeatedDevelopmentOutcomes": 160,
                   "baselineReuseSha256": registration["assets"]["mainReuse"]["sha256"]})
    write_once(args.out, result)
    print(canonical({"out": str(Path(args.out).resolve()), "sha256": sha(args.out), "ready": result["ready"], "allRowOutcomes": len(outcomes)}))


if __name__ == "__main__": main()
