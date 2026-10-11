#!/usr/bin/env python3
"""Copy a pinned, role-allowlisted plan into a new immutable portable archive after all first freezes."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile
from recount import (SCHEMA, REQUIRED_ROLES, SUPPORT_ROLES, GRADE_SCHEMA, digest, local_path,
                     read_json, require, sha, text_value, verify_bundle)

PLAN_SCHEMA = "finish-regions-portable-assembly-plan/v1"
FORBIDDEN_NAMES = {".env", ".env.local", ".env.production", "credentials.json", "secrets.json"}


def assemble(plan_path, destination, all_first_streams_frozen=False):
    require(all_first_streams_frozen, "Root must release all three independent first freezes before assembly")
    plan = read_json(plan_path)
    require(plan.get("schema") == PLAN_SCHEMA and set(plan) == {"schema", "manifest", "files"}, "Wrong assembly plan")
    metadata = plan["manifest"]
    require(isinstance(metadata, dict) and metadata.get("schema") == SCHEMA and "files" not in metadata, "Invalid manifest metadata")
    require(isinstance(plan["files"], list), "Missing copy plan")
    entries, by_role, portable_names, source_names = [], {}, set(), set()
    for source in plan["files"]:
        require(isinstance(source, dict) and set(source) == {"path", "role", "sourcePath", "sha256"}, "Invalid planned file")
        role, name = source["role"], source["path"]
        require(role in REQUIRED_ROLES | SUPPORT_ROLES, "Unapproved archive role; raw datasets/runs/env are excluded")
        original = Path(text_value(source["sourcePath"], "sourcePath"))
        require(original.is_absolute() and original.is_file() and not original.is_symlink(), "Missing/nonabsolute/symlink source file")
        require(original.name not in FORBIDDEN_NAMES and not original.name.startswith(".env."), "Credentials/environment file excluded")
        require(name not in portable_names and str(original) not in source_names, "Duplicate assembly path/provenance")
        portable_names.add(name); source_names.add(str(original))
        require(original.stat().st_size <= (10_000_000 if role == "image" else 4_000_000), "Oversized evidence; exclude private raw bodies")
        expected = digest(source["sha256"], name)
        require(sha(original) == expected, "Pinned assembly source changed")
        entries.append({"path": name, "role": role, "sha256": expected, "bytes": original.stat().st_size,
                        "sourcePath": str(original), "sourceSha256": expected})
        by_role.setdefault(role, []).append((source, original))
    require(REQUIRED_ROLES <= set(by_role), "Missing required planned evidence")
    for role in REQUIRED_ROLES:
        require(len(by_role[role]) == 1, "Duplicate required role in plan")
    # Verify all first-freeze metadata before copying any quality stream.
    firsts = {j: read_json(by_role[f"firstFreeze-{j}"][0][1]) for j in ("a", "b", "c")}
    identities = []
    for judge, first in firsts.items():
        grade, identity = by_role[f"grade-{judge}"][0], by_role[f"identity-{judge}"][0]
        require(first["gradeSchema"] == GRADE_SCHEMA and first["gradePath"] == str(grade[1])
                and first["gradeSha256"] == grade[0]["sha256"] and first["identityPath"] == str(identity[1])
                and first["identitySha256"] == identity[0]["sha256"], "First-freeze copy binding changed")
        identities.append(text_value(first["agentIdentity"], "independent identity"))
    require(len(set(identities)) == 3 and len({f["queueSha256"] for f in firsts.values()}) == 1, "Independent first-freeze identity changed")
    destination = Path(destination).resolve()
    require(not destination.exists(), "Immutable archive destination already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{destination.name}-assembly-", dir=destination.parent))
    try:
        for entry in entries:
            target = local_path(temporary, entry["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry["sourcePath"], target)
            require(sha(target) == entry["sha256"], "Source changed during copy")
        manifest = {**metadata, "files": sorted(entries, key=lambda e: e["path"])}
        manifest_path = temporary / "evidence-manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        manifest_sha = sha(manifest_path)
        (temporary / "evidence-manifest.sha256").write_text(manifest_sha + "  evidence-manifest.json\n", encoding="utf-8")
        verify_bundle(temporary, manifest_sha)
        temporary.rename(destination)
    except BaseException:
        shutil.rmtree(temporary)
        raise
    return {"archive": str(destination), "manifestSha256": manifest_sha, "files": len(entries),
            "mode": metadata["mode"], "allRowOutcomes": metadata["totalOutcomes"], "imageViews": 0, "apiCalls": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--all-first-streams-frozen", action="store_true", required=True)
    args = parser.parse_args()
    print(json.dumps(assemble(args.plan, args.out, args.all_first_streams_frozen), sort_keys=True, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, IndexError) as error:
        print(f"Archive assembly rejected: {error}", file=sys.stderr)
        sys.exit(1)
