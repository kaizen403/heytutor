#!/usr/bin/env python3
"""Recount the complete secondary first pair without local images or API calls."""
import hashlib
import json
from collections import Counter
from pathlib import Path


BASE = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(name):
    return json.loads((BASE / name).read_text())


def rows(name):
    return [json.loads(line) for line in (BASE / name).read_text().splitlines() if line.strip()]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = read("evidence-manifest.json")
    for name, expected in manifest["files"].items():
        require(sha(BASE / name) == expected, f"Changed evidence: {name}")
    eval_path = BASE.parent.parent / "linear-regions-heldout-20261011.jsonl"
    require(sha(eval_path) == manifest["evalSha256"], "Changed frozen evaluation")
    outcomes = rows("outcomes.jsonl")
    require(len(outcomes) == 80, "Complete first pair must have 80 rows")
    require({row["rep"] for row in outcomes} == {1}, "Second prefix cannot be graded")
    require(len({(row["arm"], row["rowId"]) for row in outcomes}) == 80, "Duplicate outcome")
    arm_rows = {arm: [row for row in outcomes if row["arm"] == arm] for arm in ("main", "candidate")}
    require(all(len(items) == 40 for items in arm_rows.values()), "Incomplete arm")
    require({row["rowId"] for row in arm_rows["main"]} == {row["rowId"] for row in arm_rows["candidate"]}, "Unpaired rows")
    require(all(row["figureNeed"] == "required" for row in outcomes), "Changed required denominator")
    card_ids = {row["cardId"] for row in outcomes if row["drawn"]}
    require(len(card_ids) == 75, "Wrong card denominator")
    grades = {}
    for judge in ("a", "b", "c", "consensus"):
        records = rows(f"grades-{judge}.jsonl")
        require(len(records) == len({row["id"] for row in records}) == 75, f"Duplicate/missing {judge} grade")
        require({row["id"] for row in records} == card_ids, f"Foreign {judge} grade")
        require(all(row["verdict"] in {"right", "partial", "wrong"} for row in records), "Invalid verdict")
        grades[judge] = {row["id"]: row for row in records}
    disputes = 0
    three_way = 0
    for card in card_ids:
        a, b, c = (grades[judge][card]["verdict"] for judge in ("a", "b", "c"))
        expected = a if a == b else c if c in {a, b} else "wrong"
        disputes += a != b
        three_way += a != b and c not in {a, b}
        require(grades["consensus"][card]["verdict"] == expected, "Changed consensus rule")
    require((disputes, three_way) == (3, 0), "Changed disagreement count")
    reference = rows("calibration-reference-grades.jsonl")
    require(len(reference) == len({row["id"] for row in reference}) == 24, "Changed calibration reference")
    gold = {row["id"]: row["verdict"] for row in reference}
    consistency = read("calibration-consistency.json")
    for judge in ("a", "b", "c"):
        records = rows(f"calibration-grades-{judge}.jsonl")
        require(len(records) == len({row["id"] for row in records}) == 24, "Incomplete calibration stream")
        require({row["id"] for row in records} == set(gold), "Foreign calibration grade")
        matched = sum(row["verdict"] == gold[row["id"]] for row in records)
        require(consistency["judges"][judge]["matched"] == matched == 24, "Wrong synthetic consistency count")
    result = read("results.json")
    require(result["primaryExperimentComplete"] is False and result["ready"] is False, "Incomplete primary cannot be ready")
    report = {}
    for judge in ("a", "b", "consensus"):
        counts = {}
        for arm, items in arm_rows.items():
            verdicts = Counter(grades[judge][row["cardId"]]["verdict"] if row["drawn"] else "empty_bad" for row in items)
            actual = {key: verdicts[key] for key in ("right", "partial", "wrong", "empty_bad")}
            actual.update(n=40, drawn=sum(row["drawn"] for row in items),
                          strict=sum(row["strategy"]["strategy"] == "strict" for row in items),
                          classifiedMaths=sum(row["strategy"]["classifiedSubject"] == "maths" for row in items),
                          runErrors=sum(bool(row["error"]) for row in items))
            saved = result["graders"][judge][0]["arms"][arm]
            require(all(saved[key] == value for key, value in actual.items()), f"Wrong {judge}/{arm} counts")
            counts[arm] = actual
        left, right = counts["main"], counts["candidate"]
        passed = right["right"] > left["right"] and right["wrong"] <= 1 and right["wrong"] <= left["wrong"] and right["empty_bad"] <= left["empty_bad"]
        require(result["graders"][judge][0]["pass"] == passed, "Wrong strengthened gate")
        report[judge] = {"arms": counts, "pass": passed}
    diagnostics = rows("rejection-diagnostics.jsonl")
    require(len(diagnostics) == 77 and len({(row["rep"], row["rowId"]) for row in diagnostics}) == 77, "Missing/duplicate diagnostic row")
    prefix = [row for row in diagnostics if row["rep"] == 2]
    require(len(prefix) == 37 and all(row["prefixUngraded"] for row in prefix), "Prefix identity changed")
    require(sum(bool(row["diagram"]["committed"]) for row in prefix) == 34, "Prefix structural count changed")
    print(json.dumps({"firstRepeatOnly": True, "primaryComplete": False, "ready": False,
                      "gradedOutcomes": 80, "uniqueCards": 75, "graders": report,
                      "secondPrefix": {"saved": 37, "drawn": 34, "requiredEmpty": 3, "graded": False}}, indent=2))


if __name__ == "__main__":
    main()
