# HeyTutor — remaining work

Consolidated 29 Aug 2026 from this session plus every other session transcript on this
machine (15 with content, under `~/.claude/projects/-Users-kaizen-heytutor/`). Session ids
are given so you can trace a claim; you should not need to reopen any of them.

Numbers are MEASURED unless marked ESTIMATED.

**Current state.** Bank: 1485 visualizable · physics 914 scenes / 22 misses (20 of them
pictures the engine now refuses) · maths 278 / 5. Typed-maths corpus: 52 of 76 drawn, 34 right
picture, 0 invented. Chains: `apps/tutor` green, `drawing` green, `whiteboard` green;
`tutor-core` red only on `verify-physics-unit-probe-visuals` (21); `scene-engine` red only on
another session's in-flight `binding_energy_curve` probe. **Floor is on `main`**
(`a8c9376`, 20 commits, 29 Aug). Local leftovers: `.images/`, this file.

**The rule that governs the engine work:** a wrong picture is worse than no picture. Ground
the builder first; let it draw nothing rather than draw a guess.

---

# A. Diagram engine

## A1. Blocked on the peer session (heytutor-8b) — do not build these

- Seven probe topics they took: vernier callipers, vernier zero-error, screw gauge, screw
  gauge zero-error, magnetic materials vs temperature, mass defect, Faraday's law. Closes
  `verify-physics-unit-probe-visuals` (21 failures).
- `verify-archetype-pictures` is RED: `binding_energy_curve` needs an entity with role
  `"axes"`. Mid-build.
- **Enforce when it lands:** the binding-energy-per-nucleon curve and the χ–T curves are
  law-shaped figures with invented ordinates. They must be `qualitative_verified`, never
  `exact_verified`. Check neither acquires a metric slot for A or T.
- `typed-physics-v1.json` (~120 typed physics questions) — offered to them; take it back if
  they decline. `verify-typed-corpus.ts` already loads it by name and skips when absent.

## A2. Unfinished agent work (three agents died: rate limit, then sleep + network)

- **MCQ answer oracle.** `packages/scene-engine/src/bank/answerOptions.ts` exists (582 lines,
  typechecks) but its logic is **unverified** — written by an interrupted agent. Needs
  `verify-answer-options.ts`, a correctness review, a corpus measurement, and wiring.
  *Why it matters:* nothing in this repo measures whether the **answer** is right. Thousands
  of bank rows carry inline options, so an answer not among them is a free error signal — the
  cheapest route to a per-unit answer-accuracy number, which does not exist today.
- **Bilingual page recovery.** `tools/question-bank/question_bank/bilingual.py` exists (284
  lines), **not wired** into `build_corpus.py`, no tests. Agent's last measurement before
  dying: recovers 924 rows but **touches 335 already-readable rows** — inspect those false
  positives before wiring, or it will mangle good questions.
  *Prize:* ~1,092 of the 1,130 currently-dropped rows have an intact English half.
  *Nuance:* a row that looks like transliterated gibberish can still be 30% recognisable
  English. "Looks garbled" ≠ "unreadable".
- **Operator behavioural audit.** `project` confirmed to have **zero** behavioural coverage
  anywhere. The PROVEN / INCIDENTAL / ABSENT table for all 60 operators was never produced;
  `verify-solid-operators.ts` absent.
  Hunt for **proxy-not-property** bugs — three were found today, all the same mistake:
  differentiability judged by magnitude not convergence (tangent at the vertex of y=x²
  rejected); `refract_direction` inverting eta on a co-directed normal (a ray leaving a prism
  computed as entering: 20.6° where Snell gives 52.4°); a "series chain" identified by
  "contains a resistor" instead of by topology.
  Cheap high-value case: `implicit_curve` — sample the returned path vertices and assert
  F(x,y) ≈ 0 at each, i.e. that it traces the actual zero set.

## A3. Typed-input frontier — the honest gap for a real user

Measured on 119 typed maths questions. This list differs from the bank's, because every other
number in the project comes from OCR-damaged scans.

| Unit | Drawn | Right picture |
|---|---|---|
| `maths\|12` vectors | 5 of 8 | **0** |
| `maths\|13` probability (tree / Venn) | 0 of 3 | 0 |
| linear programming | 0 of 3 | 0 |
| `maths\|1` sets / Venn | 1 of 3 | 0 |
| `maths\|8` area-by-integration | 8 of 10 | 3 (was 1) |
| `maths\|14` | 3 of 5 | 2 |
| `maths\|9` differential equations | 0 of 1 | 0 (largely honest text-only) |

Linear programming note: `constraint_region` already computes a feasible region from
inequalities, so this is mostly wiring — **but corner points do not fall out of it**; it
returns 130 sampled boundary points. For all-linear systems use exact half-plane clipping to
get the polygon and its vertices. 47 of 104 bank LP stems state readable constraints; 17 more
have the ≤/≥ dropped by OCR and must fail closed.

## A4. Canned defaults still to ground

Each is "return null unless the stem grounded it". Counts are bank rows receiving the canned
picture today.

- prism apex 60° — **73**; the exact path takes the *first* "N°" in the stem, so 8 of 19 use a
  number that is not the apex (`δm = 180° − 2i`, "incident at 45°").
- canned 3D points (1,2,3)/(5,3,4), directions (2,3,6)/(2,3,8) — **109 of 174** `maths|11`.
- 2-slit / 7-fringe aperture default — **152**, 19 of them telescope/microscope stems.
- default two point charges — **160**, 41 with no charge word at all.
- circle radius default 2 — **22**, 8 of which state their own radius.
- mirror/lens with invented u=1, f=±0.5 — **17**.
- instrument-chain placeholder injected by validation autofill — **27**.
- P–V rectangle A-B-C-D — **7**, 5 of them adiabatic/isothermal/Carnot (curved processes).
- variation straight line origin→(2.8, 2.4) — **14**.

Also outstanding:
- **One shared honest-text-only predicate.** Three copies exist (live `familyScene`, the bank
  harness, the planner path). 53 rows the harness calls text-only are drawn live, because the
  qualitative-concept branch has no live twin.
- **`resolveRequestedFamilies` honouring its caller.** ProblemIR now leads the order, but the
  `families` argument is still additive-only — 887 of 1188 pinned calls ignored it, so the
  persist path cannot pin the accepted family.
- **12 picture-class gate rows** specified but not written: `capacitor_network`,
  `wheatstone_bridge`, `potentiometer_wire`, `galvanometer_not_chain`,
  `magnetic_source_not_charges`, `decay_not_levels`, `named_ellipse`, `sideways_parabola`,
  `binding_energy_curve`, `instrument_not_slits`, `right_angled_prism`, `pv_curved_processes`.

## A5. Live path (`apps/tutor`) — none of these has an offline gate

- Planner path has **no figure-absent guard**: 179 of 200 figure-absent rows still hand the
  LLM planner a non-empty family catalog, so "shown in the figure" can get an invented figure
  committed and taught.
- `visualRequirement: "none"` does not skip the canvas — the family fallback runs
  unconditionally. This is how concept MCQs get a picture.
- `retry_required` is dead code: a required visual with no picture is silently persisted as
  `text_only`.
- **Narration-topology guard.** Teaching can narrate a two-loop while the diagram shows a
  chain; only unresolved `[FOCUS:id]` gestures are dropped, the words go out verbatim.
  Proposed: put the committed entity list in the teaching addon, and emit dropped-FOCUS counts
  to Langfuse.
- A doubt turn clears the board and re-plans on the doubt prompt, losing the figure.
- Replay of a turn saved without a scene is untested.
- Save failure is `console.error` only on the student shell.

## A6. Architecture — the two that move accuracy most

1. **Draw from the solved problem, not the stem text.** `problemIR` is now threaded into
   `FamilySceneInput` and drives family order + picture demand, but builders still do not take
   *geometry* from solved entities. Until they do, "a circle with centre in the first quadrant
   touching the x-axis at distance 3" cannot be drawn — the solver derives the centre, the
   text parser cannot. This also makes OCR repair largely unnecessary for live users.
2. **Answer correctness has no measurement at all.** See the MCQ oracle in A2.

Secondary:
- Metric-proof predicates are unified (`snells_law`, `equal_angle`, `distance_ratio`,
  `function_value`, `angle_between`, `vector_sum`, `root`, plus a non-boolean `expected`).
  Consider adding `on`, `distance`, `tangent`, `inside`, `equal_length` so more maths diagrams
  can be provably exact rather than merely qualitative.
- **947 classified questions in 11 units sit outside `DIAGRAM_LED_UNITS`** and have never been
  measured: `maths|13` 269, `maths|3` 246, `maths|1` 120, LP 116, comm-systems 53, `maths|6`
  46, `maths|2` 40, `physics|1` 31, `maths|4` 19, `physics|9` 6, `maths|5` 1. Admitting them
  today would make the scoreboard *worse* (maths misses 2→13, physics 0→9, plus ~22 wrong
  pictures scored as coverage) — admit each only with its builder.
- **The worthiness funnel is unaudited**: 5,517 classified → 1,485 reach the harness.
  `maths|7` 413→34, `maths|9` 279→1, `physics|17` 296→65.
- **239 physics rows labelled `honest_text_only` are unaudited.** A sample read suggested ~45%
  are drawable from the stem alone (rolling bodies, Atwood, charges at stated coordinates,
  capillary tubes, named P–V processes, V₀–ν law plots). **Do not relax the figure-absent
  guard before grounding the builders** — with it bypassed, 179 of 200 such stems compile,
  almost all into canned defaults.
- 8,920 of 16,669 bank rows are `needs_review` — 54% of the bank is unclassified.

## A7. Documentation (stale)

`docs/agent/session-handoff.md` and `docs/plans/diagram-engine-priority.md`:
- HEAD described as `5d7a5f1`; it is not.
- "physics_misses=0, maths_misses=2" — never true in any committed report.
- "Physics required-visual gaps are closed" — false.
- "maths|10, 11, 12 required misses are 0" — false.
- Remaining maths misses called "garbled OCR"; several are legible.
- Work listed "patched in tree"/"uncommitted" that is now committed.
- Green-gates list names only scene-engine. **There are five chains**: scene-engine,
  tutor-core, apps/tutor, drawing, whiteboard.
- Must record: **tutor-core and apps/tutor resolve `@heytutor/scene-engine` from its BUILT
  dist**, so `pnpm --filter @heytutor/scene-engine build` must precede those chains. A stale
  dist hid three red gates on main and produced two wrong measurements in one day.
- Must record: `verify-bank-family-compile.ts` only writes its report with `--report`, so a
  plain gate run no longer dirties `data/`.
- `docs/agent/archetypes.md` is untracked — decide whether it stays.

---

# B. Tutor app — carried over from other sessions

## B2. Lesson runtime

Paid live pen-motion watch is still a human check — offline choreography and ink-pace gates are green; a Fireworks/ElevenLabs lesson was not run.

---

# C. Landing page — carried over

## C1. Media and assets *(sessions 37478211, a1ec0e86, 88cc8399)*

- **Hero video is stale**: the shipped preview was recorded before the UI changes — it shows
  the old `teaching…` chip and the board frame with corner bolts and hard shadow. Needs a
  fresh capture.
- **Resistors voice track not cut.** `generate-hero-voice.mjs` is hardwired to the car
  lesson's `SEGMENTS` and needs a `--segments` argument first. ElevenLabs key is already in
  `apps/tutor/.env.local`.
- `public/chalk/` (380 KB) is **unreferenced** since `ChalkComet.tsx` was deleted — safe to
  remove.
- `accelute-3d-*.png` are **2.7 MB at 2816×1584**. No responsive `srcset`, no WebP/AVIF. This
  is a live page-speed problem.
- Pen sprite reads as a stout marker at **5.8:1**; a truer pen is nearer 9:1.
- `scratchpad/verify-beats.ts` exists but was left out of the repo — the landing app has no
  verify chain to hold it. Decide whether landing gets one.

## C2. Design follow-ups *(sessions 1c6cc4a1, 137585d5, 72d8e2b8, a1ec0e86)*

- Full-hero particle layer — offered, not built (was blocked on another session owning
  `Hero.tsx`).
- Use-cases rail (left-aligned clickable lesson titles beside the stage) — left alone
  pending your call.
- Two uppercase micro-labels survive on purpose: `GAP SIGNAL` and the Bento axis labels.
  They are fake product UI inside illustrations, not page headings.
- The hero no longer offers a way to type a question — that path was removed. Restore only if
  you want it.
- `@heytutor/brand` (a shared brand package) named as the clean follow-up to the logo
  unification.
- A previous Footer redesign is preserved at `scratchpad/Footer.redesign-backup.tsx` (315
  lines) — recover anything wanted from it or delete it.

## C3. Image generation *(session 88cc8399)*

- `tools/brand.ts` (composite your logo onto images) and `tools/imagegen.ts` (2k API pipeline)
  were offered and **not written**; the pipeline needs your own third-party key.
- Note for the record: that session declined to strip the Grok provenance mark from generated
  images, and that stands.
