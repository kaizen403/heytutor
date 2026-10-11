"""Owned measurement invariants. No model, network or rendering side effects."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import subprocess

DEPLOYMENT = "st-gpt-6-sol-h3"
METRIC_FILTER = f"ModelDeploymentName eq '{DEPLOYMENT}'"
PACKAGES = ("scene-engine", "tutor-core", "drawing", "whiteboard", "design-tokens")
GRADE_SCHEMA = "shaded-region-first-grade/v1"
GRADE_ARRAYS = ("missing", "wrong_items", "missing_geometry", "missing_boundary_semantics", "missing_corner_labels", "missing_objective_values")
GRADE_KEYS = {"id", "verdict", "reason", *GRADE_ARRAYS}
CONTROLS = {"arm": "planner_examples_strict", "productionStrictSubjects": ["maths"], "model": "configured",
            "figureOnly": True, "scenePlannerLimitMs": 60000, "concurrency": 3, "spendMode": "response_usage",
            "accountingAllowanceUsd": 20.0, "realCapUsd": 20.0, "stopAtUsd": 19.5,
            "sceneDeclinePolicy": "unchanged", "narrationLanguage": "english", "familiarity": "normal",
            "metricsMaxAgeMs": 150000, "heartbeatMs": 30000, "noProgressAbortSeconds": 600, "armAbortSeconds": 7200,
            "fixedDispatchRows": 1, "physicalDispatchBlocks": 40, "settleAfterEveryBlock": True}


def require(value, message):
    if not value: raise ValueError(message)


def utc_now(): return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read_json(path): return json.loads(Path(path).read_text())
def read_jsonl(path): return [json.loads(s) for s in Path(path).read_text().splitlines() if s.strip() and not s.lstrip().startswith("#")]
def json_bytes(value): return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def write_once(path, value):
    path = Path(path); raw = value if isinstance(value, bytes) else json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == raw, f"Immutable artifact changed: {path.name}")
    else:
        with path.open("xb") as handle: handle.write(raw)


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(json_bytes(value)); temporary.replace(path)


def append_event(path, value):
    with Path(path).open("a") as handle: handle.write(canonical(value) + "\n")


COHORTS = {"development": 40, "heldout": 20}
DEVELOPMENT_SHA = "7dd247caaa637b076fe32998b831b759d28d15315932843f35a9b92a3f6ebe4f"
HELDOUT_SHA = "6a74433f4c8dcac5de6323f6e4da3456ab58dedc080da741ca248acc7df8bdea"

def balanced_order(eval_sha, baseline_commit, candidate_commit, heldout_sha=HELDOUT_SHA):
    payload = f"h3r8/finish-regions/two-cohorts-two-repeats/v1\n{eval_sha}\n{heldout_sha}\n{baseline_commit}\n{candidate_commit}"
    seed = hashlib.sha256(payload.encode()).hexdigest()
    # Fixed before outputs; heldout uses ABBA and development repeats surround it.
    order = [
        {"cohort": "development", "rep": 1, "arm": "candidate"},
        {"cohort": "heldout", "rep": 1, "arm": "main"},
        {"cohort": "heldout", "rep": 1, "arm": "candidate"},
        {"cohort": "heldout", "rep": 2, "arm": "candidate"},
        {"cohort": "heldout", "rep": 2, "arm": "main"},
        {"cohort": "development", "rep": 2, "arm": "candidate"},
    ]
    return seed, order


def validate_complete_cells(arms):
    expected = {(cohort, rep, arm) for cohort in COHORTS for rep in [1, 2] for arm in ["main", "candidate"]}
    keys = [(a.get("cohort"), a.get("rep"), a.get("arm")) for a in arms]
    require(len(keys) == len(set(keys)) == 8 and set(keys) == expected, "Incomplete, duplicate or foreign eight-cell matrix")
    for a in arms: require(a.get("n") == COHORTS[a["cohort"]], "Wrong cohort denominator")
    return True


def fixed_development_bytes(path):
    """Return the immutable first/last twenty original data lines; emit no semantics."""
    raw = Path(path).read_bytes()
    require(hashlib.sha256(raw).hexdigest() == DEVELOPMENT_SHA, "Development source fingerprint changed")
    rows = [line for line in raw.splitlines(keepends=True) if line.strip() and not line.lstrip().startswith(b"#")]
    require(len(rows) == 40, "Development block source must have forty rows")
    return [b"".join(rows[:20]), b"".join(rows[20:])]


def dispatch_blocks(registration):
    blocks = []
    for cell in registration["order"]:
        cohort = cell["cohort"]; ids = registration["cohorts"][cohort]["rowIds"]
        for index in range(2 if cohort == "development" else 1):
            label = f"h3r8-{cohort}-r{cell['rep']}-{cell['arm']}-b{index + 1}"
            blocks.append({**cell, "block": index + 1, "n": 20, "label": label,
                "out": str(Path(registration["context"]) / "live-outputs" / label.removeprefix("h3r8-")),
                "evalAsset": f"developmentBlock{index + 1}Eval" if cohort == "development" else "heldoutEval",
                "rowIds": ids[index * 20:(index + 1) * 20]})
    return blocks


def verify_dispatch_blocks(registration):
    require(registration.get("dispatchBlocks") == dispatch_blocks(registration), "Changed fixed dispatch blocks/order/IDs/output")
    blocks = registration["dispatchBlocks"]
    require(len(blocks) == 8 and len({b["out"] for b in blocks}) == 8 and sum(b["n"] for b in blocks) == 160, "Wrong physical block matrix")
    dev_ids = registration["cohorts"]["development"]["rowIds"]
    require(len(dev_ids) == len(set(dev_ids)) == 40, "Wrong development row identities")
    held_ids = registration["cohorts"]["heldout"]["rowIds"]
    require(len(held_ids) == len(set(held_ids)) == 20 and not set(dev_ids) & set(held_ids), "Wrong heldout/cross-cohort row identities")
    for cohort in COHORTS:
        require(registration["cohorts"][cohort]["rowIds"] == [row["id"] for row in read_jsonl(registration["assets"][registration["cohorts"][cohort]["evalAsset"]]["path"])], "Frozen cohort row IDs changed")
    raw_blocks = fixed_development_bytes(registration["assets"]["developmentEval"]["path"])
    for index, raw in enumerate(raw_blocks, 1):
        asset = registration["assets"][f"developmentBlock{index}Eval"]
        require(Path(asset["path"]).read_bytes() == raw and sha(asset["path"]) == asset["sha256"], "Changed first/last twenty development bytes")
    return True


def verify_records(records, expected_ids, n):
    ids = [r.get("probeId") for r in records]
    require(len(ids) == len(set(ids)) == n and set(ids) == set(expected_ids), "Whole arm/block has missing, duplicate or foreign row IDs")
    for record in records:
        require(record.get("providerConfig", {}).get("provider") == "azure" and record["providerConfig"].get("deployment") == DEPLOYMENT, "Wrong measured provider")
        identity = record.get("executionConfig", {})
        require(identity.get("productionStrictSubjects") == ["maths"] and identity.get("examplePickerProfile") == "live-client-4000ms/v1" and identity.get("subjectClassification") == "existing-turn-plan", "Wrong production profile identity")
        require(identity.get("figureOnly") is True and identity.get("scenePlannerLimitMs") == 60000 and identity.get("spendMode") == "response_usage", "Wrong row controls")
        require(record.get("visualNeed", {}).get("origin") == "frozen_replay", "Jev was not parked")
    return True


def verify_arm_records(records, cohort, expected_ids):
    require(cohort in COHORTS and len(expected_ids) == COHORTS[cohort], "Wrong preregistered cohort identity")
    return verify_records(records, expected_ids, COHORTS[cohort])


def verify_block_records(records, block):
    require(block["n"] == len(block["rowIds"]) == len(set(block["rowIds"])) == 20, "Wrong fixed block denominator")
    return verify_records(records, block["rowIds"], 20)


def eval_manifest_metadata(manifest, eval_path):
    """Read count/hash fields only; callers never deserialize the evaluation rows."""
    n = manifest.get("row_count", manifest.get("n", manifest.get("rowCount", manifest.get("count"))))
    declared_sha = manifest.get("sha256", manifest.get("evalSha256", manifest.get("datasetSha256")))
    if declared_sha is None:
        hashes = manifest.get("hashes", {})
        matches = [value for name, value in hashes.items() if Path(name).name == Path(eval_path).name]
        require(len(matches) == 1, "Ambiguous or missing eval hash in manifest")
        declared_sha = matches[0]
    require(isinstance(n, int) and isinstance(declared_sha, str) and len(declared_sha) == 64, "Invalid eval manifest metadata")
    return n, declared_sha


def response_ledger_values(checkpoint):
    require(checkpoint.get("spendMode") == "response_usage", "Response ledger mode mismatch")
    provider = checkpoint.get("providerConfig", {})
    require(provider.get("provider") == "azure" and provider.get("deployment") == DEPLOYMENT, "Response ledger provider mismatch")
    keys = ["knownUsageUsd", "unresolvedAllowanceUsd", "reservedUsd", "inFlightCalls"]
    require(all(key in checkpoint for key in keys) and isinstance(checkpoint.get("unresolvedCalls"), list), "Missing response ledger accounting is unknown")
    values = {key: checkpoint[key] for key in keys}
    require(all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in values.values()), "Invalid response ledger cost/exposure")
    require(isinstance(values["inFlightCalls"], int), "In-flight call count must be integral")
    calls = checkpoint["unresolvedCalls"]
    require(all(isinstance(c, dict) and isinstance(c.get("attempts"), int) and not isinstance(c["attempts"], bool) and c["attempts"] >= 1 and
        isinstance(c.get("allowanceUsd"), (int, float)) and not isinstance(c["allowanceUsd"], bool) and math.isfinite(c["allowanceUsd"]) and c["allowanceUsd"] >= 0 for c in calls), "Invalid unresolved attempt evidence")
    require(abs(sum(c["allowanceUsd"] for c in calls) - values["unresolvedAllowanceUsd"]) <= 1e-6, "Unresolved allowances disappeared from accounting")
    require((values["reservedUsd"] > 0) == (values["inFlightCalls"] > 0), "Reservation/call accounting mismatch")
    return values


def azure_metric_totals(response):
    """Absent series are unreadable accounting; null idle buckets are zero only within a present series."""
    totals, buckets = {}, {}
    for metric in response.get("value", []):
        name = metric["name"]["value"]
        require(name in ["ProcessedPromptTokens", "GeneratedTokens"] and name not in totals, "Unexpected or duplicate metric")
        series = metric.get("timeseries", [])
        require(series and all(isinstance(item.get("data"), list) and item["data"] for item in series), "Missing Azure metric series/data is unknown")
        data = [bucket for item in series for bucket in item["data"]]
        numeric = [bucket.get("total") for bucket in data if bucket.get("total") is not None]
        require(numeric and all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 for value in numeric), "Azure metric lacks valid numeric evidence")
        totals[name] = sum(numeric)
        buckets[name] = [{"timeStamp": bucket["timeStamp"], "total": 0 if bucket.get("total") is None else bucket["total"]} for bucket in data]
    require(set(totals) == {"ProcessedPromptTokens", "GeneratedTokens"}, "Incomplete Azure metrics")
    return totals, buckets


def metric_delta(current, baseline):
    for key in ["deployment", "filter", "windowStart"]:
        require(current.get(key) == baseline.get(key), f"Metric identity changed: {key}")
    if "resource" in current or "resource" in baseline:
        require(current.get("resource") == baseline.get("resource"), "Metric resource changed")
    require(current["deployment"] == DEPLOYMENT and current["filter"] == METRIC_FILTER, "Wrong metric deployment/filter")
    values = {}
    for key in ["promptTokens", "generatedTokens"]:
        a, b = current["cumulative"][key], baseline["cumulative"][key]
        require(isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b) and a >= b >= 0,
                "Invalid or negative metric counter")
        values[key] = a - b
    return {**values, "usd": values["promptTokens"] * 2e-6 + values["generatedTokens"] * 10e-6}


def validate_grades(rows, ids):
    require(len(rows) == len(ids) and len({r.get("id") for r in rows}) == len(rows) and {r.get("id") for r in rows} == ids,
            "Incomplete, duplicate or foreign first grades")
    for row in rows:
        require(set(row) == GRADE_KEYS, "Invalid first grade keys")
        require(row["verdict"] in ["right", "partial", "wrong"], "Invalid drawn verdict")
        require(isinstance(row["reason"], str) and len(row["reason"].split()) <= 20, "Invalid or long grade reason")
        for key in GRADE_ARRAYS: require(isinstance(row[key], list) and all(isinstance(s, str) for s in row[key]), "Invalid grade array")


def consensus_grades(a, b, c, ids):
    for rows in [a, b, c]: validate_grades(rows, ids)
    maps = [{r["id"]: r for r in rows} for rows in [a, b, c]]
    result = []
    for id in sorted(ids):
        first, second, third = [m[id] for m in maps]
        votes = [first["verdict"], second["verdict"]]
        threeway = False
        if votes[0] == votes[1]: verdict, selected = votes[0], first
        else:
            votes.append(third["verdict"])
            winner, count = Counter(votes).most_common(1)[0]
            threeway = count == 1; verdict = "wrong" if threeway else winner
            selected = next((r for r in [first, second, third] if r["verdict"] == verdict), third)
        result.append({**selected, "verdict": verdict, "judgeVotes": votes, "threeWayConservativeWrong": threeway})
    return result


def aggregate_grader(outcomes, grade_map, n):
    keys = [(r["rep"], r["arm"], r["rowId"]) for r in outcomes]
    require(len(keys) == len(set(keys)) == 4 * n, "Incomplete or duplicate four-arm outcomes")
    require({(r["rep"], r["arm"]) for r in outcomes} == {(r, a) for r in [1, 2] for a in ["main", "candidate"]}, "Wrong four-arm identity")
    row_ids = None; results = []
    for rep in [1, 2]:
        maps, counts = {}, {}
        for arm in ["main", "candidate"]:
            rows = [r for r in outcomes if r["rep"] == rep and r["arm"] == arm]
            require(len(rows) == n, "Wrong arm denominator")
            ids = {r["rowId"] for r in rows}
            if row_ids is None: row_ids = ids
            require(ids == row_ids, "Arm row identity mismatch")
            maps[arm] = {}
            for row in rows:
                if row["drawn"]:
                    require(row["cardId"] in grade_map, "Missing drawn first grade")
                    verdict = grade_map[row["cardId"]]["verdict"]
                else: verdict = "empty_bad" if row["figureNeed"] == "required" else "empty_ok"
                maps[arm][row["rowId"]] = {**row, "verdict": verdict}
            c = Counter(r["verdict"] for r in maps[arm].values()); drawn = sum(r["drawn"] for r in rows)
            counts[arm] = {"n": n, "drawn": drawn, **{key: c[key] for key in ["right", "partial", "wrong", "empty_bad", "empty_ok"]},
                           "strict": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("strategy") == "strict" for r in rows),
                           "classifiedMaths": sum(isinstance(r.get("strategy"), dict) and r["strategy"].get("classifiedSubject") == "maths" for r in rows),
                           "runErrors": sum(bool(r.get("error")) for r in rows), "omissionDenominatorDrawn": drawn,
                           "requiredVisualDenominator": sum(r["figureNeed"] == "required" for r in rows),
                           "correctRequiredVisuals": sum(r["figureNeed"] == "required" and maps[arm][r["rowId"]]["verdict"] == "right" for r in rows),
                           "tierCounts": dict(Counter(r.get("tier") or "none" for r in rows)),
                           "sourceCounts": dict(Counter(r.get("source") or "none" for r in rows)),
                           "omissionRows": {key: sum(bool(grade_map[r["cardId"]].get(key)) for r in rows if r["drawn"]) for key in GRADE_ARRAYS}}
            require(sum(counts[arm][key] for key in ["right", "partial", "wrong", "empty_bad", "empty_ok"]) == n, "Lost verdict denominator")
        left, right = maps["main"], maps["candidate"]
        rd, wd = counts["candidate"]["right"] - counts["main"]["right"], counts["candidate"]["wrong"] - counts["main"]["wrong"]
        transitions = Counter(f"{left[id]['verdict']}->{right[id]['verdict']}" for id in sorted(row_ids))
        newly_wrong = [{"rowId": id, "mainVerdict": left[id]["verdict"], "candidateCardId": right[id]["cardId"],
                        "reason": grade_map[right[id]["cardId"]]["reason"]} for id in sorted(row_ids)
                       if right[id]["verdict"] == "wrong" and left[id]["verdict"] != "wrong"]
        empty_delta = counts["candidate"]["empty_bad"] - counts["main"]["empty_bad"]
        near_zero = counts["candidate"]["wrong"] <= 1
        results.append({"rep": rep, "arms": counts, "rightDelta": rd, "wrongDelta": wd,
                        "requiredEmptyDelta": empty_delta, "wrongNearZero": near_zero,
                        "pass": rd > 0 and wd <= 0 and near_zero and empty_delta <= 2,
                        "pairedTransitions": dict(sorted(transitions.items())), "newlyWrong": newly_wrong})
    return results


def aggregate_cohorts(outcomes, grade_map, cohorts=COHORTS):
    keys = [(r.get("cohort"), r["rep"], r["arm"], r["rowId"]) for r in outcomes]
    require(len(keys) == len(set(keys)) == 4 * sum(cohorts.values()), "Incomplete or duplicate all-cohort outcomes")
    require({r.get("cohort") for r in outcomes} == set(cohorts), "Wrong cohort identity")
    row_ids = {}
    result = []
    for cohort, n in cohorts.items():
        rows = [r for r in outcomes if r["cohort"] == cohort]
        row_ids[cohort] = {r["rowId"] for r in rows}
        require(len(row_ids[cohort]) == n, "Wrong cohort row set")
        result += [{"cohort": cohort, **cell} for cell in aggregate_grader(rows, grade_map, n)]
    ids = [id for subset in row_ids.values() for id in subset]
    require(len(ids) == len(set(ids)), "Cross-cohort row ID collision")
    return result


def ready_gate(reports):
    require(set(reports) == {"a", "b", "consensus"}, "Both independent first judges and consensus required")
    expected = {(cohort, rep) for cohort in COHORTS for rep in [1, 2]}
    for cells in reports.values():
        require(len(cells) == 4 and {(c["cohort"], c["rep"]) for c in cells} == expected, "Both cohorts and repeats required")
    return all(cell["pass"] for cells in reports.values() for cell in cells)


def git(wt, *args): return subprocess.check_output(["git", *args], cwd=wt, text=True).strip()


def launch_environment(main_worktree, inherited):
    """Use identical isolated dotenv for task config; do not let ambient keys override it."""
    keys = {line.removeprefix("export ").split("=", 1)[0].strip() for line in (Path(main_worktree) / "apps/tutor/.env.local").read_text().splitlines()
            if "=" in line and not line.lstrip().startswith("#")}
    prefixes = ("LLM_", "AZURE_", "FIREWORKS_", "AI_GATEWAY_", "DIAGRAM_", "AUTH_", "NEXT_PUBLIC_AUTH_", "NEXT_PUBLIC_SCENE_", "H3R6_", "H3R7_", "H3R8_")
    env = {key: value for key, value in inherited.items() if key not in keys and key != "NODE_PATH" and not key.startswith(prefixes)}
    env.update({"__NEXT_DISABLE_MEMORY_WATCHER": "1", "NEXT_TELEMETRY_DISABLED": "1", "NODE_ENV": "development"})
    return env


def build_snapshot(wt):
    wt = Path(wt).resolve()
    require(not git(wt, "status", "--porcelain", "--untracked-files=no"), "Tracked source is dirty; no run.ts profile patch permitted")
    files = {name: sha(wt / name) for name in git(wt, "ls-files", "packages", "apps", "data/diagram-eval/v1/exemplars", "pnpm-lock.yaml").splitlines()
             if (wt / name).is_file()}
    for package in PACKAGES:
        require((wt / "apps/tutor/node_modules/@heytutor" / package).resolve() == wt / "packages" / package, "Cross-worktree module link")
        dist = wt / "packages" / package / "dist"
        built = [p for p in dist.rglob("*") if p.is_file()]
        require(bool(built), f"Missing private build: {package}")
        files.update({str(p.relative_to(wt)): sha(p) for p in built})
    for name in ["apps/tutor/node_modules/next/dist/bin/next", "apps/tutor/node_modules/tsx/dist/cli.mjs",
                 "apps/tutor/node_modules/next/package.json", "apps/tutor/node_modules/tsx/package.json", "apps/tutor/.env.local"]:
        require((wt / name).is_file(), f"Missing required artifact: {name}"); files[name] = sha(wt / name)
    versions = {name: read_json(wt / f"apps/tutor/node_modules/{name}/package.json")["version"] for name in ["next", "tsx"]}
    return {"head": git(wt, "rev-parse", "HEAD"), "tree": git(wt, "rev-parse", "HEAD^{tree}"), "files": files, "versions": versions}


def verify_preregistration(path, check_builds=True):
    path = Path(path).resolve(); registration = read_json(path)
    require(registration.get("schema") == "finish-regions-preregistration/v1" and registration["controls"] == CONTROLS, "Changed measurement controls")
    for asset in registration["assets"].values(): require(sha(asset["path"]) == asset["sha256"], "Frozen asset changed")
    for name, asset in registration["helpers"].items(): require(sha(asset["path"]) == asset["sha256"], f"Measurement helper changed: {name}")
    cohorts = registration["cohorts"]
    require({key: value["n"] for key, value in cohorts.items()} == COHORTS, "Wrong cohort denominators")
    for cohort, digest in [("development", DEVELOPMENT_SHA), ("heldout", HELDOUT_SHA)]:
        require(registration["assets"][cohorts[cohort]["evalAsset"]]["sha256"] == digest, "Changed cohort row fingerprint")
    seed, order = balanced_order(registration["assets"][cohorts["development"]["evalAsset"]]["sha256"], registration["builds"]["main"]["lock"]["head"], registration["builds"]["candidate"]["lock"]["head"], registration["assets"][cohorts["heldout"]["evalAsset"]]["sha256"])
    require(seed == registration["orderSeed"] and order == registration["order"], "Changed preregistered order")
    verify_dispatch_blocks(registration)
    require(registration["totalOutcomes"] == 240 and registration["newModelOutcomes"] == 160 and registration["reusedMainOutcomes"] == 80, "Wrong reused/fresh denominator")
    require(registration["budget"]["realCapUsd"] == 20.0 and registration["budget"]["stopAtUsd"] == 19.5 and registration["budget"]["previousJobAzureUsd"] == 25.35188 and registration["budget"]["jobTotalCapUsd"] == 20.0, "Wrong frozen new-job finite budget")
    reuse = read_json(registration["assets"]["mainReuse"]["path"])
    require(reuse["mainHead"] == registration["builds"]["main"]["lock"]["head"] and reuse["evalSha256"] == registration["assets"][cohorts["development"]["evalAsset"]]["sha256"], "Wrong immutable development baseline reuse")
    for asset in reuse["artifacts"] + reuse["runs"]: require(sha(asset["path"]) == asset["sha256"], "Original comparator changed")
    require(registration["builds"]["main"]["lock"]["files"]["apps/tutor/.env.local"] == registration["builds"]["candidate"]["lock"]["files"]["apps/tutor/.env.local"], "Unequal arm environment")
    if check_builds:
        for arm in ["main", "candidate"]: require(build_snapshot(registration["builds"][arm]["worktree"]) == registration["builds"][arm]["lock"], f"Frozen build changed: {arm}")
    return registration


# The numerical graders above are byte-for-byte inherited. Only prospective
# measurement identity/partition verification below replaces the old protocol.
FOLLOWUP_SCHEMA = "finish-regions-prospective-followup/v1"
ORIGINAL_PREREG_SHA = "c6b7b12870b28f127f8d7340f02ed36e9c84816e712e412127002219824fd689"
ORIGINAL_SETTLEMENT_SHA = "0e4761b9b19e7e022b72369fdf217199a273e63cd202717c9644b2405b380146"
ORIGINAL_CLEANUP_SHA = "a6b911bb2afd4e5c841473c571469b6f9e967b77f3d8814e57f9a86c0a5ba726"
CARRY_USD = 15.457060


def original_registration(registration, check_builds=False):
    import original_bridge
    ref = registration["originalPreregistration"]
    require(ref["sha256"] == ORIGINAL_PREREG_SHA and sha(ref["path"]) == ORIGINAL_PREREG_SHA, "Original preregistration changed")
    return original_bridge.verify_preregistration(ref["path"], check_builds=check_builds)


def prospective_blocks(registration):
    ids = registration["cohorts"]["development"]["rowIds"]
    context = Path(registration["context"])
    return [{"cohort": "development", "rep": 2, "arm": "candidate", "block": i,
             "n": 1, "label": f"h3r8f-development-r2-candidate-b{i:02d}",
             "out": str(context / "live-outputs" / f"h3r8f-development-r2-candidate-b{i:02d}"),
             "evalAsset": f"developmentRow{i:02d}", "rowIds": [id]}
            for i, id in enumerate(ids, 1)]


def verify_partition(registration):
    raw = Path(registration["assets"]["developmentEval"]["path"]).read_bytes()
    require(hashlib.sha256(raw).hexdigest() == DEVELOPMENT_SHA, "Development source changed")
    rows = [line for line in raw.splitlines(keepends=True) if line.strip() and not line.lstrip().startswith(b"#")]
    require(len(rows) == 40, "Wrong full replacement denominator")
    require(registration["dispatchBlocks"] == prospective_blocks(registration), "Changed replacement order/identity/partition")
    require(len({b["out"] for b in registration["dispatchBlocks"]}) == 40, "Duplicate replacement accounting path")
    for i, line in enumerate(rows, 1):
        asset = registration["assets"][f"developmentRow{i:02d}"]
        require(Path(asset["path"]).read_bytes() == line and sha(asset["path"]) == asset["sha256"], "One-row partition differs from original bytes")
    return True


def stable_eight(observations, cutoff, cumulative):
    require(len(observations) == len({o["observedAt"] for o in observations}) == 8, "Need eight distinct observations")
    after = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
    require(all(datetime.fromisoformat(o["observedAt"].replace("Z", "+00:00")) >= after and o["cumulative"] == cumulative for o in observations),
            "Need eight stable post-cleanup observations")
    return True


def verify_cleanup_receipt(registration):
    ref = registration["assets"]["originalCleanup"]
    require(ref["sha256"] == ORIGINAL_CLEANUP_SHA and sha(ref["path"]) == ORIGINAL_CLEANUP_SHA, "Original cleanup receipt changed")
    receipt = read_json(ref["path"])
    require(receipt["originalProtocolStatus"] == "incomplete_not_ready" and receipt["sourceRuntimeCommit"] == registration["builds"]["candidate"]["lock"]["head"], "Wrong cleanup provenance")
    require(receipt["ownedProcessStates"] and all(s.get("alive") is False for s in receipt["ownedProcessStates"].values()), "Old owned process remains live")
    require(receipt["ownedPortStates"] and all(s.get("listenerPresent") is False for s in receipt["ownedPortStates"].values()), "Old owned listener remains live")
    old = receipt["originalCheckpoint"]
    require(old["untouched"] is True and sha(old["path"]) == old["sha256"], "Original orphaned ledger changed")
    values = response_ledger_values(read_json(old["path"]))
    require(values["inFlightCalls"] == old["recordedPendingCalls"] == 5 and values["reservedUsd"] == old["recordedReservedUsd"] == 1.268992, "Old orphan slots lost or changed")
    settlement = receipt["postCleanupSettlement"]
    require(settlement["sha256"] == ORIGINAL_SETTLEMENT_SHA and sha(settlement["path"]) == ORIGINAL_SETTLEMENT_SHA and settlement["AzureTokenEstimateUsd"] == CARRY_USD, "Wrong settled carry")
    # These historical observations support the carry floor, but DO NOT retire
    # the orphaned slots. An initial anchor requires eight NEW observations after
    # receipt.observedAt, which is later than this old settlement.
    actual = read_json(settlement["path"])
    require(actual["stableObservations"] == settlement["eightDistinctStableObservations"] and len(actual["stableObservations"]) == 8, "Historical settlement observations changed")
    supplemental = read_json(registration["assets"]["supplementalPidCheck"]["path"])
    require(set(supplemental["pids"]) == {"4659", "4711", "4712", "72914"} and all(s["alive"] is False for s in supplemental["pids"].values()), "Original process group/node/watcher remains live")
    require(supplemental["originalCleanup"]["sha256"] == ORIGINAL_CLEANUP_SHA and sha(supplemental["originalRecordedNodeProcess"]["path"]) == supplemental["originalRecordedNodeProcess"]["sha256"], "Supplemental PID provenance changed")
    node = read_json(registration["assets"]["ownedNodeAbsence"]["path"])
    require(node["nodePid"] == 4712 and node["alive"] is False and node["originalCleanupReceiptSha256"] == ORIGINAL_CLEANUP_SHA and
            registration["assets"]["ownedNodeAbsence"]["sha256"] == "e8592586dee1e43f5b282d786f3bc5f31d491200e1e1d903b457e57cbf044287", "Original owned node absence missing")
    return receipt


def verify_imported(registration):
    import imported_canonical
    old = original_registration(registration)
    ref = registration["assets"]["imports"]
    manifest = read_json(ref["path"])
    require(manifest["originalProtocolStatus"] == "incomplete_not_ready" and manifest["outcomes"] == 200 and len(manifest["arms"]) == 7, "Wrong imported complete-cell denominator")
    source = read_json(registration["assets"]["originalCompletedArms"]["path"])
    require(source["preregistrationSha256"] == ORIGINAL_PREREG_SHA and manifest["arms"] == source["arms"], "Changed imported cell identities")
    require(len({(a["cohort"], a["rep"], a["arm"]) for a in manifest["arms"]}) == 7 and not any(a["cohort"] == "development" and a["rep"] == 2 and a["arm"] == "candidate" for a in manifest["arms"]), "Imported replacement/prefix or duplicate cell")
    for item in manifest["arms"]:
        if not item.get("reusedImmutableMain"):
            imported_canonical.verify_canonical_cell(old, registration["originalPreregistration"]["path"], item)
    for artifact in manifest["artifacts"]:
        require(sha(artifact["path"]) == artifact["sha256"], "Imported original recording changed")
    return manifest


def verify_block_records(records, block):
    require(block["n"] == len(block["rowIds"]) == len(set(block["rowIds"])) == 1, "Wrong one-row denominator")
    return verify_records(records, block["rowIds"], 1)


def verify_preregistration(path, check_builds=True):
    path = Path(path).resolve(); registration = read_json(path)
    require(registration.get("schema") == FOLLOWUP_SCHEMA and registration["controls"] == CONTROLS, "Changed prospective controls")
    require(Path(registration["context"]).resolve() == path.parent, "Wrong prospective context")
    for asset in registration["assets"].values(): require(sha(asset["path"]) == asset["sha256"], "Frozen prospective asset changed")
    for name, helper in registration["helpers"].items(): require(sha(helper["path"]) == helper["sha256"], f"Frozen prospective helper changed: {name}")
    old = original_registration(registration, check_builds=check_builds)
    require(registration["builds"] == old["builds"] and registration["cohorts"] == old["cohorts"] and registration["readinessRule"] == old["readinessRule"] and registration["gradeSchema"] == old["gradeSchema"], "Changed runtime/source/cohort/grading identity")
    changed = {"fixedDispatchRows", "physicalDispatchBlocks"}
    require({k: v for k, v in registration["controls"].items() if k not in changed} == {k: v for k, v in old["controls"].items() if k not in changed}, "Changed runtime controls")
    require(registration["order"] == [{"cohort": "development", "rep": 2, "arm": "candidate"}], "Only one full replacement is authorized")
    require(registration["hangGuardSeconds"] == 21600 and registration["hangGuardAffectsQualityControls"] is False, "Changed non-quality full-replacement hang guard")
    require(registration["dispatchLeasePolicy"] == {"oneControllerNonce": True, "registeredBlockAndOutput": True, "actualNodePidBoundOnce": True,
             "liveControllerAndNodeIdentity": True, "heartbeatMaxAgeSeconds": 90,
             "revokeBeforeCleanupAndTerminalMarkers": True, "terminalDispatchForbidden": True}, "Changed owned dispatch lease policy")
    require(registration["totalOutcomes"] == 240 and registration["newModelOutcomes"] == 160 and registration["reusedMainOutcomes"] == 80 and registration["thisFollowupPaidOutcomes"] == 40, "Wrong unified or replacement denominator")
    require(registration["budget"] == {"realCapUsd": 20.0, "stopAtUsd": 19.5, "carryFloorUsd": CARRY_USD, "sameOriginalJobCap": True, "previousJobInformationalUsd": 25.35188}, "Wrong cumulative job cap")
    require(registration["policy"] == {"originalProtocolStatus": "incomplete_not_ready", "fullReplacementFromScratch": True, "abortedPrefixExcluded": True, "selectiveRetry": False, "furtherReplacement": False, "qualityBlindedBeforeFullCompletion": True, "effectiveRowsPerDispatch": 1, "configuredConcurrency": 3}, "Wrong follow-up/no-retry policy")
    require(registration["metrics"] == old["metrics"], "Changed deployment metric identity/poll cadence")
    require(registration["calibrationPolicy"] == {"freshIndependentJudges": 3, "referencesPerJudge": 24, "sameJudgeCalibrationAndFinal": True,
             "oldFirstStreamsUnusedAndNeverCopied": True, "noFeedbackBeforeAllFinalFirstFreezes": True,
             "referenceConsistencyIsNotHumanAccuracy": True, "sourceNaiveForkNone": True}, "Changed fresh calibration lifecycle")
    imports = read_json(registration["assets"]["imports"]["path"])
    require(registration["secondaryPlan"] == {"schema": "secondary-report-only/v1", "onlyIfFollowupAborts": True,
             "importsSha256": registration["assets"]["imports"]["sha256"], "outcomes": 200, "logicalCells": 7,
             "cells": [{k: arm[k] for k in ["cohort", "rep", "arm"]} for arm in imports["arms"]],
             "missingCell": {"cohort": "development", "rep": 2, "arm": "candidate"},
             "excludeAllOldAndNewAbortedPrefixes": True, "qualitySelection": False,
             "sameOpaqueCropDedupGradeSchemaConsensus": True, "ready": False, "prEligible": False}, "Changed prospective secondary-only scope")
    verify_partition(registration); verify_cleanup_receipt(registration)
    return registration
