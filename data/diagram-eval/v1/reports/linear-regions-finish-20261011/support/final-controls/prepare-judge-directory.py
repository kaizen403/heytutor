"""Copy only neutral cards/instructions into a fresh grader directory; no pixel inspection."""
import argparse
import shutil
from pathlib import Path
from measurement_core import *


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--packet", required=True); parser.add_argument("--out", required=True)
    args = parser.parse_args(); packet = Path(args.packet).resolve(); out = Path(args.out).resolve()
    require(not out.exists(), "Fresh neutral grader directory must not exist")
    frozen = read_json(packet / "freeze.json"); require(sha(packet / "queue.jsonl") == frozen["queueSha256"], "Neutral queue changed")
    queue = read_jsonl(packet / "queue.jsonl"); require(len(queue) == frozen["cards"], "Incomplete neutral queue")
    out.mkdir(parents=True); images = out / "images"; images.mkdir()
    for card in queue:
        source = Path(card["cropped_png"]); require(sha(source) == card["figureSha256"], "Frozen image changed")
        target = images / f"{card['id']}.png"; shutil.copy2(source, target); card["cropped_png"] = str(target)
    write_once(out / "queue.jsonl", ''.join(canonical(c) + '\n' for c in queue).encode())
    shutil.copy2(Path(__file__).resolve().parent / "judge-instructions.md", out / "INSTRUCTIONS.md")
    print(canonical({"directory": str(out), "cards": len(queue), "queueSha256": sha(out / "queue.jsonl"), "imagesViewed": 0,
                     "parentMapsCopied": False, "modelCalls": 0}))


if __name__ == "__main__": main()
