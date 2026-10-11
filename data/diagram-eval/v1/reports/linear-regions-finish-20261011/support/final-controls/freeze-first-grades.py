"""Freeze raw first grades and image identity; emit metadata only, never quality."""
import argparse
from pathlib import Path
from measurement_core import *


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True); parser.add_argument("--judge", choices=["a", "b", "c"], required=True)
    parser.add_argument("--grade", required=True); parser.add_argument("--sha256", required=True); parser.add_argument("--recoveries", type=int, default=0)
    parser.add_argument("--identity", required=True, help="Root-authored source-naive grader identity/calibration metadata JSON")
    args = parser.parse_args(); packet = Path(args.packet).resolve(); grade = Path(args.grade).resolve()
    freeze = read_json(packet / "freeze.json"); queue = read_jsonl(packet / "queue.jsonl")
    require(sha(packet / "queue.jsonl") == freeze["queueSha256"], "Frozen queue changed")
    require(freeze["gradeSchema"] == GRADE_SCHEMA and len(queue) == freeze["cards"], "Wrong schema/card metadata")
    ids = {r["id"] for r in queue}; require(len(ids) == len(queue), "Duplicate queue ID")
    for card in queue: require(sha(card["cropped_png"]) == card["figureSha256"], "Frozen image bytes changed")
    require(sha(grade) == args.sha256, "First grade hash mismatch")
    validate_grades(read_jsonl(grade), ids); require(args.recoveries >= 0, "Invalid recovery count")
    identity_path = Path(args.identity).resolve(); identity = read_json(identity_path)
    require(identity.get("judge") == args.judge and identity.get("sourceNaive") is True and identity.get("agentIdentity"), "Missing source-naive independent judge identity")
    require(identity.get("referenceConsistencyReportedAs") == "consistency, not human accuracy", "Calibration attribution missing")
    calibration_binding = None
    if freeze.get("schema") == "shaded-regions-opaque-packet/v1":
        require(identity.get("noQualityFeedbackBeforeFinalFreeze") is True, "No-feedback calibration attestation missing")
        binding = identity.get("calibration", {})
        calibration_packet = Path(binding.get("packetPath", "missing-calibration")).resolve()
        calibration_freeze = calibration_packet / "freeze.json"
        require(calibration_freeze.is_file() and sha(calibration_freeze) == binding.get("packetFreezeSha256"), "Final judge has no frozen calibration packet")
        calibration = read_json(calibration_freeze)
        require(calibration.get("schema") == "shaded-regions-synthetic-calibration-packet/v1" and calibration.get("cards") == 24, "Wrong complete calibration reference identity")
        calibration_first = calibration_packet / f"judge-{args.judge}-first-freeze.json"
        require(calibration_first.is_file() and sha(calibration_first) == binding.get("firstGradeFreezeSha256"), "Calibration first grades were not frozen before final grading")
        prior = read_json(calibration_first)
        require(prior["agentIdentity"] == identity["agentIdentity"] and prior["count"] == 24 and prior["queueSha256"] == calibration["queueSha256"], "Calibration used another judge or incomplete reference queue")
        require(sha(prior["gradePath"]) == prior["gradeSha256"] and sha(prior["identityPath"]) == prior["identitySha256"], "Calibration grade/identity changed")
        calibration_queue = read_jsonl(calibration_packet / "queue.jsonl")
        require(sha(calibration_packet / "queue.jsonl") == calibration["queueSha256"], "Calibration queue changed")
        validate_grades(read_jsonl(prior["gradePath"]), {c["id"] for c in calibration_queue})
        for card in calibration_queue: require(sha(card["cropped_png"]) == card["figureSha256"], "Calibration image changed")
        calibration_binding = binding
    metadata = {"judge": args.judge, "gradeSchema": GRADE_SCHEMA, "count": len(ids), "gradePath": str(grade), "gradeSha256": args.sha256,
                "queueSha256": freeze["queueSha256"], "imageHashesPassed": True, "schemaPassed": True, "qualityUnblinded": False,
                "recoveries": args.recoveries, "identityPath": str(identity_path), "identitySha256": sha(identity_path), "agentIdentity": identity["agentIdentity"]}
    if calibration_binding is not None: metadata["calibration"] = calibration_binding
    target = packet / f"judge-{args.judge}-first-freeze.json"
    if target.exists(): require(read_json(target) == {**metadata, "frozenAt": read_json(target)["frozenAt"]}, "Finished first freeze changed")
    else: write_once(target, {**metadata, "frozenAt": utc_now()})
    print(canonical({"judge": args.judge, "count": len(ids), "gradeSha256": args.sha256, "recoveries": args.recoveries, "qualityUnblinded": False}))


if __name__ == "__main__": main()
