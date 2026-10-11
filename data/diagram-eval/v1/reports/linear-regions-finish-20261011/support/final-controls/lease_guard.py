"""Controller-owned single-block lease, bound to the actual wrapper/node PID."""
import argparse
import os
import secrets
import subprocess
from measurement_core import *


def process_identity(pid):
    require(isinstance(pid, int) and not isinstance(pid, bool) and pid > 0, "Invalid owned PID")
    result = subprocess.run(["ps", "-p", str(pid), "-o", "pid=,ppid=,pgid=,lstart="], capture_output=True, text=True)
    require(result.returncode in [0, 1], "Owned process identity unavailable")
    words = result.stdout.split()
    if not words: return None
    require(len(words) >= 8 and int(words[0]) == pid, "Malformed owned process identity")
    return {"pid": pid, "ppid": int(words[1]), "pgid": int(words[2]), "started": " ".join(words[3:])}


def ref(path): return {"path": str(Path(path).resolve()), "sha256": sha(path)}


def load_ref(value):
    require(sha(value["path"]) == value["sha256"], "Lease/execution identity file changed")
    return read_json(value["path"])


def assert_nonterminal(context):
    require(not (context / "whole-arm-abort.json").exists() and not (context / "all-arms-complete.json").exists() and not (context / "dispatch-stop.json").exists(), "Terminal protocol cannot dispatch")


def execution_identity(registration, prereg_path):
    context = Path(registration["context"])
    require(Path(prereg_path).resolve() == context / "preregistration.json", "Dispatch lease requires final frozen preregistration")
    assert_nonterminal(context)
    start_path = context / "execution-start.json"; start = read_json(start_path)
    require(start["preregistrationSha256"] == sha(prereg_path) and start["oneFullReplacementOnly"] is True, "Wrong execution-start identity")
    controller = start["controllerIdentity"]
    require(process_identity(controller["pid"]) == controller and start.get("controllerNonce"), "Owned controller dead or identity changed")
    return start_path, start


def create_lease(registration, prereg_path, block):
    context = Path(registration["context"]); start_path, start = execution_identity(registration, prereg_path)
    require(start["controllerIdentity"]["pid"] == os.getpid(), "Only the owning controller may launch a lease")
    require(block in registration["dispatchBlocks"], "Unregistered lease block")
    completed = read_json(context / "completed-blocks.json")["blocks"]
    require([e["block"] for e in completed] == registration["dispatchBlocks"][:block["block"] - 1], "Lease cannot skip, duplicate or resume a block")
    active_path = context / "active-lease.json"
    if active_path.exists(): require(read_json(active_path)["state"] in ["consumed", "revoked"], "Another wrapper/block is already leased")
    directory = context / "leases" / block["label"]
    require(not directory.exists(), "Lease already exists; no row retry")
    proposal = {"schema": "h3r8-one-row-dispatch-lease/v1", "at": utc_now(), "block": block, "preregistrationSha256": sha(prereg_path),
                "executionStart": ref(start_path), "controllerIdentity": start["controllerIdentity"], "controllerNonce": start["controllerNonce"],
                "launchNonce": secrets.token_hex(32)}
    write_once(directory / "proposal.json", proposal)
    atomic_json(active_path, {"state": "launching", "updatedAt": utc_now(), "proposal": ref(directory / "proposal.json"), "launch": None, "binding": None})
    return proposal


def publish_launch(registration, block, pid):
    context = Path(registration["context"]); pointer = read_json(context / "active-lease.json"); proposal = load_ref(pointer["proposal"])
    require(pointer["state"] == "launching" and proposal["block"] == block and proposal["controllerIdentity"]["pid"] == os.getpid(), "Wrong controller launch lease")
    identity = process_identity(pid); require(identity is not None and identity["pgid"] == pid and identity["ppid"] == os.getpid(), "Owned tsx launch PID/group mismatch")
    path = context / "leases" / block["label"] / "launch.json"
    write_once(path, {"at": utc_now(), "proposal": pointer["proposal"], "launchIdentity": identity})
    atomic_json(context / "active-lease.json", {**pointer, "updatedAt": utc_now(), "launch": ref(path)})


def validate_launch(registration, prereg_path, checkpoint, wrapper_pid, nonce, require_bound=False):
    context = Path(registration["context"]); start_path, start = execution_identity(registration, prereg_path)
    pointer = read_json(context / "active-lease.json")
    require(pointer["state"] == ("active" if require_bound else "launching"), "Lease is released, consumed, revoked or wrong phase")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(pointer["updatedAt"].replace("Z", "+00:00"))).total_seconds()
    require(-5 <= age <= 90, "Dispatch lease heartbeat stale")
    proposal = load_ref(pointer["proposal"])
    require(proposal["preregistrationSha256"] == sha(prereg_path) and proposal["executionStart"] == ref(start_path) and
            proposal["controllerIdentity"] == start["controllerIdentity"] and proposal["controllerNonce"] == start["controllerNonce"] and proposal["launchNonce"] == nonce,
            "Foreign lease/controller/nonce identity")
    block = proposal["block"]
    require(block in registration["dispatchBlocks"] and Path(checkpoint).resolve() == Path(block["out"]) / "spend-checkpoint.json", "Lease block/output mismatch")
    directory = context / "leases" / block["label"]
    require(Path(pointer["proposal"]["path"]).resolve() == directory / "proposal.json" and not (directory / "revocation.json").exists(), "Foreign or revoked lease receipt")
    launch = load_ref(pointer["launch"])
    require(launch["proposal"] == pointer["proposal"] and process_identity(launch["launchIdentity"]["pid"]) == launch["launchIdentity"], "Owned launch PID dead or changed")
    wrapper = process_identity(wrapper_pid)
    require(wrapper is not None and wrapper["pgid"] == launch["launchIdentity"]["pgid"], "Actual wrapper PID dead or outside owned group")
    ancestor = wrapper; seen = set()
    for _ in range(8):
        if ancestor["pid"] == launch["launchIdentity"]["pid"]: break
        require(ancestor["pid"] not in seen and ancestor["ppid"] > 0, "Invalid wrapper ancestry")
        seen.add(ancestor["pid"]); ancestor = process_identity(ancestor["ppid"])
        require(ancestor is not None, "Wrapper ancestry disappeared")
    require(ancestor["pid"] == launch["launchIdentity"]["pid"], "Foreign actual wrapper PID")
    if require_bound:
        binding = load_ref(pointer["binding"])
        require(binding["proposal"] == pointer["proposal"] and binding["launch"] == pointer["launch"] and binding["wrapperIdentity"] == wrapper, "Wrapper binding changed or another wrapper is dispatching")
    return pointer, proposal, wrapper


def bind_wrapper(registration, prereg_path, checkpoint, wrapper_pid, nonce):
    require(os.getppid() == wrapper_pid, "Binding helper was not called by the actual wrapper")
    pointer, proposal, wrapper = validate_launch(registration, prereg_path, checkpoint, wrapper_pid, nonce)
    path = Path(registration["context"]) / "leases" / proposal["block"]["label"] / "binding.json"
    require(not path.exists(), "Duplicate simultaneous wrapper binding")
    write_once(path, {"at": utc_now(), "proposal": pointer["proposal"], "launch": pointer["launch"], "wrapperIdentity": wrapper})
    return {"bound": True, "binding": ref(path), "wrapperPid": wrapper_pid}


def activate_lease(registration, prereg_path, block):
    context = Path(registration["context"]); pointer = read_json(context / "active-lease.json"); proposal = load_ref(pointer["proposal"])
    require(proposal["controllerIdentity"]["pid"] == os.getpid(), "Only owning controller can activate")
    path = context / "leases" / block["label"] / "binding.json"; binding = read_json(path)
    validate_launch(registration, prereg_path, Path(block["out"]) / "spend-checkpoint.json", binding["wrapperIdentity"]["pid"], proposal["launchNonce"])
    require(binding["proposal"] == pointer["proposal"] and binding["launch"] == pointer["launch"], "Wrong claimed wrapper binding")
    atomic_json(context / "active-lease.json", {**pointer, "state": "active", "updatedAt": utc_now(), "binding": ref(path)})


def heartbeat(registration):
    path = Path(registration["context"]) / "active-lease.json"; pointer = read_json(path); proposal = load_ref(pointer["proposal"])
    require(proposal["controllerIdentity"]["pid"] == os.getpid() and pointer["state"] == "active", "Cannot renew foreign/released lease")
    atomic_json(path, {**pointer, "updatedAt": utc_now()})


def revoke(registration, reason, success=False):
    context = Path(registration["context"]); path = context / "active-lease.json"
    if not path.exists(): return
    pointer = read_json(path)
    if pointer["state"] in ["consumed", "revoked"]: return
    proposal = load_ref(pointer["proposal"])
    require(proposal["controllerIdentity"]["pid"] == os.getpid(), "Only owning controller may revoke")
    target = context / "leases" / proposal["block"]["label"] / "revocation.json"
    state = "consumed" if success else "revoked"
    write_once(target, {"at": utc_now(), "state": state, "reason": reason, "proposal": pointer["proposal"], "launch": pointer["launch"], "binding": pointer["binding"], "beforeOwnedCleanup": True})
    atomic_json(path, {**pointer, "state": state, "updatedAt": utc_now(), "revocation": ref(target)})


def verify_request_lease(registration, prereg_path, checkpoint, wrapper_pid, nonce):
    require(os.getppid() == wrapper_pid, "Request guard was not called by bound wrapper")
    return validate_launch(registration, prereg_path, checkpoint, wrapper_pid, nonce, require_bound=True)


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument("--preregistration", required=True); p.add_argument("--checkpoint", required=True)
    p.add_argument("--wrapper-pid", required=True, type=int); p.add_argument("--nonce", required=True); p.add_argument("--bind-wrapper", action="store_true")
    a = p.parse_args(); r = verify_preregistration(a.preregistration, check_builds=False)
    require(a.bind_wrapper, "Lease helper accepts only owned wrapper binding")
    print(canonical(bind_wrapper(r, a.preregistration, a.checkpoint, a.wrapper_pid, a.nonce)))


if __name__ == "__main__": main()
