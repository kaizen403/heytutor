# Packet log: C-12 / coordination-20261009

Ownership, 2026-10-09, before the first edit: this session owns the coordination naming, Werner, application, and ionisation-ligand additions:

- `packages/scene-engine/src/chemistry/coordination.ts`
- `packages/scene-engine/src/chemistry/coordinationAccounts.ts` (new)
- `packages/scene-engine/src/chemistry/formula.ts` (one ligand, sulfato, with no spectrochemical rank)
- `packages/scene-engine/src/chemistry/crystalField.ts` (decline a ligand whose field is not ranked)
- `packages/scene-engine/scripts/verify/verify-c12-coordination.ts` (new)

Geometry, isomer enumeration, and crystal-field occupancy stay in the existing builders. This log does not accept any row.

## Gates

2026-10-09, `packages/scene-engine`: `verify-c12-coordination: ok`. Family and subject gates passed in the same run as C-10. `pnpm exec tsc --noEmit` passed. Rows stay unaccepted.
