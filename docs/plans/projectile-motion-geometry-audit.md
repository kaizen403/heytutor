# Projectile motion geometry — recorded Kimi audit

Frozen base: `f781732bee9d7d054763170eadb16b2580bda8e7` (20 October 2026). Offline only; paid model/TTS spend $0. No fallback policy is enabled. No accepted syllabus counters change.

A named launch velocity could be independent of the analytic trajectory. In the recorded range reproduction, the path leaves with slope 1, while the velocity has slope 1/2. Both constructions compiled, so a physically inconsistent figure was drawn. The existing `projectile_trajectory` operator already derives a tangent launch velocity, but it exposed no range or height measurement outputs.

## Changes

- An unconditional compiler truth check binds a declared launch velocity to a unique trajectory endpoint and its analytic tangent, directed into the flight. A second unrelated trajectory cannot disable the check; ambiguous bindings fail closed. Typed time trajectories retain forward-time direction. The atomic projectile operator retains its own explicit path/velocity association.
- `projectile_trajectory` keeps its two-output form. The optional `showMeasurements:true` form requires four ordered outputs: trajectory, launch velocity, horizontal range dimension, height dimension. These are computed from the same landing time and flight interval, with no new physical defaults.
- `heightReference:"level_ground"` (default) measures **H above level ground**, including an initial tower height, and requires a level landing line. `heightReference:"launch"` measures **Δh above launch**; on an incline it uses the maximum reached before landing, even when landing precedes the free-flight apex. Range is a magnitude, not signed displacement.
- True zero measurements are point markers. Exact cardinal angles have exact zero components. Nonzero components or measurements that underflow are refused, as are nonzero dimensions that collapse at the rendered scale.
- Entity labels, declared height roles and attached ink text cannot rename H, Δh or R. This applies with `verified_parts` enabled, and to replacing/appended labels, callouts, braces and truncated/split badge or polarity text. Narration remains separate.
- Generated measurement values are audited against same-symbol numerical plan givens/derived quantities using the existing unit agreement rules. Both candidate validation and the shared live/server save boundary run this check; stale plan H/R values cannot accompany these generated measurements.
- The planner contract exposes the new inputs/output order and height reference, stops advertising the unsupported `units` block, and directs an illustrative analytic path to derive its launch arrow from a tangent rather than guess an independent direction. Source-backed numeric inputs remain required; symbolic derivations receive no invented speed or angle.

Synthetic example of the new operator inputs:

```json
{
  "speed": 20,
  "launchAngleDeg": 45,
  "gravity": 10,
  "displayScale": 1,
  "showMeasurements": true,
  "heightReference": "level_ground"
}
```

Declare four outputs with kinds `polyline`, `vector`, `dimension`, `dimension`; the measurement labels are `R` and `H` (or `Δh` for the launch reference). The operator provides measurements, not the terrain surface. The incline fixture remains partial because its caller omits that surface.

## Recorded evidence

The physics inventory contains 703 byte-distinct recorded Kimi-era rows across all 20 physics units. This packet extracts 45 provenance observations / **38 unique raw candidate payloads**: nine explicit Kimi Fast projectile scenes, 16 other motion payloads and 13 unrelated curve controls. Older Kimi/mixed-model evidence stays labelled separately. The nine Fast scenes comprise a fwcheck lesson and two scene trials of one independently planned range reproduction. Five use independent curves/vectors; four use the typed projectile operator. No raw candidate from the original production failure survives persistence.

| Replay | Main | Branch | Change |
|---|---:|---:|---|
| Candidate probes: 38 unique payloads valid | 13 | 12 | Known non-tangent range candidate refused |
| Candidate probes drawn | 12 | 11 | Same single wrong figure removed |
| Full retained-input selections drawn (88 replays) | 15 | 14 | One wrong → empty; 14 byte-identical |
| New / changed recorded figures | — | 0 / 0 | No recorded right-yield gain claimed |

The full selection manifest inventories 903 rows, of which 88 retain complete selection inputs (83 strict). All 88 replayed with zero errors. Missing inputs remain missing: among 367 strict records, 283 legacy summaries plus one production plan-only case cannot be fully replayed. Supplemental captured-plan candidate probes are not promoted into complete production selections.

The changed recorded candidate is blind **wrong**. The retained independent-curve projectile control is blind **right** and unchanged. Every other existing admitted figure is byte-identical. The four recorded typed attempts still fail other existing checks, including relation IDs, launch label and the redundant units block; this patch does not rewrite recorded model responses or claim to recover them.

## Blind checks of the new API

All six synthetic four-output fixtures fail the old operator contract and pass the new production candidate/selection/save admission. These are API fixtures, not new model-generated lessons.

| Synthetic geometry | Verdict |
|---|---|
| Level-ground oblique flight, R and H | Right |
| Vertical flight with zero R | Right |
| Horizontal tower flight with zero Δh | Right |
| Elevated oblique flight, rise Δh above launch | Right |
| Elevated oblique flight, H above level ground | Right |
| Inclined landing, R and Δh | Partial: landing incline omitted |

New API figures: **5 right, 1 partial, 0 wrong**. Questions and cropped images were shuffled under opaque IDs. The judge saw neither code nor old/new mappings. Final renders match the judged primitives. No new wrong recorded figure; one previously wrong figure is refused. This is not evidence that a general deterministic physics fallback is safe.

## Validation and limits

Feature-owned gates: engine geometry 52, planner contract 33, admission/persistence 81 (**166 checks**). They cover tangent/reversed/displaced/multiple/time-directed launches; cardinal and underflow precision; translated/scaled/tower/incline measurements; unit conversion; output count; both label policies and annotation replacements; stale plan values; equivalent plan units; server canonicalization and byte-identical reopen. The initial tangent reproduction fails on base before the fix. Gates are registered in feature files, without changing another session's gate.

Also pass: existing projectile units 126 and chapter operators 80; production selection, projectile literal 804, candidate parity, lab production profile, real HTTP save/reopen; engine/core builds; engine/core/tutor typechecks; targeted lint; gate-runner tests and registration.

Two broader checks remain red:

- `verify-live-save-parity`: the `ladder-default-angle` expectation fails identically on frozen main and branch.
- `verify-scene-planner-v2`: compact repair request exceeds the unchanged 27,000-character test cap on main (27,263) and branch (27,746). The new contract adds 483 characters. No threshold was weakened; a live planner quality/yield comparison was not run under the $0 limit.

Private, ignored evidence: `.context/h4/projectile-motion-20/` contains the provenance manifest and raw snapshots, candidate main/branch probes, `selection-validated/` checkpoints and identity, `final-summary.json`, two blind queues/maps/verdict sets, synthetic old/new probes, source hashes, and gate/build/type/lint logs. Source text and images are not committed.

## Separate fallback result and ownership

The retained production plan does generate a right deterministic projectile figure when strict source permission is lifted. Original failed candidate/IR/solver artifacts were not retained, so this is a plan-only probe, not a reproduction of those original assertion failures. Across recorded strict rows, adding the required archetype source still admits seven wrong rows (five unique); broad deterministic permission admits nine wrong rows (seven unique). Neither physics allowance is shipped.

The coordinator's 15:00 decision stopped the separate maths-only flag. Its unpushed experimental patch and measurements were handed to the always-a-figure lane, which owns `DIAGRAM_FLOOR_FIGURE`. Existing #234 is untouched, and #206 stays an unchanged draft. This PR changes projectile geometry/contracts and authority checks only.
