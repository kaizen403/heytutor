# Rotation label authority aliases

Owner: Sentry/hard-chapters lane. Base: main `6ca8b616a`. Apply after the
rotation-origin fix in PR #216 for the measured hard-chapter gains. This patch
does not duplicate that fix. $0; no production change or accepted-topic update.

## Measured cause and bounded change

The historical required-row ranking was missing labels99, second body/state83,
forces63, circuit elements55, current arrows48 and angles33 (overlapping).
This packet addresses a measured engine label-admission failure within that
first category. After origin preservation, 57 of 60 recorded rotation-family
candidates still reported a torque-label rejection. Unambiguous mathematical
labels such as the signed page-normal torque symbol were rejected by an
ASCII-only claim reader.

Accept exact `τ`, `τ_z`, `τz`, `tau_z`, `tauz` aliases for an existing `tau`
authority claim, and `ω`, `α`, `θ` for existing angular claims. The aliases do
not create a quantity, axis or value. Sign, units, literal underflow and canonical
rounding checks are retained. Annotation claim selection uses the same aliases,
so an angular-velocity label cannot fall back to the phase claim.

## Checks

- Owned gate:90 checks, including full prune/validate/compile admission, unit
  conversion, negative/zero torque, wrong values/signs/units, unsupported axes,
  canonical rounding, underflow, and annotation quantity selection.
- Identity-alias and missing-annotation-canonicalization mutations both fail
  the owned gate. Existing rotation suite526, engine build/typecheck and focused
  lint pass. Independent code review found no remaining blockers.
- All60 rotation candidates replayed with both patches:0→10 compiled; remaining
  failures retain output-kind, label, duplicate-ID and annotation checks.
  Every recovered figure was independently blind judged:3 right/7 partial/0 wrong.
  A first judge's charge-subscript reading was disproved by enlarged glyph
  inspection; its original record is retained. A fresh judge inspected all10
  without the earlier grades and confirmed3 right/7 partial/0 wrong.

## Full four-chapter replay

Actual run chapter metadata selected all recorded candidates available in the
frozen corpus for the four chapters, plus the20 authorized historical experiment
rows. There are2,272 unique candidates from1,144 run rows. All410 previously
graded historical rows are included;21 contain no raw planner response and are
reported separately. Strict chapter metadata alone contributes2,226 candidates.

| Chapter | Candidates | Main compiled | Origin + labels compiled |
| --- | ---: | ---: | ---: |
| Laws of Motion |507|381|381|
| Work, Energy and Power |255|178|178|
| Rotational Motion |434|228|232|
| Current Electricity |1,076|653|653|
| Total |2,272|1,440|1,444|

Labels alone preserves every one of the2,272 baseline render/status hashes.
With PR #216:4 gains,0 losses,0 changed existing renders; selected-candidate
compiled count1,027→1,030. All4 gains require origin preservation and match the
judged full-render hashes exactly:3 right/1 partial/0 wrong, across one question
and4 distinct figures. Selected gains are2 right/1 partial. The remaining6
recovered figures in the60-candidate diagnostic set belong to other metadata
chapters and are counted separately above.

Baseline fatal codes remain nonexclusive: invalid_solid_measurement139,
assertion_failed125, component_symbol_semantic_mismatch111, component_bypassed65,
annotation_geometry_unresolved58, invalid_derived_value_label58,
construction_failed55. These checks remain enforced.

Compilation counts measure recorded candidate admission, not full lesson or
chapter correctness. Missing source facts, apparatus, forces and other partial
figure causes remain. No topic coverage counts changed. All recorded text,
identifiers, manifests, renders and judgments stay in ignored private storage;
public fixtures use synthetic inputs only.
