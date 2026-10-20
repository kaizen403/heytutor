# Named pressure–volume processes

`pv_process` constructs one atomic plot from complete named states and directed
processes. The engine owns the common V-horizontal/P-vertical axes, units, state
names, law names, analytic curves and arrows. It does not infer an endpoint or
replace supplied values to make a law fit.

```ts
type Law = "isobar" | "isochor" | "isotherm" | "adiabat";
type State<T> = { id: string; pressure: T; volume: T };
type Edge = { kind: Law; from: string; to: string };
type PhysicalEdge =
  | { kind: Exclude<Law, "adiabat">; from: string; to: string }
  | { kind: "adiabat"; from: string; to: string; gamma: string };
type Input =
  | { mode: "physical";
      pressureUnit: "Pa" | "kPa" | "bar";
      volumeUnit: "m^3" | "L" | "cm^3";
      states: State<string>[];
      processes: PhysicalEdge[] }
  | { mode: "conceptual";
      states: State<number>[];
      processes: Edge[] };

// One construction and one matching entity:
{ operator: "pv_process", inputs, outputs: ["plot"] }
{ id: "plot", kind: "polyline", role: "P-V process plot" }
```

States number 2–8; processes number 1–8. Every state is used and every edge names
two distinct states. Short mathematical identities such as A, B and A_1 are
allowed; A1 and A_1 denote the same identity. Distinct identities cannot occupy
the same P/V state. Duplicate state pairs, reversed duplicate isochores and
overlapping portions of the same process law refuse.

Physical P, V and gamma inputs are **exact declared quantity IDs**. Each quantity
must have a flat, finite numeric value and an explicit unit compatible with the
plot's common unit; gamma uses `1` or `dimensionless`. Literals, numeric strings,
object wrappers and reference chains refuse. Production plan agreement audits
flat quantities, so allowing another numeric representation would bypass that
source check. Mixed source units within one plot are deferred; equivalent whole
plots in Pa/m³, kPa/L or bar/cm³ retain the same SI states and work.

An isobar requires equal endpoint pressures; an isochor requires equal volumes.
An isotherm requires constant PV, and an adiabat requires constant PV^gamma.
Physical isotherms require an explicitly ideal-gas source. A physical adiabat
means a reversible ideal-gas path with an explicit dimensionless `1 < gamma <=
64`; gamma is invalid on any other law. The existing thermodynamics kernel
computes SI states and signed work independently of the display fit. Work, heat,
temperature and answer values are not printed automatically.

Conceptual input requires `source.nonMetric: true` and
`source.representationTier: "qualitative_verified"`. Coordinates are positive
literal representative ratios, with no units, quantity references or gamma
input. An adiabat's representative exponent follows its endpoints and must lie
in `(1,64]`; no gas constant is guessed. The plot visibly says **ideal gas
sketch**. It carries no physical state, SI work or measured-gamma authority.
Both modes have nonmetric display coordinates because pressure and volume have
different dimensions and independently normalized axis scales.

The internal `pv_plot` geometry is sealed. A PV scene has exactly one
construction and its one output, with optional pure groups. Entity labels,
semantic/provenance payloads, other geometric or label constructions, and
visible annotations anywhere in that scene refuse. Narration-only annotations
without quantity references are allowed. This prevents an unrelated point,
caption, curve or group alias from adding unproved law or numeric ink. Generic
point, label, transform, metric and calculus consumers cannot erase this
nonmetric authority.

All coordinates must be positive, finite and bounded by 1e12 in their declared
scale. The physical kernel retains its SI/resource bounds. Endpoints must obey
their law at floating-point precision. The final fit refuses indistinguishable
states and collapsed changing axes. Nonlinear paths use at most 513 analytic
vertices, with final-screen chord and tangent checks. Arrows follow `from` to
`to`, including compression. All plot labels pass the native screen-space
placement solver at the board's real font floor; an unreadable atomic plot
refuses. Yield policy cannot demote a false law, state or claim into success.

## Source authority

Algebra alone does not prove that a plot depicts the asked process. Shared live
and server-save admission call `validatePvSourceBinding` with the **actual
question**, independently of submitted source flags. The first slice supports a
controlled positive mathematical vocabulary and bounded clause grammar. Every
source word must belong to that vocabulary; an unfamiliar English prefix or
additional physical request declines instead of being ignored. For example:

> For an ideal gas: A is 200 kPa and 1 L; B is 100 kPa and 2 L.
> A to B is isothermal.

Named state clauses specify one pressure and one volume using `is`, `at`, `has`
or a colon. Directed laws use `A to B is LAW`, or a supported `LAW ... from A
... to B` form. Physical adiabats also name reversibility and gamma for that
directed process. Each drawn state's SI values, process law and direction must
match the source. Recognized expansion/compression must agree with the change
in V. Source and plan law claims cannot conflict.

A conceptual comparison must request exactly the drawn source law inventory.
Explicit source named-state paths must match the drawn directed paths. Physical
P/V measurements or gamma in the source cannot be hidden by changing to
conceptual mode. Nonideal-gas, negated, conditional, alternative, ambiguous or
unsupported source wording refuses with fatal `pv_source_unproved`. This is a
bounded source contract, not a claim to understand arbitrary thermodynamics
prose. An unsupported request may still teach through the ordinary refusal path.

There is no topic router, endpoint solver, old `pv_cycle` rewrite or recorded
question mapping. Old raw planner drafts do not acquire this operator during
normalization. Synthetic native capability results and unchanged recorded
replay results are reported separately.

## Verification

The owned engine gate checks all four laws and directions, SI work, equivalent
units, display fits, analytic curve accuracy, model separation, sealed ink and
fatal refusals. The owned app gates exercise actual production admission,
selection and canonical save, including JSON round trips and source
counterexamples. The planner gate intercepts its mock transport and proves
scoped requests fit the existing 24,500/27,000 character limits. No provider
call is needed.
