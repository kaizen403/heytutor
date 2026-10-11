"""Full logical-arm evidence from every fixed block. No grading, rendering or dispatch."""
import shutil
from pathlib import Path
from original_bridge import *


def cell_identity(value):
    return {key: value[key] for key in ["cohort", "rep", "arm"]}


def expected_cell_blocks(registration, cell):
    require(cell in registration["order"], "Foreign paid logical cell")
    return [b for b in registration["dispatchBlocks"] if cell_identity(b) == cell]


def block_artifacts(block):
    root = Path(block["out"]).resolve()
    runs = sorted((root / "runs").glob("*.json"))
    records = [read_json(p) for p in runs]
    verify_block_records(records, block)
    paths = set(runs)
    for record in records:
        for key in ["svg", "png"]:
            name = record.get("diagram", {}).get(key)
            if name is None: continue
            path = root / name
            require(not Path(name).is_absolute() and path.resolve().parent == root / "frames" and path.is_file(), "Foreign or missing recorded frame")
            paths.add(path)
    return [{"path": str(p), "relative": str(p.relative_to(root)), "sha256": sha(p)} for p in sorted(paths)]


def freeze_block(registration, prereg_path, block, anchor):
    require(block in registration["dispatchBlocks"], "Unregistered completed block")
    checkpoint = Path(block["out"]) / "spend-checkpoint.json"
    values = response_ledger_values(read_json(checkpoint))
    require(values["reservedUsd"] == values["inFlightCalls"] == 0, "Completed block still has live reservation exposure")
    settled = read_json(anchor["path"])
    require(sha(anchor["path"]) == anchor["sha256"] and settled["preregistrationSha256"] == sha(prereg_path), "Foreign block settlement anchor")
    require(settled["quiescentAfter"] is not None and len(settled["stableObservations"]) == 8, "Block lacks post-quiescence eight-observation anchor")
    require(settled["ledgers"][str(checkpoint.resolve())]["sha256"] == sha(checkpoint), "Block checkpoint changed after settlement")
    path = Path(block["out"]) / "block-complete.json"
    write_once(path, {"schema": "finish-regions-completed-fixed-block/v1", "preregistrationSha256": sha(prereg_path),
        "block": block, "checkpoint": {"path": str(checkpoint), "sha256": sha(checkpoint)},
        "settlementAnchor": anchor, "artifacts": block_artifacts(block), "selectiveRetry": False})
    return {"block": block, "receipt": {"path": str(path), "sha256": sha(path)}}


def verify_block_receipt(registration, prereg_path, entry):
    block = entry["block"]
    require(block in registration["dispatchBlocks"], "Foreign completed fixed block")
    ref = entry["receipt"]; path = Path(block["out"]) / "block-complete.json"
    require(Path(ref["path"]).resolve() == path.resolve() and sha(path) == ref["sha256"], "Completed block receipt changed")
    receipt = read_json(path)
    require(receipt["block"] == block and receipt["preregistrationSha256"] == sha(prereg_path), "Wrong completed block identity")
    require(receipt["artifacts"] == block_artifacts(block), "Original fixed block artifacts changed")
    checkpoint = receipt["checkpoint"]
    require(Path(checkpoint["path"]).resolve() == (Path(block["out"]) / "spend-checkpoint.json").resolve() and sha(checkpoint["path"]) == checkpoint["sha256"], "Completed checkpoint changed")
    values = response_ledger_values(read_json(checkpoint["path"]))
    require(values["reservedUsd"] == values["inFlightCalls"] == 0, "Completed block still has live reservation exposure")
    anchor = receipt["settlementAnchor"]
    require(sha(anchor["path"]) == anchor["sha256"], "Completed settlement anchor changed")
    settled = read_json(anchor["path"])
    require(settled["preregistrationSha256"] == sha(prereg_path) and settled["quiescentAfter"] is not None,
        "Wrong completed settlement identity")
    observations = settled["stableObservations"]
    require(len(observations) == len({o["observedAt"] for o in observations}) == 8 and
        all(o["cumulative"] == observations[-1]["cumulative"] for o in observations), "Completed block lacks eight settled observations")
    require(settled["ledgers"][str(Path(checkpoint["path"]).resolve())]["sha256"] == checkpoint["sha256"], "Settlement lost block accounting")
    return receipt


def canonicalize_cell(registration, prereg_path, cell, entries):
    expected = expected_cell_blocks(registration, cell)
    require([e["block"] for e in entries] == expected, "Logical arm lacks all fixed blocks in order")
    root = Path(registration["context"]) / "canonical-outputs" / f"{cell['cohort']}-r{cell['rep']}-{cell['arm']}"
    require(not root.exists(), "Canonical arm already exists; no retry/overwrite")
    receipts = [verify_block_receipt(registration, prereg_path, e) for e in entries]
    copies = []; used = set()
    for receipt in receipts:
        for artifact in receipt["artifacts"]:
            relative = artifact["relative"]
            require(relative not in used, "Duplicate fixed block artifact filename")
            used.add(relative)
            target = root / relative; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(artifact["path"], target)
            require(sha(target) == artifact["sha256"], "Canonical copy differs from original")
            copies.append({"original": artifact["path"], "path": str(target), "sha256": artifact["sha256"]})
    verify_arm_records([read_json(p) for p in (root / "runs").glob("*.json")], cell["cohort"], set(registration["cohorts"][cell["cohort"]]["rowIds"]))
    path = root / "canonical-copy.json"
    write_once(path, {"schema": "finish-regions-canonical-full-arm/v1", "preregistrationSha256": sha(prereg_path),
        "cell": cell, "n": COHORTS[cell["cohort"]], "blocks": entries, "copies": copies,
        "spendCheckpointCopied": False, "selectiveRetry": False})
    return {**cell, "round": str(root), "sample": registration["assets"][registration["cohorts"][cell["cohort"]]["evalAsset"]]["path"],
        "sampleSha256": registration["assets"][registration["cohorts"][cell["cohort"]]["evalAsset"]]["sha256"],
        "n": COHORTS[cell["cohort"]], "reusedImmutableMain": False, "canonicalReceipt": {"path": str(path), "sha256": sha(path)}}


def verify_canonical_cell(registration, prereg_path, item):
    cell = cell_identity(item); expected = expected_cell_blocks(registration, cell)
    root = Path(registration["context"]) / "canonical-outputs" / f"{cell['cohort']}-r{cell['rep']}-{cell['arm']}"
    ref = item["canonicalReceipt"]; path = root / "canonical-copy.json"
    require(Path(item["round"]).resolve() == root.resolve() and Path(ref["path"]).resolve() == path.resolve() and sha(path) == ref["sha256"], "Changed canonical arm location/receipt")
    receipt = read_json(path)
    require(receipt["cell"] == cell and receipt["n"] == COHORTS[cell["cohort"]] and receipt["preregistrationSha256"] == sha(prereg_path), "Wrong canonical arm identity")
    require([e["block"] for e in receipt["blocks"]] == expected and receipt["spendCheckpointCopied"] is False, "Canonical arm missing/duplicate/extra fixed blocks or copied ledger")
    originals = [a for e in receipt["blocks"] for a in verify_block_receipt(registration, prereg_path, e)["artifacts"]]
    expected_copies = [{"original": a["path"], "path": str(root / a["relative"]), "sha256": a["sha256"]} for a in originals]
    require(receipt["copies"] == expected_copies and len({a["path"] for a in expected_copies}) == len(expected_copies), "Canonical copy map missing/duplicate/foreign artifacts")
    for artifact in expected_copies: require(sha(artifact["path"]) == artifact["sha256"], "Canonical artifact changed")
    require({str(p) for p in root.rglob("*") if p.is_file()} == {a["path"] for a in expected_copies} | {str(path)}, "Canonical arm has extra files/accounting")
    verify_arm_records([read_json(p) for p in (root / "runs").glob("*.json")], cell["cohort"], set(registration["cohorts"][cell["cohort"]]["rowIds"]))
    return receipt["blocks"]


def verify_completed_evidence(registration, prereg_path, completed, physical):
    validate_complete_cells(completed)
    require([e["block"] for e in physical] == registration["dispatchBlocks"], "Incomplete/duplicate/foreign eight physical blocks")
    reuse = read_json(registration["assets"]["mainReuse"]["path"])
    expected_reuse = [{**a, "cohort": "development", "reusedImmutableMain": True} for a in reuse["arms"]]
    require(sorted(canonical(a) for a in completed if a.get("reusedImmutableMain")) == sorted(canonical(a) for a in expected_reuse), "Changed immutable MAIN reuse identity")
    collected = []
    for item in completed:
        if item.get("reusedImmutableMain"):
            require(item["cohort"] == "development" and item["arm"] == "main", "Foreign reused logical arm")
        else:
            collected += verify_canonical_cell(registration, prereg_path, item)
    require(sorted(canonical(e) for e in collected) == sorted(canonical(e) for e in physical), "Physical/canonical block receipt mismatch")
    return True
