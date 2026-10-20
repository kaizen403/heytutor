# Component value bindings, 20 October 2026

Base: `565cb1781350f47c55ca8cdc753e0dcba31fe26c`. Next measured hard-chapter
cause: wrong or missing numeric labels. Historical required-row findings rank
numeric labels 99, second body/state/apparatus 83, and forces 63 (overlapping
counts, not current-main grades). This packet changes no topic counts.

## Reproduction and fix

A synthetic closed circuit has internal resistance `r = 0.25 Ω` and load
`R = 1.75 Ω`. Main draws `R 0.25 Ω`: the component-value helper case-folded
physical symbols and chose the first inventory match. The new gate was red on
that exact rendered-label assertion before the fix.

The compiler preserves physical symbol case, prefers unambiguous declared
symbols over opaque inventory ids, and checks conflicting aliases instead of
choosing by order. Case-exact ids remain usable when symbolic metadata is absent;
legacy opaque-id aliases remain supported when no declared physical case conflicts.
A single explicit quantity binding with matching or absent symbolic metadata can
disambiguate a component value. This new path formats the finite stored scalar
and unit, not an unchecked display label or unresolved reference. No numerical
solver, topology, admission, or planner-prompt check is weakened.

Two independent code-review counterexamples were fixed and gated: an opaque
internal quantity id `R` overriding the external physical symbol `R`, and a
quantity's stale display label `9 Ω` overriding its stored value `1.75 Ω`.
Missing or ambiguous data remains unlabelled; this is not a new source reader.

## Free verification

- Owned gate `verify-component-value-bindings.ts`: 25 checks. It covers physical
  case, opaque ids, ordering, explicit bindings, conflicting/equivalent aliases,
  subscript forms, SI prefix differences, stale display labels and unsupported
  scalars. Caller documents are unchanged.
- Five mutations each turn the gate red: restore case folding, ignore explicit
  binding, choose the first ambiguous alias, trust a stale display label, or
  allow unresolved scalar ink. Restored source passes.
- Engine typecheck, lint, build, scene-engine smoke, golden corpus, summary-label
  stack and operator-primitives gates pass. Four unrelated DSA lint warnings remain.
- Four-chapter frozen replay: all 2,272 candidates, 1,440 drawn before and after;
  2,254 byte-identical, 18 changed, zero gained/lost. All changes are Current
  Electricity. Blind grades on the 18 changed candidates:
  **0 right / 2 partial / 16 wrong → 7 right / 10 partial / 1 wrong**.
- Full frozen circuit replay: all 1,709 candidates, 1,245 drawn before and after;
  1,689 byte-identical, 20 changed, zero gained/lost. Blind grades on those 20:
  **0 right / 3 partial / 17 wrong → 7 right / 11 partial / 2 wrong**.
  No right figure lost and no new wrong figure in either comparison. These sets
  overlap and must not be added together.
- Every final changed render is covered by a blinded judgment via exact question
  and render-hash joins. Original 29 paired cards and two successive two-pair
  follow-ups are preserved privately; intermediate verdicts were not rewritten.
- Actual production candidate validator with recorded plan inputs: 19 of the
  20 changed circuit candidates pass on both revisions; no status/code change.
- All 54 recorded Kimi Fast candidates retain identical production admission,
  codes and rendered hashes (19 valid). The six parallel concept refusals remain.

Remaining partial/wrong figures are explicitly retained. This does not establish
full chapter coverage or repair missing apparatus, source topology or lesson
selection. Runtime model success was not measured. No paid calls, merges or
production changes. Recorded questions, ids, payloads, images and judge keys stay
in ignored workspace context; public fixtures are synthetic only.
