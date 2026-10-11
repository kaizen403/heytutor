"""No rendering: all forty replacement blocks and eight unified logical cells."""
import argparse
from measurement_core import *
from canonical_evidence import verify_completed_evidence


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True)
    a = p.parse_args(); r = verify_preregistration(a.preregistration, check_builds=False); context = Path(r["context"])
    full = read_json(context / "all-arms-complete.json")
    arms_path, blocks_path = context / "completed-arms.json", context / "completed-blocks.json"
    require(full["preregistrationSha256"] == sha(a.preregistration) and full["completedSha256"] == sha(arms_path) and
            full["completedBlocksSha256"] == sha(blocks_path) and full["physicalDispatchBlocks"] == 40 and
            full["originalProtocolStatus"] == "incomplete_not_ready" and full["abortedPrefixExcluded"] is True, "Changed prospective completion identity")
    arms, blocks = read_json(arms_path), read_json(blocks_path)
    require(arms["preregistrationSha256"] == blocks["preregistrationSha256"] == sha(a.preregistration), "Foreign completed evidence")
    verify_completed_evidence(r, a.preregistration, arms["arms"], blocks["blocks"])
    print(canonical({"complete": True, "physicalDispatchBlocks": 40, "logicalCells": 8, "outcomes": 240, "modelCalls": 0}))


if __name__ == "__main__": main()
