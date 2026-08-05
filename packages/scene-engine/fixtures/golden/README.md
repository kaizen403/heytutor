# Golden corpus (Verified Diagram Engine v3)

Semantic fixtures for JEE Physics/Math diagram accuracy. Expectations are
structural (entities, topology predicates, quantities), not screenshot-only.

| Fixture | Locks |
|---------|--------|
| `circuit-series-parallel-12ohm.json` | Series path of 3 resistors; parallel `sameTerminalPair` + `pathCount=3`; quantities `36 ohm` / `4 ohm`; bypass mutation fails |
| `optics-concave-mirror-u20-f15.json` | TurnPlan scalars `f=15`, `u=20`, `v=60`, `m=-3`; inverted/farther claims |

Run: `pnpm --filter @heytutor/scene-engine verify:golden`
