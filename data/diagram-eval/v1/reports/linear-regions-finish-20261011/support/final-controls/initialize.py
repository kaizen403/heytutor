"""Offline original-counter reference; no fresh-baseline reset or API query."""
import argparse
from measurement_core import *


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True)
    a = p.parse_args(); r = verify_preregistration(a.preregistration)
    context = Path(r["context"]); directory = context / "metrics"; directory.mkdir(exist_ok=True)
    require(not (context / "execution-start.json").exists(), "Do not initialize a started follow-up")
    original = read_json(r["assets"]["originalBaseline"]["path"])
    baseline = {**original, "job": r["job"], "preregistrationSha256": sha(a.preregistration),
                "originalBaselineSha256": r["assets"]["originalBaseline"]["sha256"], "carryFloorUsd": CARRY_USD,
                "referenceOnlyNotFreshSettlement": True, "newDispatchAllowed": False}
    write_once(directory / "baseline.json", baseline)
    print(canonical({"originalCounterReferenceFrozen": True, "baselineSha256": sha(directory / "baseline.json"),
                     "carryFloorUsd": CARRY_USD, "modelCalls": 0, "metricsQueries": 0,
                     "requiresEightNewPostCleanupObservationsBeforeDispatch": True}))


if __name__ == "__main__": main()
