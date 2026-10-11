"""Copy immutable calibration references into a fresh grading packet, never old grade files."""
import argparse
import shutil
from pathlib import Path
from measurement_core import *


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True); p.add_argument("--out", required=True)
    args = p.parse_args(); registration = verify_preregistration(args.preregistration, check_builds=False)
    out = Path(args.out).resolve(); require(not out.exists(), "Fresh calibration packet must not exist")
    source_freeze = registration["assets"]["calibrationPacket"]
    original = read_json(source_freeze["path"])
    rows = read_jsonl(registration["assets"]["calibrationQueue"]["path"])
    require(len(rows) == 24 and len({c["id"] for c in rows}) == 24, "Incomplete calibration references")
    images = out / "images"; images.mkdir(parents=True)
    for card in rows:
        source = Path(card["cropped_png"]); require(sha(source) == card["figureSha256"], "Original calibration image changed")
        target = images / f"{card['id']}.png"; shutil.copy2(source, target); card["cropped_png"] = str(target)
    queue = out / "queue.jsonl"; write_once(queue, ''.join(canonical(row) + '\n' for row in rows).encode())
    shutil.copy2(Path(__file__).resolve().parent / "judge-instructions.md", out / "INSTRUCTIONS.md")
    frozen = {**original, "createdAt": utc_now(), "queueSha256": sha(queue),
              "originalPacketFreezeSha256": source_freeze["sha256"],
              "originalQueueSha256": registration["assets"]["calibrationQueue"]["sha256"],
              "freshGraderPacket": True, "copiedOldGrades": False,
              "reuse": "Same immutable synthetic math/rubrics/native PNGs; new packet paths and fresh independent calibration grades. No new-runtime compilation claim."}
    write_once(out / "freeze.json", frozen)
    print(canonical({"packet": str(out), "cards": 24, "queueSha256": sha(queue), "freezeSha256": sha(out / "freeze.json"),
                     "oldGradesCopied": False, "modelCalls": 0, "serverStarts": 0, "imagesViewed": 0}))


if __name__ == "__main__": main()
