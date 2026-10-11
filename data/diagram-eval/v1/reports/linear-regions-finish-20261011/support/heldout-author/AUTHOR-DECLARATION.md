# Independent held-out author declaration

These 20 mathematical inputs, their numbers, and their wording were authored
independently for this packet. They are not transformed old eval rows or questions
copied from an existing dataset. Authoring used the parent-provided field schema
only. The author did not inspect runtime source, runtime changes, old eval rows,
old figures or grades, `.context/h3r6`, `.context/h3r7`, implementation agents,
or user history. The only initial schema discovery attempted was the nonexistent
`tools/diagram-eval` schema/config path; no files were read there. No runtime source
or dataset was needed or imported.

The packet contains exactly 20 required maths figures, with five cases each of
`number_line`, `half_plane`, `feasible_region`, and `linear_system`, and ten
`topic_ask` / ten `exam_stem` asks. Curricula are CBSE class 11 inequalities,
CBSE class 12 linear programming, and SAT inequalities/systems. Supplemental ids
are not accepted-topic-ledger entries or syllabus coverage completion claims.

Every domain and Boolean operation is explicit. There are no integer optimisation
domains. Number-line rays, endpoint inclusion, conjunction, inclusive disjunction,
set difference, and singleton solutions are exact. Half-planes include oblique,
vertical, horizontal, strict, negative-scaled, and variables-on-both-sides cases.
Polygons include exact rational corners, every corner's objective value, unique
optima, and a complete optimal edge. Systems include unique, distinct parallel,
and coincident lines, and questions requesting only the x-coordinate while still
requiring the full intersection in the image.

`verify_exact.py` independently recomputes the declared canonical constraints from
expanded original affine expressions, exhaustively partitions the real line at
every inequality threshold, substitutes all named points, recomputes intercepts,
enumerates every pairwise boundary intersection, proves boundedness via the
recession cone, checks exact convex corner order, evaluates objectives and complete
optimal edges, and classifies systems by exact coefficient/augmented rank. Its
only arithmetic is standard-library `fractions.Fraction`. The affine expansion
of each authored expression was also checked during authoring. The complete
computations are recorded in `ARITHMETIC-EVIDENCE.json`.

`IMAGE-RUBRIC.md` is strict. Missing labels are distinguished from wrong geometry,
shading, corners, or objectives, while all required criteria remain necessary to
pass. All 20 cases stay in the required-image denominator. Neither narrator text
nor a build check substitutes for image evidence.

No APIs, model calls, image generation, commits, pushes, PRs, production actions,
or subagents were used. Exposed API spend is $0. Native billing is unexposed.

The author outputs are frozen by `SHA256SUMS` before this author receives any
runtime repair-completion/build-freeze or paid-run outcome. Only paths, hashes,
counts, and the schema are disclosed to the integration owner until runtime/source
freeze. After this freeze, neither question inputs nor oracles/rubric may be edited
in response to source capability or run outcomes.
