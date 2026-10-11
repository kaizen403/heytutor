"""All three complete independent first streams must freeze before consensus; no arm map reads."""
import argparse
from pathlib import Path
from measurement_core import *


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--packet", required=True)
    args = parser.parse_args(); packet = Path(args.packet).resolve(); frozen = read_json(packet / "freeze.json")
    require(sha(packet / "queue.jsonl") == frozen["queueSha256"], "Queue changed")
    queue = read_jsonl(packet / "queue.jsonl"); ids = {r["id"] for r in queue}; require(len(ids) == len(queue), "Duplicate card IDs")
    for card in queue: require(sha(card["cropped_png"]) == card["figureSha256"], "Graded image changed")
    inputs, grades = {}, {}
    for judge in ["a", "b", "c"]:
        path = packet / f"judge-{judge}-first-freeze.json"; metadata = read_json(path)
        require(metadata["gradeSchema"] == GRADE_SCHEMA and metadata["queueSha256"] == frozen["queueSha256"], "Wrong independent grade identity")
        require(sha(metadata["gradePath"]) == metadata["gradeSha256"], "Finished independent grade changed")
        require(sha(metadata["identityPath"]) == metadata["identitySha256"], "Independent grader identity changed")
        rows = read_jsonl(metadata["gradePath"]); validate_grades(rows, ids); grades[judge] = rows
        inputs[judge] = {"freezeSha256": sha(path), "gradePath": metadata["gradePath"], "gradeSha256": metadata["gradeSha256"], "agentIdentity": metadata["agentIdentity"]}
    require(len({record["agentIdentity"] for record in inputs.values()}) == 3, "Three independent fresh grader identities required")
    consensus = consensus_grades(grades["a"], grades["b"], grades["c"], ids)
    output = packet / "consensus"; output.mkdir(exist_ok=True)
    raw = ''.join(canonical(row) + '\n' for row in consensus).encode()
    write_once(output / "consensus-final.jsonl", raw)
    require(sha(packet / "queue.jsonl") == frozen["queueSha256"], "Queue changed during consensus")
    a, b = [{r["id"]: r for r in grades[j]} for j in ["a", "b"]]
    metadata = {"schema": "shaded-regions-consensus-freeze/v1", "gradeSchema": GRADE_SCHEMA, "queueSha256": frozen["queueSha256"],
                "count": len(ids), "firstInputs": inputs, "consensusSha256": sha(output / "consensus-final.jsonl"),
                "agreed": sum(a[id]["verdict"] == b[id]["verdict"] for id in ids),
                "discordant": sum(a[id]["verdict"] != b[id]["verdict"] for id in ids),
                "threeWayConservativeWrong": sum(row["threeWayConservativeWrong"] for row in consensus), "armMapsRead": False,
                "rule": "A/B agreement stands; complete blind C resolves disagreement; three different verdicts are wrong"}
    write_once(output / "consensus-freeze.json", metadata)
    print(canonical({"count": len(ids), "consensusSha256": metadata["consensusSha256"], "armMapsRead": False, "qualityUnblinded": False}))


if __name__ == "__main__": main()
