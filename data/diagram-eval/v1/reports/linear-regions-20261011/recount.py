"""Recount immutable figure verdicts; no model calls, image reads, or file writes."""

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


HERE = Path(__file__).resolve().parent


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    provenance = json.loads((HERE / "provenance.json").read_text())
    for item in provenance["files"]:
        digest = hashlib.sha256((HERE / item["file"]).read_bytes()).hexdigest()
        require(digest == item["sha256"], f"Changed evidence: {item['file']}")

    eval_path = HERE.parent.parent / "linear-regions-heldout-20261011.jsonl"
    require(hashlib.sha256(eval_path.read_bytes()).hexdigest() == provenance["evalSha256"], "Changed eval")
    rows = read_jsonl(eval_path)
    require(len(rows) == 40 and len({row["id"] for row in rows}) == 40, "Wrong eval denominator")
    require(all(row["figure_need"] == "required" for row in rows), "Wrong required denominator")
    metadata = {row["id"]: row for row in rows}
    outcomes = read_jsonl(HERE / "outcomes.jsonl")
    require(len(outcomes) == 160, "Wrong outcome denominator")
    summary = json.loads((HERE / "summary.json").read_text())
    families = {"nl": "number_line", "hp": "half_plane", "lpp": "feasible_region", "sys": "linear_system"}
    reports = {}
    gates = []

    for judge in ["a", "b", "c", "consensus"]:
        grades = read_jsonl(HERE / (f"first-{judge}.jsonl" if judge != "consensus" else "consensus.jsonl"))
        mapping = {grade["id"]: grade for grade in grades}
        require(len(mapping) == len(grades) == 98, f"Incomplete/duplicate grades: {judge}")
        arm_counts = defaultdict(Counter)
        family_counts = defaultdict(Counter)
        ask_counts = defaultdict(Counter)
        seen = set()
        for outcome in outcomes:
            key = (outcome["rep"], outcome["arm"])
            row_id = outcome["rowId"]
            require((key, row_id) not in seen, "Duplicate outcome")
            seen.add((key, row_id))
            require(row_id in metadata, "Unknown outcome row")
            require(outcome["error"] is None, "Recorded run error")
            strategy = outcome["strategy"]
            require(strategy["classifiedSubject"] == "maths" and strategy["strategy"] == "strict", "Non-strict maths outcome")
            verdict = mapping[outcome["cardId"]]["verdict"] if outcome["drawn"] else "empty_bad"
            require(verdict in {"right", "partial", "wrong", "empty_bad"}, "Unknown verdict")
            arm_counts[key][verdict] += 1
            arm_counts[key]["n"] += 1
            arm_counts[key]["drawn"] += int(outcome["drawn"])
            topic = metadata[row_id]["topic_id"].split("|")[-1]
            family = next(value for prefix, value in families.items() if topic.startswith(prefix))
            family_counts[key + (family,)][verdict] += 1
            ask_counts[key + (metadata[row_id]["ask_style"],)][verdict] += 1
        require(set(arm_counts) == {(rep, arm) for rep in [1, 2] for arm in ["main", "candidate"]}, "Wrong arms")
        for key, counts in arm_counts.items():
            require(counts["n"] == 40, "Incomplete arm")
            if judge in summary["graders"]:
                recorded = next(r for r in summary["graders"][judge] if r["rep"] == key[0])["arms"][key[1]]
                require(all(counts[field] == recorded[field] for field in ["n", "drawn", "right", "partial", "wrong", "empty_bad"]), f"Count mismatch: {judge}/{key}")
        passes = []
        for rep in [1, 2]:
            before, after = arm_counts[(rep, "main")], arm_counts[(rep, "candidate")]
            passes.append(after["right"] > before["right"] and after["wrong"] <= before["wrong"])
        if judge != "c":
            gates.extend(passes)
        reports[judge] = {
            "repeatPasses": passes,
            "arms": {f"r{rep}-{arm}": dict(counts) for (rep, arm), counts in arm_counts.items()},
            "families": {f"r{rep}-{arm}/{family}": dict(counts) for (rep, arm, family), counts in family_counts.items()},
            "askStyles": {f"r{rep}-{arm}/{style}": dict(counts) for (rep, arm, style), counts in ask_counts.items()},
        }
    require(all(gates) == summary["ready"], "Readiness mismatch")
    print(json.dumps({"allRowOutcomes": 160, "ready": all(gates), "reports": reports}, indent=2))


if __name__ == "__main__":
    main()
