# Nonpaid settlement control repair

The controller changes one allowlist line in `settle_after_arm`. It now waits only for the two errors emitted by the actual unchanged `measurement_core.stable_eight`: `Need eight distinct observations` and `Need eight stable post-cleanup observations`. The three replaced strings have no current producer in `budget_guard.capture_anchor` or `stable_eight`.

`capture_anchor` still requires eight distinct stable observations at or after the new cleanup cutoff, no positive live reservation, valid fresh original-job metrics, and matching latest/history/baseline provenance before writing an anchor. Its current provenance failure, `Wrong settled watch observations`, remains immediately fatal. Admission cap, terminal markers, lease handling, cleanup,900-second settlement limit and21600-second logical hang guard are unchanged.

`test_settlement_transition.py` passes13 synthetic tests. Both initial and between-row tests execute the actual controller loop, `capture_anchor`, `stable_eight`, fresh metric validation, ledger accounting and anchor writing. They begin with eight excluded older observations and zero new observations, advance through1..7 new observations, introduce a delayed cumulative increment at observation8, then settle only when observations8..15 supply eight matching new observations. Synthetic initial cleanup provenance is stubbed; every file is temporary. The between-row test preserves the earlier orphan reconciliation receipt unchanged.

Fatal checks cover positive live reservations, unreadable metrics, invalid cap identity, negative counters, settled-watch provenance mismatch, unrecognized/obsolete errors (including lease errors), admission exposure at19.50, and terminal dispatch stop. Separate checks enforce the unchanged900-second and21600-second boundaries.

The actual `main` -> `execute_block` -> `Popen` path also passes an absolute preregistration argument unchanged into a real synthetic Python child with a different private cwd. The child successfully reads that absolute synthetic file. Server, budget, lease, evidence and settlement controls are stubbed only in this path-propagation test; the real provider command is intercepted and never executed. The controller still propagates the caller's raw path, so root's launch must supply an absolute argument. No additional path-normalization change was made.

Validation command:

```sh
python3 -m unittest discover -s .context/h3r8/finish-regions/followup-settlement-repaired -p test_settlement_transition.py -v
```

An additional in-memory regression probe substituted the original obsolete allowlist without changing any source file. Both actual capture transition tests then failed immediately with `Need eight distinct observations`, as expected. This demonstrates that the new tests detect the original defect.

Changed SHA-256:

- `eight-cell-controller.py`: `b49f1003b55ab32c6d57753da0c4ca1a0cb31f511a5c621661d0eec366e9dd55`
- `test_settlement_transition.py`: `623a7321746f6f7405c792ff1fe019f6d8f62160a6da61b907ba6e1125f56ac2`

Hash comparison over the26 preexisting `.py`/`.mjs`/`.ts` files found only the permitted controller change. In particular, unchanged `measurement_core.py` is `19127fe767579eafb34e3bc38057a3590969e89e2fc33f1aad2c0f49b4592613`, and unchanged `budget_guard.py` is `105028f3420de5ddd0a138ab7e07ea2c18ab123dccc4b196c723ba6db6da5e82`.

This work made zero provider/API/network calls and read no question bodies, images, recorded quality outcomes, grade streams or gold. It makes no readiness claim and grants no paid execution authority. Root must preregister the control amendment and freeze the updated hashes before any model calls. No remaining blocker was found within this repair scope; this worker is quiescent.
