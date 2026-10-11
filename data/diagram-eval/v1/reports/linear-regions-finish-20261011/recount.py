#!/usr/bin/env python3
"""Offline portable evidence audit. Reads archive-local files; never opens images or calls APIs."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys

SCHEMA = "finish-regions-portable-evidence/v1"
COHORTS = {"development": 40, "heldout": 20}
GRADE_SCHEMA = "shaded-region-first-grade/v1"
ARRAYS = ("missing", "wrong_items", "missing_geometry", "missing_boundary_semantics",
          "missing_corner_labels", "missing_objective_values")
GRADE_KEYS = {"id", "verdict", "reason", *ARRAYS}
VERDICTS = ("right", "partial", "wrong", "empty_bad", "empty_ok")
GATE = {"rightDeltaMinimumExclusive": 0, "wrongDeltaMaximum": 0,
        "candidateWrongMaximum": 1, "requiredEmptyDeltaMaximum": 2,
        "everyCohortRepeatAndJudgeMustPass": True, "poolingAllowed": False}
ACCOUNTING = {"originalProtocolReady": False, "originalAbortedSavedPrefix": 15,
              "originalCapturedConcurrency": 3, "configuredConcurrency": 3,
              "replacementDispatchRows": 1, "replacementEffectiveConcurrency": 1,
              "replacementFullRows": 40, "replacementCells": 1,
              "newGradedModelOutcomes": 160, "reusedMainOutcomes": 80,
              "totalRecordedNewModelRows": 175, "discardedUngradedRows": 15,
              "interruptedAttemptsIncludedInSpend": True, "operationalConfound": True}
MISSING_CELL = {"cohort": "development", "rep": 2, "arm": "candidate"}
SECONDARY_SCOPE = {"schema": "secondary-report-only/v1", "missingCell": MISSING_CELL,
                   "trigger": "operational-incomplete-replacement-before-quality",
                   "prefixesGraded": False, "ready": False}
REQUIRED_ROLES = {"preregistration", "packetFreeze", "queue", "outcomes", "rejectionDiagnostics",
                  "consensusFreeze", "consensus", "results",
                  *{f"{kind}-{judge}" for kind in ("firstFreeze", "grade", "identity")
                    for judge in ("a", "b", "c")}}
SUPPORT_ROLES = {"image", "protocol", "spend", "settlement", "runtimeSourceFreeze",
                 "calibrationFirstFreeze", "calibrationIdentity", "calibrationReferenceFreeze",
                 "calibrationGrade", "calibrationReference", "calibrationQueue", "calibrationFreeze",
                 "calibrationImage", "calibrationConsistency", "baselineReuse", "outcomeMap", "helper", "documentation"}
CONSENSUS_RULE = "A/B agreement stands; complete blind C resolves disagreement; three different verdicts are wrong"


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(path):
    with Path(path).open("rb") as handle:
        result = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def digest(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value), f"Invalid SHA256: {label}")
    return value


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        require(key not in obj, "Duplicate JSON object key")
        obj[key] = value
    return obj


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))


def read_json(path):
    return decode(Path(path).read_text(encoding="utf-8"))


def read_rows(path):
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = decode(line)
            require(isinstance(item, dict), f"Non-object JSONL row: {Path(path).name}")
            rows.append(item)
    return rows


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def same_json(left, right):
    """Do not treat false as zero or 1.0 as integer 1 in fixed control/grade metadata."""
    return json.dumps(left, sort_keys=True, separators=(",", ":"), allow_nan=False) == json.dumps(
        right, sort_keys=True, separators=(",", ":"), allow_nan=False)


def text_value(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing text: {label}")
    return value


def local_path(base, name):
    require(isinstance(name, str) and name, "Missing portable file path")
    parts = PurePosixPath(name)
    require(not parts.is_absolute() and ".." not in parts.parts and "\\" not in name,
            "Non-local portable file path")
    require(parts.as_posix() == name and name not in (".", "evidence-manifest.json", "evidence-manifest.sha256"),
            "Non-canonical or reserved portable file path")
    path = base.joinpath(*parts.parts)
    require(path.resolve().is_relative_to(base.resolve()), "Portable path escapes archive")
    require(not any(base.joinpath(*parts.parts[:n]).is_symlink() for n in range(1, len(parts.parts) + 1)),
            "Symlink evidence is forbidden")
    return path


def error_present(value):
    """Null, absent, and blank strings mean no error; source errors remain in the denominator."""
    return bool(value.strip()) if isinstance(value, str) else bool(value)


def bucket(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return "none"
    require(isinstance(value, str), "Invalid source/tier metadata")
    return value


class Evidence:
    def __init__(self, base, pinned_sha):
        self.base = Path(base).resolve()
        manifest_path = self.base / "evidence-manifest.json"
        require(not manifest_path.is_symlink(), "Symlink manifest is forbidden")
        require(sha(manifest_path) == digest(pinned_sha, "manifest pin"), "Manifest SHA256 differs from pin")
        self.manifest = read_json(manifest_path)
        m = self.manifest
        require(m.get("schema") == SCHEMA, "Wrong manifest schema")
        self.mode = m.get("mode")
        require(self.mode in ("primary240", "secondary200"), "Missing/invalid report mode")
        self.total = 240 if self.mode == "primary240" else 200
        require(same_json(m.get("cohorts"), COHORTS) and integer(m.get("totalOutcomes"))
                and m.get("totalOutcomes") == self.total, "Wrong fixed denominator")
        require(m.get("repeats") == [1, 2] and m.get("arms") == ["main", "candidate"], "Wrong matrix")
        require(m.get("allVisualsRequired") is True and m.get("noClassificationFiltering") is True,
                "Required/source-inclusive controls changed")
        require(same_json(m.get("gate"), GATE), "Changed readiness gate")
        self.accounting = dict(ACCOUNTING)
        if self.mode == "secondary200":
            require(same_json(m.get("secondaryScope"), SECONDARY_SCOPE), "Changed seven-cell report-only scope")
            recorded = m.get("protocolAccounting", {}).get("replacementRecordedRows")
            require(integer(recorded) and 0 <= recorded < 40, "Secondary trigger requires incomplete replacement")
            self.accounting.update(newGradedModelOutcomes=120, totalRecordedNewModelRows=135 + recorded,
                                   discardedUngradedRows=15 + recorded, replacementRecordedRows=recorded)
        else:
            require("secondaryScope" not in m, "Secondary scope mixed into primary report")
        require(same_json(m.get("protocolAccounting"), self.accounting), "Changed original/replacement protocol accounting")
        require(m.get("questionBodiesExcluded") is True and m.get("credentialsAndEnvExcluded") is True,
                "Archive privacy controls missing")
        budget = m.get("budget", {})
        require(budget.get("capUsd") == 20 and budget.get("scope") == "cumulative-job" and
                budget.get("includesDiscardedAndInterruptedAttempts") is True, "Changed cumulative budget scope")
        spent = budget.get("spentUsd")
        require(isinstance(spent, (int, float)) and not isinstance(spent, bool) and
                math.isfinite(spent) and 0 <= spent <= 20, "Invalid/over-cap cumulative spend")
        entries = m.get("files")
        require(isinstance(entries, list) and entries, "Missing evidence files")
        self.roles, self.sources, names = {}, {}, set()
        for entry in entries:
            require(isinstance(entry, dict) and set(entry) == {"path", "role", "sha256", "bytes", "sourcePath", "sourceSha256"},
                    "Invalid evidence entry")
            name, role = entry["path"], entry["role"]
            require(PurePosixPath(name).name not in {".env", "credentials.json", "secrets.json"}
                    and not PurePosixPath(name).name.startswith(".env."), "Credentials/environment archive member excluded")
            require(role in REQUIRED_ROLES | SUPPORT_ROLES, "Unapproved archive role")
            require(name not in names, "Duplicate portable path")
            names.add(name)
            path = local_path(self.base, name)
            require(path.is_file(), f"Missing evidence: {name}")
            require(integer(entry["bytes"]) and entry["bytes"] >= 0 and path.stat().st_size == entry["bytes"],
                    f"Changed byte count: {name}")
            expected = digest(entry["sha256"], name)
            require(sha(path) == expected and entry["sourceSha256"] == expected, f"Changed evidence SHA256: {name}")
            source = text_value(entry["sourcePath"], "original sourcePath")
            require(PurePosixPath(source).is_absolute(), "Original provenance path must be absolute")
            require(source not in self.sources, "Duplicate provenance path")
            self.sources[source] = entry
            self.roles.setdefault(role, []).append(entry)
        require(REQUIRED_ROLES <= set(self.roles), "Missing mandatory evidence role")
        for role in REQUIRED_ROLES:
            require(len(self.roles[role]) == 1, f"Duplicate required evidence role: {role}")
        for role in ("protocol", "spend", "settlement", "runtimeSourceFreeze", "calibrationFirstFreeze",
                     "calibrationIdentity", "calibrationReferenceFreeze", "baselineReuse", "outcomeMap"):
            require(role in self.roles, f"Missing archived support role: {role}")
        self.verify_no_extras(names)

    def verify_no_extras(self, names):
        actual = set()
        for path in self.base.rglob("*"):
            require(not path.is_symlink(), "Symlink archive member is forbidden")
            if path.is_file():
                actual.add(path.relative_to(self.base).as_posix())
        require(actual <= names | {"evidence-manifest.json", "evidence-manifest.sha256"},
                "Unmanifested archive file")

    def entry(self, role):
        return self.roles[role][0]

    def path(self, role):
        return local_path(self.base, self.entry(role)["path"])

    def json(self, role):
        return read_json(self.path(role))

    def rows(self, role):
        return read_rows(self.path(role))

    def linked(self, source_path, expected_sha, role=None):
        require(source_path in self.sources, "Original reference has no portable evidence mapping")
        entry = self.sources[source_path]
        require(entry["sha256"] == digest(expected_sha, "linked evidence"), "Linked provenance SHA changed")
        require(role is None or entry["role"] == role, "Wrong provenance evidence role")


def validate_grades(rows, ids):
    require(len(rows) == len(ids) and len({r.get("id") for r in rows}) == len(rows)
            and {r.get("id") for r in rows} == ids, "Incomplete, duplicate or foreign first grades")
    for row in rows:
        require(set(row) == GRADE_KEYS and row["verdict"] in VERDICTS[:3], "Invalid first grade schema")
        require(isinstance(row["reason"], str) and len(row["reason"].split()) <= 20, "Invalid first grade reason")
        for key in ARRAYS:
            require(isinstance(row[key], list) and all(isinstance(s, str) for s in row[key]), "Invalid first grade array")


def recompute_consensus(grades, ids):
    output = []
    for card in sorted(ids):
        a, b, c = [grades[j][card] for j in ("a", "b", "c")]
        votes = [a["verdict"], b["verdict"]]
        three = False
        if votes[0] == votes[1]:
            verdict, selected = votes[0], a
        else:
            votes.append(c["verdict"])
            three = len(set(votes)) == 3
            verdict = "wrong" if three else next(v for v in votes if votes.count(v) >= 2)
            selected = next((r for r in (a, b, c) if r["verdict"] == verdict), c)
        output.append({**selected, "verdict": verdict, "judgeVotes": votes, "threeWayConservativeWrong": three})
    return output


def validate_outcomes(outcomes, ids, mode="primary240"):
    total = 240 if mode == "primary240" else 200
    require(len(outcomes) == total, "Incomplete fixed-scope outcome matrix")
    keys = []
    row_sets, card_ids = {}, []
    required = {"cohort", "rep", "arm", "rowId", "drawn", "cardId", "figureNeed", "runPath", "runSha256"}
    for row in outcomes:
        require(required <= set(row), "Missing outcome metadata")
        cohort, rep, arm = row["cohort"], row["rep"], row["arm"]
        require(cohort in COHORTS and integer(rep) and rep in (1, 2) and arm in ("main", "candidate"), "Wrong outcome matrix key")
        text_value(row["rowId"], "rowId")
        require(type(row["drawn"]) is bool and row["figureNeed"] == "required", "Changed required/drawn denominator")
        keys.append((cohort, rep, arm, row["rowId"]))
        row_sets.setdefault((cohort, rep, arm), set()).add(row["rowId"])
        if row["drawn"]:
            card_ids.append(text_value(row["cardId"], "drawn cardId"))
        else:
            require(row["cardId"] is None or row["cardId"] == "", "Empty outcome has a cardId")
        text_value(row["runPath"], "original runPath")
        digest(row["runSha256"], "original run provenance")
        bucket(row.get("tier")); bucket(row.get("source"))
    require(len(set(keys)) == total, "Duplicate all-cohort outcome")
    expected = {(c, r, a) for c in COHORTS for r in (1, 2) for a in ("main", "candidate")}
    if mode == "secondary200":
        expected.remove(("development", 2, "candidate"))
    require(set(row_sets) == expected, "Incomplete cells")
    cohort_ids = {}
    for cohort, n in COHORTS.items():
        reference = row_sets[(cohort, 1, "main")]
        require(len(reference) == n and all(row_sets[key] == reference for key in expected if key[0] == cohort),
                "Wrong cohort denominator or unpaired row IDs")
        cohort_ids[cohort] = reference
    require(not cohort_ids["development"] & cohort_ids["heldout"], "Cross-cohort row collision")
    require(set(card_ids) == ids, "Drawn-card identity mismatch")
    return cohort_ids


def verify_image_map(mapping, outcomes, queue):
    cards = {r["id"]: r for r in queue}
    require(len(mapping) == len(cards) and len({r.get("id") for r in mapping}) == len(mapping)
            and {r.get("id") for r in mapping} == set(cards), "Incomplete/duplicate image map")
    wanted = {(r["cohort"], r["arm"], r["rep"], r["rowId"], r["runPath"]): r
              for r in outcomes if r["drawn"]}
    seen = set()
    for card in mapping:
        digest(card["rubricSha256"], "rubric provenance")
        crop = digest(card["cropSha256"], "crop provenance")
        require(crop == cards[card["id"]]["figureSha256"], "Queue/image-map crop mismatch")
        require(isinstance(card["references"], list) and card["references"], "Empty image-map references")
        for ref in card["references"]:
            require(integer(ref["rep"]), "Invalid image-map repeat type")
            key = (ref["cohort"], ref["arm"], ref["rep"], ref["rowId"], ref["runPath"])
            require(key in wanted and key not in seen, "Foreign/duplicate image-map reference")
            row = wanted[key]
            require(row["cardId"] == card["id"] and row["cropSha256"] == crop, "Outcome/image-map identity mismatch")
            digest(ref["cleanBodySvgSha256"], "clean SVG provenance")
            digest(ref["cleanBodyPngSha256"], "clean PNG provenance")
            seen.add(key)
    require(seen == set(wanted), "Missing image-map outcome reference")


def aggregate(outcomes, grade_map, mode="primary240"):
    result = []
    for cohort, n in COHORTS.items():
        for rep in (1, 2):
            maps, counts = {}, {}
            for arm in ("main", "candidate"):
                rows = [r for r in outcomes if (r["cohort"], r["rep"], r["arm"]) == (cohort, rep, arm)]
                if mode == "secondary200" and (cohort, rep, arm) == ("development", 2, "candidate"):
                    require(not rows, "Aborted candidate prefix entered secondary grades")
                    counts[arm] = None
                    continue
                maps[arm] = {r["rowId"]: {**r, "verdict": grade_map[r["cardId"]]["verdict"] if r["drawn"] else "empty_bad"}
                             for r in rows}
                c = Counter(r["verdict"] for r in maps[arm].values())
                drawn = sum(r["drawn"] for r in rows)
                counts[arm] = {"n": n, "drawn": drawn, **{k: c[k] for k in VERDICTS},
                               "strict": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("strategy") == "strict" for r in rows),
                               "classifiedMaths": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("classifiedSubject") == "maths" for r in rows),
                               "runErrors": sum(error_present(r.get("error")) for r in rows),
                               "omissionDenominatorDrawn": drawn, "requiredVisualDenominator": n,
                               "correctRequiredVisuals": c["right"],
                               "tierCounts": dict(Counter(bucket(r.get("tier")) for r in rows)),
                               "sourceCounts": dict(Counter(bucket(r.get("source")) for r in rows)),
                               "omissionRows": {k: sum(bool(grade_map[r["cardId"]][k]) for r in rows if r["drawn"]) for k in ARRAYS}}
                require(sum(c[k] for k in VERDICTS) == n, "Lost source-inclusive denominator")
            main, candidate = counts["main"], counts["candidate"]
            if candidate is None:
                result.append({"cohort": cohort, "rep": rep, "arms": counts, "rightDelta": None,
                               "wrongDelta": None, "requiredEmptyDelta": None, "wrongNearZero": None,
                               "pass": None, "pairedTransitions": None, "newlyWrong": None})
                continue
            rd = candidate["right"] - main["right"]
            wd = candidate["wrong"] - main["wrong"]
            ed = candidate["empty_bad"] - main["empty_bad"]
            paired = Counter(f"{maps['main'][row]['verdict']}->{maps['candidate'][row]['verdict']}" for row in sorted(maps["main"]))
            newly_wrong = [{"rowId": row, "mainVerdict": maps["main"][row]["verdict"],
                            "candidateCardId": maps["candidate"][row]["cardId"],
                            "reason": grade_map[maps["candidate"][row]["cardId"]]["reason"]}
                           for row in sorted(maps["main"]) if maps["candidate"][row]["verdict"] == "wrong"
                           and maps["main"][row]["verdict"] != "wrong"]
            result.append({"cohort": cohort, "rep": rep, "arms": counts, "rightDelta": rd, "wrongDelta": wd,
                           "requiredEmptyDelta": ed, "wrongNearZero": candidate["wrong"] <= 1,
                           "pass": rd > 0 and wd <= 0 and candidate["wrong"] <= 1 and ed <= 2,
                           "pairedTransitions": dict(sorted(paired.items())), "newlyWrong": newly_wrong})
    return result


def verify_bundle(base, pinned_sha):
    evidence = Evidence(base, pinned_sha)
    registration, frozen = evidence.json("preregistration"), evidence.json("packetFreeze")
    require(frozen["preregistrationSha256"] == evidence.entry("preregistration")["sha256"], "Foreign preregistration")
    require(frozen["cohorts"] == COHORTS and frozen["outcomes"] == evidence.total
            and registration["totalOutcomes"] == 240, "Wrong frozen/preregistered denominator")
    require({c: data["n"] for c, data in registration["cohorts"].items()} == COHORTS, "Wrong preregistered denominator")
    controls = registration["controls"]
    require(controls.get("productionStrictSubjects") == ["maths"] and controls.get("figureOnly") is True
            and controls.get("sceneDeclinePolicy") == "unchanged" and controls.get("concurrency") == 3,
            "Changed strict-maths measurement controls")
    if evidence.mode == "secondary200":
        secondary = registration["secondaryPlan"]
        cells = {(r["cohort"], r["rep"], r["arm"]) for r in secondary["cells"]}
        expected_cells = {(c, r, a) for c in COHORTS for r in (1, 2) for a in ("main", "candidate")}
        expected_cells.remove(("development", 2, "candidate"))
        require(secondary["schema"] == "secondary-report-only/v1" and secondary["outcomes"] == 200
                and secondary["logicalCells"] == 7 and len(secondary["cells"]) == 7 and cells == expected_cells
                and secondary["missingCell"] == MISSING_CELL and secondary["onlyIfFollowupAborts"] is True
                and secondary["excludeAllOldAndNewAbortedPrefixes"] is True and secondary["qualitySelection"] is False
                and secondary["ready"] is False and secondary["prEligible"] is False,
                "Secondary scope was not prospectively fixed")
        require(frozen.get("secondaryReportOnly") is True and frozen.get("readinessEligible") is False
                and frozen.get("missingCell") == MISSING_CELL and frozen.get("originalProtocolStatus") == "incomplete_not_ready",
                "Secondary packet eligibility changed")
    if "imageMapSha256" in frozen:
        require(frozen["imageMapSha256"] == evidence.entry("outcomeMap")["sha256"], "Changed packet outcome/image map")
    for role, key in (("queue", "queueSha256"), ("outcomes", "outcomesSha256"),
                      ("rejectionDiagnostics", "rejectionDiagnosticsSha256")):
        require(frozen[key] == evidence.entry(role)["sha256"], "Changed frozen packet evidence")
    queue = evidence.rows("queue")
    ids = {r.get("id") for r in queue}
    require(len(ids) == len(queue) and all(isinstance(v, str) and v for v in ids), "Duplicate/invalid queue card ID")
    for card in queue:
        evidence.linked(card["cropped_png"], card["figureSha256"], "image")
    identities, grades, firsts = [], {}, {}
    for judge in ("a", "b", "c"):
        first = evidence.json(f"firstFreeze-{judge}")
        require(first["gradeSchema"] == GRADE_SCHEMA and first["queueSha256"] == frozen["queueSha256"], "Foreign first grade identity")
        evidence.linked(first["gradePath"], first["gradeSha256"], f"grade-{judge}")
        evidence.linked(first["identityPath"], first["identitySha256"], f"identity-{judge}")
        identities.append(text_value(first["agentIdentity"], "fresh grader identity"))
        if "count" in first:
            require(first["count"] == len(ids), "Wrong first-freeze count")
        firsts[judge] = first
    require(len(set(identities)) == 3, "Three distinct first-grader identities required")
    # Establish all three immutable first-freeze bindings before opening any grade stream.
    for judge in ("a", "b", "c"):
        rows = evidence.rows(f"grade-{judge}")
        validate_grades(rows, ids)
        grades[judge] = {r["id"]: r for r in rows}
    expected_consensus = recompute_consensus(grades, ids)
    consensus = evidence.rows("consensus")
    require(len(consensus) == len(ids) and len({r.get("id") for r in consensus}) == len(consensus), "Incomplete/duplicate consensus")
    require(same_json(sorted(consensus, key=lambda r: r["id"]), expected_consensus), "Forged consensus selection, votes or rule")
    consensus_freeze = evidence.json("consensusFreeze")
    require(consensus_freeze["schema"] == "shaded-regions-consensus-freeze/v1" and consensus_freeze["gradeSchema"] == GRADE_SCHEMA,
            "Invalid consensus freeze schema")
    require(consensus_freeze["queueSha256"] == frozen["queueSha256"] and consensus_freeze["count"] == len(ids)
            and consensus_freeze["consensusSha256"] == evidence.entry("consensus")["sha256"], "Foreign consensus freeze")
    require(set(consensus_freeze["firstInputs"]) == {"a", "b", "c"}, "Missing first stream in consensus freeze")
    for judge, first in firsts.items():
        link = consensus_freeze["firstInputs"][judge]
        require(same_json(link, {"freezeSha256": evidence.entry(f"firstFreeze-{judge}")["sha256"],
                         "gradePath": first["gradePath"], "gradeSha256": first["gradeSha256"],
                         "agentIdentity": first["agentIdentity"]}), "Consensus first-freeze binding changed")
    agreed = sum(grades["a"][card]["verdict"] == grades["b"][card]["verdict"] for card in ids)
    three = sum(r["threeWayConservativeWrong"] for r in expected_consensus)
    require(consensus_freeze["agreed"] == agreed and consensus_freeze["discordant"] == len(ids) - agreed
            and consensus_freeze["threeWayConservativeWrong"] == three and consensus_freeze["armMapsRead"] is False
            and consensus_freeze["rule"] == CONSENSUS_RULE, "Changed consensus counts/authority")
    outcomes = evidence.rows("outcomes")
    cohort_ids = validate_outcomes(outcomes, ids, evidence.mode)
    verify_image_map(evidence.rows("outcomeMap"), outcomes, queue)
    for cohort in COHORTS:
        require(set(registration["cohorts"][cohort]["rowIds"]) == cohort_ids[cohort]
                and len(registration["cohorts"][cohort]["rowIds"]) == COHORTS[cohort], "Foreign frozen cohort rows")
    grades["consensus"] = {r["id"]: r for r in expected_consensus}
    reports = {judge: aggregate(outcomes, grades[judge], evidence.mode) for judge in ("a", "b", "consensus")}
    ready = evidence.mode == "primary240" and all(cell["pass"] for cells in reports.values() for cell in cells)
    saved = evidence.json("results")
    expected_schema = "shaded-regions-results/v1" if evidence.mode == "primary240" else "secondary-report-only/v1"
    require(saved["schema"] == expected_schema and saved["nPerCohortArm"] == COHORTS
            and saved["allRowOutcomes"] == evidence.total and saved["noClassificationFiltering"] is True
            and saved["noPoolingFailedRepeat"] is True, "Changed result controls/denominator")
    if evidence.mode == "secondary200":
        require("missingDevelopmentCandidateRepeat2" in saved and saved["missingDevelopmentCandidateRepeat2"] is None
                and same_json(saved.get("secondaryScope"), SECONDARY_SCOPE) and saved.get("prEligible") is False,
                "Missing explicit secondary null/scope/ineligibility")
    require(saved["preregistrationSha256"] == evidence.entry("preregistration")["sha256"]
            and same_json(saved["consensusFreeze"], consensus_freeze), "Changed results evidence identity")
    require(saved["criterion"] == registration["readinessRule"], "Changed saved readiness description")
    require(same_json(saved["graders"], reports) and type(saved["ready"]) is bool and saved["ready"] == ready,
            "Changed per-cohort/repeat counts, gates or ready result")
    for key, value in {"newModelOutcomes": 160 if evidence.mode == "primary240" else 120, "reusedMainOutcomes": 80,
                       "freshHeldoutOutcomes": 80, "repeatedDevelopmentOutcomes": 160 if evidence.mode == "primary240" else 120}.items():
        require(saved[key] == value, "Changed logical measurement accounting")
    return {"schema": "finish-regions-portable-recount/v1", "verified": True, "manifestSha256": pinned_sha,
            "mode": evidence.mode, "allRowOutcomes": evidence.total, "cohorts": COHORTS,
            "cells": 8 if evidence.mode == "primary240" else 7, "uniqueCards": len(ids),
            "firstStreams": 3, "firstGrades": {j: len(grades[j]) for j in ("a", "b", "c")},
            "consensus": {"agreed": agreed, "discordant": len(ids) - agreed, "threeWayConservativeWrong": three},
            "graders": reports, "ready": ready, "originalProtocolReady": False,
            "operationalConfound": True, "protocolAccounting": evidence.accounting,
            "supportEvidence": "SHA256 verified; raw source runs, private question bodies and spend calculations are not reconstructed",
            "apiCalls": 0, "imageViews": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--manifest-sha256", help="Externally recorded immutable SHA256; preferred over the local sidecar")
    parser.add_argument("--metadata-only", action="store_true", help="Print verification metadata without quality counts")
    args = parser.parse_args()
    pin = args.manifest_sha256
    if pin is None:
        pin = (args.archive / "evidence-manifest.sha256").read_text().strip().split()[0]
    result = verify_bundle(args.archive, pin)
    if args.metadata_only:
        result = {k: v for k, v in result.items() if k not in ("graders", "consensus", "ready")}
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, IndexError) as error:
        print(f"Evidence audit rejected: {error}", file=sys.stderr)
        sys.exit(1)
