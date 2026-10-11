"""Nonpaid preparation/freezing. Hashes recordings, never grades or views images."""
import argparse
import os
import subprocess
from measurement_core import *


def reference(path):
    path = Path(path).resolve(); return {"path": str(path), "sha256": sha(path)}


def prepare(context, freeze=False):
    context = Path(context).resolve(); original_path = context.parent / "measurement/preregistration.json"
    require(sha(original_path) == ORIGINAL_PREREG_SHA, "Wrong original preregistration")
    import original_bridge
    original = original_bridge.verify_preregistration(original_path)
    require(not (context / "preregistration.json").exists() and not (context / "execution-start.json").exists(), "Prospective protocol already frozen/started; never retry preparation")
    assets = dict(original["assets"])
    oldcontext = Path(original["context"])
    originals = {"originalPreregistration": original_path, "originalBaseline": oldcontext / "metrics/baseline.json",
                 "originalSettlement": oldcontext / "metrics/final-settlement.json", "originalAbort": oldcontext / "whole-arm-abort.json",
                 "originalCompletedArms": oldcontext / "completed-arms.json", "originalCompletedBlocks": oldcontext / "completed-blocks.json",
                 "originalSpend": oldcontext / "SPEND.json", "originalCleanup": context.parent / "ORIGINAL-CLEANUP-RECONCILIATION.json",
                 "ownedNodeAbsence": context.parent / "OWNED-NODE-ABSENCE.json",
                 "originalPrefixCheckpoint": oldcontext / "live-outputs/development-r2-candidate-b1/spend-checkpoint.json"}
    assets.update({key: reference(path) for key, path in originals.items()})
    assets["reportToolsPreparation"] = reference(context.parent / "report-tools/preparation-receipt.json")
    require(assets["reportToolsPreparation"]["sha256"] == "c6857a22dddf4130f67e362b0474c7b7e193d0d1ce70302745c8fc6257e21726", "Report-tool preparation changed")
    require(assets["originalSettlement"]["sha256"] == ORIGINAL_SETTLEMENT_SHA and assets["originalCleanup"]["sha256"] == ORIGINAL_CLEANUP_SHA, "Original settlement/cleanup differs")
    raw = Path(assets["developmentEval"]["path"]).read_bytes()
    lines = [line for line in raw.splitlines(keepends=True) if line.strip() and not line.lstrip().startswith(b"#")]
    require(len(lines) == 40, "Wrong replacement source denominator")
    for i, line in enumerate(lines, 1):
        path = context / "frozen-inputs" / f"development-row-{i:02d}.jsonl"
        write_once(path, line); assets[f"developmentRow{i:02d}"] = reference(path)
    source = read_json(assets["originalCompletedArms"]["path"])
    require(len(source["arms"]) == 7 and source["preregistrationSha256"] == ORIGINAL_PREREG_SHA, "Original must contain seven complete cells")
    artifacts = []
    for arm in source["arms"]:
        root = Path(arm["round"])
        for sub in ["runs", "frames"]:
            artifacts += [reference(p) for p in sorted((root / sub).glob("*")) if p.is_file()]
        if arm.get("canonicalReceipt"): artifacts.append(arm["canonicalReceipt"])
    paths = [a["path"] for a in artifacts]
    require(len(paths) == len(set(paths)) and not any("development-r2-candidate-b1" in p for p in paths), "Imported duplicate or aborted prefix")
    manifest = {"schema": "h3r8-seven-complete-cell-import/v1", "originalProtocolStatus": "incomplete_not_ready",
                "originalPreregistration": reference(original_path), "originalCompletedArms": assets["originalCompletedArms"],
                "arms": source["arms"], "outcomes": sum(a["n"] for a in source["arms"]), "artifacts": artifacts,
                "copiedAccountingLedgers": False, "abortedPrefixExcluded": True}
    write_once(context / "IMPORTED-COMPLETE-CELLS.json", manifest)
    assets["imports"] = reference(context / "IMPORTED-COMPLETE-CELLS.json")
    # The wrapper recorded its node PID in addition to the controller's process
    # group. Preserve an independent absent-process check without touching ledgers.
    pid_path = context / "SUPPLEMENTAL-PID-CHECK.json"
    if not pid_path.exists():
        pids = [4659, 4711, 4712, 72914]
        probe = subprocess.run(["ps", "-p", ",".join(map(str, pids)), "-o", "pid="], capture_output=True, text=True)
        require(probe.returncode in [0, 1] and not probe.stdout.strip(), "An original owned PID is still live")
        write_once(pid_path, {"schema": "h3r8-owned-pid-absence/v1", "observedAt": utc_now(), "pids": {str(pid): {"alive": False} for pid in pids},
                              "originalRecordedNodeProcess": reference(oldcontext / "runs/h3r8-development-r2-candidate-b1-process.json"),
                              "originalCleanup": assets["originalCleanup"], "metricQueries": 0, "modelCalls": 0})
    assets["supplementalPidCheck"] = reference(pid_path)
    helpers = {p.name: reference(p) for p in sorted(context.iterdir()) if p.suffix in [".py", ".mjs", ".ts"] or p.name in ["RUNBOOK.md", "judge-instructions.md"]}
    registration = {"schema": FOLLOWUP_SCHEMA, "createdAt": utc_now(), "job": "h3r8-finish-regions-prospective-one-row-followup", "context": str(context),
                    "repoRoot": original["repoRoot"], "originalPreregistration": reference(original_path), "originalProtocolStatus": "incomplete_not_ready",
                    "cohorts": original["cohorts"], "assets": assets, "helpers": helpers, "builds": original["builds"],
                    "node": original["node"], "pnpm": original["pnpm"], "controls": CONTROLS, "metrics": original["metrics"],
                    "hangGuardSeconds": 21600, "hangGuardAffectsQualityControls": False,
                    "dispatchLeasePolicy": {"oneControllerNonce": True, "registeredBlockAndOutput": True, "actualNodePidBoundOnce": True,
                                            "liveControllerAndNodeIdentity": True, "heartbeatMaxAgeSeconds": 90,
                                            "revokeBeforeCleanupAndTerminalMarkers": True, "terminalDispatchForbidden": True},
                    "budget": {"realCapUsd": 20.0, "stopAtUsd": 19.5, "carryFloorUsd": CARRY_USD, "sameOriginalJobCap": True, "previousJobInformationalUsd": 25.35188},
                    "order": [{"cohort": "development", "rep": 2, "arm": "candidate"}], "totalOutcomes": 240, "newModelOutcomes": 160,
                    "reusedMainOutcomes": 80, "thisFollowupPaidOutcomes": 40, "importedOutcomes": 200,
                    "gradeSchema": original["gradeSchema"], "readinessRule": original["readinessRule"],
                    "calibrationPolicy": {"freshIndependentJudges": 3, "referencesPerJudge": 24, "sameJudgeCalibrationAndFinal": True,
                                          "oldFirstStreamsUnusedAndNeverCopied": True, "noFeedbackBeforeAllFinalFirstFreezes": True,
                                          "referenceConsistencyIsNotHumanAccuracy": True, "sourceNaiveForkNone": True},
                    "secondaryPlan": {"schema": "secondary-report-only/v1", "onlyIfFollowupAborts": True,
                                      "importsSha256": assets["imports"]["sha256"], "outcomes": 200, "logicalCells": 7,
                                      "cells": [{k: arm[k] for k in ["cohort", "rep", "arm"]} for arm in source["arms"]],
                                      "missingCell": {"cohort": "development", "rep": 2, "arm": "candidate"},
                                      "excludeAllOldAndNewAbortedPrefixes": True, "qualitySelection": False,
                                      "sameOpaqueCropDedupGradeSchemaConsensus": True, "ready": False, "prEligible": False},
                    "policy": {"originalProtocolStatus": "incomplete_not_ready", "fullReplacementFromScratch": True, "abortedPrefixExcluded": True,
                               "selectiveRetry": False, "furtherReplacement": False, "qualityBlindedBeforeFullCompletion": True,
                               "effectiveRowsPerDispatch": 1, "configuredConcurrency": 3},
                    "limitations": "Prospective full40 replacement after a budget-only abort; original remains NOT READY. Forty one-row financial blocks change effective concurrent rows while configured concurrency3 and all runtime controls remain unchanged. Combined240 uses seven immutable recorded complete cells; discarded15 prefix never graded. Same original-job20 cap, old orphan ledger preserved, eight new post-cleanup observations required before credit. No guaranteed completion budget; any abort ends this follow-up."}
    registration["dispatchBlocks"] = prospective_blocks(registration)
    path = context / ("preregistration.json" if freeze else "preregistration.draft.json")
    if freeze: write_once(path, registration)
    else: atomic_json(path, registration)
    verified = verify_preregistration(path); verify_imported(verified)
    print(canonical({"path": str(path), "sha256": sha(path), "frozen": freeze, "runtimeCommit": registration["builds"]["candidate"]["lock"]["head"],
                     "physicalBlocks": 40, "replacementRows": 40, "importedOutcomes": 200, "totalOutcomes": 240,
                     "carryFloorUsd": CARRY_USD, "realCapUsd": 20, "stopAtUsd": 19.5, "modelCalls": 0, "metricQueries": 0}))


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--context", default=str(Path(__file__).resolve().parent)); p.add_argument("--freeze", action="store_true")
    a = p.parse_args(); prepare(a.context, a.freeze)


if __name__ == "__main__": main()
