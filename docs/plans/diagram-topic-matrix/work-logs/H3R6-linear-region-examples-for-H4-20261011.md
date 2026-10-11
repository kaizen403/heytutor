# Linear-region examples for Harness 4

Harness 3 owns the four exact operators; Harness 4 owns example-library additions. This generic list was delivered separately from the frozen eval. Add independent numbers in a later library change: both measurement builds used identical existing examples.

| Operator | Examples to add |
| --- | --- |
| `number_line_set` | Open/closed rays; mixed bounded interval; disjoint union; intersection; complement/punctured line; singleton; empty and all-real sets. |
| `linear_half_plane` | Weak/strict oblique boundaries; negative coefficients; vertical and horizontal boundaries. The engine derives the shaded side. |
| `linear_feasible_region` | Bounded rational corners with every corner labelled and evaluated; unique optimum; multiple-optimum edge. |
| `linear_feasible_region` | Unbounded feasible region with finite attained optimum; unbounded objective; unattained strict limit; infeasible system. Display-window corners must not become mathematical vertices. |
| `linear_system` | Unique rational intersection; distinct parallel lines; coincident equations sharing one geometric line with both original labels. |

Supply original expressions, variable names and optional display window only. Copy every source constraint and objective/direction; nonnegativity must be explicit. Do not supply solved corners, points, shading, optima or derived annotations. Each construction outputs one `linear_region` entity; the engine supplies every visible mark and label. Prefer omitted view for engine fitting. Full and compact contracts are in `packages/tutor-core/src/planners/scenePlannerV2Prompt.ts`.

The held-out experiment passes its right/wrong gate but has poor source admission and planner adoption: no selected paid document uses `linear_system`, and candidate draws only 13/40 and 15/40. This handoff is a library request, not a measured claim that examples will fix that limitation. H4 requests #39–42 remain diagnosed in the physics report; this family does not fix 3D projection or Argand reference extraction.
