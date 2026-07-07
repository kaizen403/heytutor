# JEE Perfect-Board Coverage Plan — Physics & Maths Deep Pass

> **Goal:** heytutor must solve *and teach on the board* every Physics and Mathematics
> topic in `docs/jee-syllabus-checklist.md` the way a real teacher would — correct
> diagram first, every symbol drawn correctly, clean markings and annotations, then
> the worked solution.
>
> **Emphasis:** Physics + Mathematics (deep). Chemistry stays at its current level —
> do not expand it.
>
> **Source of truth for topics:** `docs/jee-syllabus-checklist.md`.

---

## 0. Verification of the previous plan (COMPLETE)

The earlier "JEE Full Coverage" plan is implemented and wired:

- **25 diagram templates** registered in `packages/drawing/src/templates/registry.ts`
  (Physics: fbd, incline_fbd, projectile, circular_motion, ramp_spring, circuit,
  optics_ray, pv_diagram, wave_shm, energy_levels, electrostatics, magnetism,
  gravitation; Maths: unit_circle_trig, complex_argand, calculus_graph, three_d_axes,
  probability_venn, circle, coordinate_axes; Chem: organic_hexagon, galvanic_cell,
  coordination_geo, lewis_structure, reaction_arrow).
- **Deterministic precision intros** for circuits and optics (`circuitPrecision.ts`,
  `opticsPrecision.ts`) with correct geometry, labels, dotted DIMENSION bars.
- **Spoken math notation** (`mathToSpeech` in `elevenLabsClient.ts`) already reads
  ∫, ∫∫, ∂, ∇, lim, ∞, ≤, ≥, ≠, ≈, ±, √, csc/sec/cot, primes, log/ln/exp, Greek,
  chemistry states — verified by `verify-speech-notation.ts`.
- **Layout**: solution on the left half, diagram on the right half (just landed).

### The gap this plan closes

`mathToSpeech` *says* the symbols, but `textToStrokePaths` (the handwriting engine)
**cannot draw most of them**. A probe of the written board shows every one of these
renders as a blank gap:

```
∫ ∑ √ ∞ → ⇌ ± × ÷ ≤ ≥ ≈ ≠ ∂ ∇ ∮   → 0 strokes (blank)
```

So a calculus solution like `∫ x² dx = x³/3` writes `x² dx =  x³/3` with holes where
the integral sign, and any real fraction bar, should be. This plan fixes the written
board first, then fills the Physics/Maths diagram gaps, then the per-topic teaching
method, then a coverage test that walks the whole syllabus.

---

## Phase A — Written math-notation engine (FOUNDATION, do first)

Every Physics and Maths solution writes symbols, so this is the biggest single quality
lever. Add real hand-drawn synthetic glyphs + layout primitives in
`packages/drawing/src/handwriting.ts` (and a small notation pre-parser).

**A1. Operator & relation glyphs** (synthetic strokes, like the existing Ω/π work):
`∫ ∮ ∑ ∏ √ ∞ ∂ ∇ ± ∓ × ÷ · ≤ ≥ ≈ ≠ ≡ → ← ↔ ⇒ ⇌ ∝ ∴ ∵ ° ′ ″ ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ∠ ⊥ ∥`.

**A2. Built-up structures** (layout, not single glyphs):
- **Fractions** `a/b` → real horizontal vinculum with numerator above / denominator
  below (auto-detected for single-term fractions; keep inline for simple ratios).
- **Radicals** `√(...)` → radical sign with a vinculum bar spanning the radicand.
- **Definite integral** `∫_a^b` → integral sign with limits at top/bottom.
- **lim** `lim_(x→a)` → "lim" with the approach written underneath.
- **Summation/product** `∑_(i=1)^n` → sign with limits above/below.
- **Vectors** `vec(F)` / `F⃗` → arrow drawn over the symbol; **|x|** absolute-value bars;
  **matrix / determinant** → large square brackets / vertical bars around a grid.

**A3. Correct Greek shapes**: replace the remaining Latin-fallback Greek
(α β γ λ ρ σ τ ε η ν ξ ψ χ ζ … currently faked with Latin lookalikes) with proper
synthetic Greek strokes so maths/physics variables look right.

**A4. Notation pre-parser** in the drawing protocol so the LLM can emit readable
tokens (`\int`, `\sqrt(...)`, `\vec(F)`, `\frac(a)(b)`, `lim_(x->0)`) that map to the
A2 structures — keeping `[WRITE:...]` authorable.

**A5. Tests**: extend a new `verify-written-notation.ts` — assert each symbol above
renders ≥1 stroke (no blanks) and that fractions/radicals/limits produce the expected
multi-part layout. Add a snapshot render (SVG→PNG) for visual QA.

**Prompt update**: teach the model to use the new tokens and to prefer built-up
fractions/radicals for display math.

---

## Phase B — Physics diagram templates (fill the gaps)

New templates in `packages/drawing/src/templates/` (+ registry + promptAddon + tests).
Grouped by syllabus unit; each must draw geometry first, then label with Phase-A symbols.

**B1. Mechanics**
- `pulley_system` — Atwood / connected blocks over a pulley, tension arrows (Unit 3).
- `banked_road` — banked curve cross-section, N, mg, friction, angle θ (Unit 3).
- `collision` — before/after momentum diagram, 1D & 2D (Unit 4).
- `vertical_circle` — ball on string, tension + mg at top/bottom (Unit 4).
- `rotation` — rolling body, torque, moment-of-inertia shapes, parallel-axis (Unit 5).

**B2. Kinematics graphs**
- `motion_graph` — x-t, v-t, a-t graphs with slope/area annotations (Unit 2).

**B3. Fluids, Thermal, Kinetic theory**
- `fluid_flow` — Bernoulli pipe with varying cross-section + streamlines (Unit 7).
- `capillary_stress` — capillary rise + stress–strain curve (Unit 7).
- `maxwell_distribution` — speed-distribution curve (Unit 9).

**B4. Oscillations & Waves**
- `pendulum` — simple pendulum, angle, restoring component (Unit 10).
- `standing_wave` — string harmonics + organ-pipe modes (open/closed) (Unit 10).
- `doppler_beats` — moving source wavefronts / beat envelope (Unit 10).

**B5. Optics (ray + wave)** — biggest optics gap
- extend `optics_ray`: prism refraction/deviation, lens (convex/concave), lens/mirror
  combinations, total internal reflection, microscope & telescope ray paths (Unit 16).
- `ydse` — Young's double slit: slits, path difference, fringe pattern + width (Unit 16).
- `single_slit` / `huygens` — diffraction central maximum, wavefront construction.

**B6. EMI / AC / EM waves**
- `ac_phasor` — LCR phasor diagram + impedance triangle, resonance (Unit 14).
- `transformer` — primary/secondary coils, core, turns ratio (Unit 14).
- `em_wave` — E and B perpendicular, propagation direction, spectrum band (Unit 15).

**B7. Modern physics**
- `photoelectric` — stopping-potential vs frequency graph, work function (Unit 17).
- extend `energy_levels`: Rutherford scattering, binding-energy-per-nucleon curve,
  fission/fusion schematic (Unit 18).

**B8. Semiconductors & electronics** (Unit 19 + Section B)
- `pn_junction` — junction, depletion region, forward/reverse bias.
- `diode_iv` — I-V characteristic curves (also Zener, transistor CE).
- `rectifier` — half/full-wave rectifier circuit + output waveform.
- `logic_gates` — AND/OR/NOT/NAND/NOR symbols + truth tables.

**B9. Electrostatics/field extras**
- `field_map` — equipotential surfaces + field lines for charge configs (Unit 11).

**B10. Experimental skills apparatus** (Section B, lighter touch)
- `apparatus` — vernier callipers, screw gauge, metre bridge, resonance tube schematics.

---

## Phase C — Maths diagram templates (fill the gaps)

- `conic` — parabola / ellipse / hyperbola in standard form with foci, directrix,
  axes, latus rectum, tangent condition (Unit 10).
- `area_region` — shaded area under / between curves for definite integrals (Unit 8).
- `heights_distances` — angle of elevation/depression right triangles (Unit 14).
- `vectors` — triangle/parallelogram law, 2D/3D components, dot/cross geometry (Unit 12).
- `slope_field` — direction field for first-order ODEs (Unit 9).
- `matrix_layout` — matrix & determinant grids using Phase-A brackets (Unit 3).
- `stats_plot` — histogram / frequency polygon / box for dispersion (Unit 13).
- lighter: mapping diagram (functions, Unit 1), tree diagram + Pascal's triangle
  (P&C / binomial / probability), number line (sequences/inequalities).

---

## Phase D — Per-topic teaching method (routing + playbooks)

Make the tutor pick the right picture and the right method for each syllabus subtopic.

- **D1. Classifier/router**: extend template `test` regexes + `topicPlanner` so each
  syllabus subtopic maps to a template (or an intentional text-only path) and the right
  promptAddon. No question should silently fall back to a blank board.
- **D2. Solving playbooks**: per unit, a compact promptAddon "what to draw → which
  law/formula → common traps → answer form + units". Physics and Maths get full
  coverage; keep each addon small (budget-aware).
- **D3. Multi-part & conventions**: handle "find A, then B, then C" questions, carry
  results between parts, and enforce unit/significant-figure conventions.
- **D4. "Teach the why"**: keep the existing reasoning-first quality bar for every step.

---

## Phase E — Syllabus coverage verification harness

- **E1. Coverage matrix**: one representative question per syllabus subtopic in a
  fixture list, tagged with expected template (or text-only).
- **E2. Automated assertions** per question: (a) a template matches as expected,
  (b) the intro/solution emits **no blank glyphs** (every symbol has strokes),
  (c) solution stays in the left column, diagram in the right.
- **E3. Visual snapshots**: render a sample from each template to PNG for eyeball QA.
- **E4. Iterate to green**; check off items in `jee-syllabus-checklist.md`.

---

## Execution order & sequencing

1. **Phase A** (notation engine) — unblocks the quality of *every* Maths/Physics answer.
2. **Phase C** Maths templates (calculus-first units first: area_region, conic,
   heights_distances, vectors) — pairs naturally with Phase A.
3. **Phase B** Physics templates (mechanics + optics + modern + electronics).
4. **Phase D** routing & playbooks alongside B/C as each template lands.
5. **Phase E** coverage harness — run continuously, finalize at the end.

Each template/glyph follows the same recipe already proven for circuits/optics:
deterministic geometry → labels with correct symbols → dotted DIMENSION markings →
blocking so the LLM annotates rather than redraws → regression test → visual check.
