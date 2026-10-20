# Agent PR integration, 20 October 2026

Owner-authorized integration of #195, #215, #216, #218, #231, #233 and #238. All original PR heads are preserved as ancestors; no rebase or force push. This records the integrated code's verification, not a fresh live coverage measurement.

## Review and resolutions

- Rotation origin normalization retains main's verified-circular-parts authority policy and the regenerated complete-program comparison.
- Circuit count diagnostics retain #231's measured node/path witnesses and #238's separate load-count interface. Strict-path diagnostic fixtures omit the independent fatal load proof; a separate compiler case verifies bounded legacy compatibility and both recorded counts.
- #233's review finding is fixed on its own branch: explicit angle quantity IDs use exact-ID lookup instead of another quantity's physical symbol. Six actual compiler regressions were added (31 total); reverting the fix restores the wrong angle value.
- The later #215 review exposed a live admission regression: proof-based planner guidance had also removed the old inventory-based series-chain veto. A separate conservative demand helper now ORs the exact old inventory rule with explicit multi-loop evidence, including when a one-loop or malformed graph conflicts. The private production-selector counterexample again returns `picture_demand_unmet` rather than selecting the wrong chain. New gate28, existing guidance25 and an independent896-case veto matrix pass; a mutation restoring proof-only demand fails. The source fix is also pushed to #215.
- Integration uncovered a quantity-label priority interaction between #233 and #238. The count guard now checks every matching alias for unproved physical ink. A benign first ID cannot hide a polarity or numeric label selected by symbol preference. Normalized compiler regressions cover loads and sources, both inventory orders, identity-only positives and unlabelled numeric quantities. Restoring first-match lookup reproduces the false polarity label and fails the gate.
- Independent review found no remaining material integration findings. #195's 180 library documents compile and its 44 curated physics documents match the runtime library. Its incomplete earlier paid comparison still does not establish improved live coverage.

## Verification

Engine/core serialized builds, engine/core/tutor typechecks and engine/core lint pass (five existing lint warnings). Owned gates: topology demand28, guidance25, origin47, rotation aliases90, topology feedback42, component/angle bindings31, parallel count453; existing UCM399 and rotation526 pass. Turn retry, capability transport, reusable capability, diagram-evaluation, scene-engine smoke, golden corpus, structure-driven and space-view gates pass. Independent review also exercised the circular-parts authority gate.

All 1,709 circuit results exactly match the reviewed #233 admission/fatal-code/full-render results. All 54 Kimi Fast production validation/selection results exactly match reviewed #238, retaining 21 valid and 14 selected candidate outcomes. Thus the integration introduces no additional rendered variant needing an image judgment; the existing exact-hash blind evidence remains applicable. Recorded questions, identifiers, payloads, images and keys remain ignored/private.

Known existing test limit: the unscoped planner repair-size check exceeds 27,000 characters on main (27,263) and #238 (27,611). No threshold was raised; scoped circuit request/repair budgets pass. No full-suite pass or full-chapter coverage claim.

## Excluded unsafe work

#188 remains excluded: confirmed projectile and mirror binding bugs, telemetry/type conflicts, and deployment-launcher/memory/retention prerequisites remain unresolved. #212 remains excluded: a right figure is still lost and wrong gains remain. Its sound retry/topology changes are already extracted into #215. Neither defect is made safe by merging the other PRs.

No paid calls or manual production changes were made for this integration. Merging into main follows the repository's normal deployment workflow.
