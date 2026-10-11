# H3R7 remaining rejection audit — NOT READY

Owner: `/root/linear_diagnostics_contract`. Reporting only: read frozen captures and their original run JSONs; no source, runtime, controls, grades or images changed, and no new API/model requests. This report concerns the four required empties in the complete first candidate repeat and the three empties in the **ungraded, incomplete second-repeat prefix (37/40)**. It does not turn the second prefix into an evaluated repeat or claim readiness.

The integration owner's frozen secondary first-repeat consensus is main **R0/P21/W18/E1** versus candidate **R18/P17/W1/E4**. Required empty rose from 1 to 4, so the amended safety gate fails. The primary second repeat was aborted at 37/40; its figures are not graded here. No third run or post-measurement repair is proposed as already performed.

## Findings

- **hp06/hp07/hp10:** the captured inequality strings preserve the source inequalities. Each rejected document also requests standalone axes and/or point marks outside its linear composite. The full diagnostic is an ownership refusal: **“Linear figure marks must all be emitted by verified linear operators”**. Its code is `linear_source_mismatch`, but this message does **not** establish mathematical inequivalence. All six attempts for each affected row retain this message; repairs remove axes yet retain standalone points.
- **nl09, second-prefix only:** the initial union leaves contain chained comparisons (`g1 <= x < g2`, `g2 < x <= g3`) instead of a single comparison per leaf. The full diagnostic is **“A linear source clause requires exactly one comparison”**. The initial strings also contain quantity IDs rather than literal original bounds, although the observed first failure is the comparison shape. Four repairs supply the mathematically correct union of two intersections, then fail the protected derived-claim guard because they retain calculated membership in a targeted narration annotation. The identity entity label `A ∪ B` is not the offending solved claim.
- **sys07 (first repeat) and sys06 (second prefix):** final solver authority reports `contradiction` / `value_type_mismatch`; no rejected-operator calls or candidate-rejection records are captured for these two rows. The diagram's reason/degradation is `solver_contradiction` and the independently available source-grounded fallback is suppressed. This is separate from source matching or operator ownership.

## Complete first-repeat required empties

### r1 — `hp10-strict-boundary-point`

Question: `Graph x - y > 2 and mark A = (3, 1) and B = (4, 1). Which of A and B belongs to the shaded solution set?`

- Captured `emptyCause`: `candidates_invalid`; reason: `representation carries no readable label`; degradation: `candidate_invalid`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r1-candidate/runs/maths_h3r6_shaded_regions_hp10_strict_boundary_point_q1.json`.
- Original run SHA256: `5a57f21c200054d2ee1851021e5f380b8e3b126df55f445506bdee6d500973bc`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

All **6** rejected candidate validations and exact operator arguments follow. Argument strings below are unchanged from retained `rawArguments`. Each call identifies its construction index/ID and attribution; a document-level ownership rejection is not proof that an individual extra point or axes operator failed its own geometry check.

#### Candidate rejection 0: plan/primary, initial

Raw program SHA256: `6d50d97fce2830646cddda3cf7fc0cc70884fc49501e527a3ad0722513c882d1`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-1,"xMax":5,"yMin":-2,"yMax":3}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x - y > 2"}
  ```

- Construction `2` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"ax","y":"ay","coordinateSpace":"world"}
  ```

- Construction `3` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"bx","y":"by","coordinateSpace":"world"}
  ```

#### Candidate rejection 1: plan/alternate, initial

Raw program SHA256: `2319188ba58d1848a5b440967a9fafe209fb1625c8000933b7b34fcc90401e83`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-1,"xMax":6,"yMin":-2,"yMax":4}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x - y > 2"}
  ```

- Construction `2` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"ax","y":"ay","coordinateSpace":"world"}
  ```

- Construction `3` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"bx","y":"by","coordinateSpace":"world"}
  ```

#### Candidate rejection 2: repair/alternate, initial

Raw program SHA256: `6ac7e83f0545b44afc132ccab170cb4111e5b78b68f9adb16fe83411f5d97c35`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x - y > 2"}
  ```

- Construction `1` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"ax","y":"ay","coordinateSpace":"world"}
  ```

- Construction `2` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"bx","y":"by","coordinateSpace":"world"}
  ```

#### Candidate rejection 3: repair/primary, initial

Raw program SHA256: `93371f17bdb4b23242a79cbfd7d0572c5e4ccf48b03471ce450d5b859ad94b02`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x - y > 2"}
  ```

- Construction `1` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":3,"y":1,"coordinateSpace":"world"}
  ```

- Construction `2` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":4,"y":1,"coordinateSpace":"world"}
  ```

#### Candidate rejection 4: repair/primary, initial

Raw program SHA256: `d33b797f186d5da97cc113fe65fcbf0569a13694aba9c046dfc15e40305233cf`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x - y > 2"}
  ```

- Construction `1` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"ax","y":"ay","coordinateSpace":"world"}
  ```

- Construction `2` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"bx","y":"by","coordinateSpace":"world"}
  ```

#### Candidate rejection 5: repair/alternate, initial

Raw program SHA256: `148653cfbb77d755bddfa39ae0abb8cdd0bd923b2f6c6a080136bbd42b479d3d`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x - y > 2"}
  ```

- Construction `1` / `make_A`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"ax","y":"ay","coordinateSpace":"world"}
  ```

- Construction `2` / `make_B`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"bx","y":"by","coordinateSpace":"world"}
  ```

Finding: every captured linear inequality matches the original relation. Extra standalone `axes`/`point` constructions persist in the rejected atomic document; this is the ownership branch of `linear_source_mismatch`, not a spacing/Unicode/ordering/scaling equivalence failure.

### r1 — `sys07-negative-coefficients`

Question: `The lines 2x - y = 5 and -3x + 2y = -4 meet at P. Graph both lines, label P, and find its x-coordinate.`

- Captured `emptyCause`: `fallback_suppressed`; reason: `solver_contradiction`; degradation: `solver_contradiction`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r1-candidate/runs/maths_h3r6_shaded_regions_sys07_negative_coefficients_q1.json`.
- Original run SHA256: `04ae047b3eec315cd6bf8eb93f34f57148c3b7952fa43b8283ec61a9386d2363`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

No rejected candidate or rejected operator argument exists in this capture. The following is the complete **persisted solver summary**, not a reconstructed full solver audit:

```json
{
  "status": "contradiction",
  "issueCodes": [
    "value_type_mismatch"
  ],
  "hasProjection": false,
  "projection": null
}
```

Persisted plan unknowns and derived values:

```json
{
  "unknowns": [
    {
      "id": "xP",
      "symbol": "x_P"
    }
  ],
  "derived": [
    {
      "id": "xP",
      "symbol": "x_P",
      "value": 6
    },
    {
      "id": "yPval",
      "symbol": "y_P",
      "value": 7
    }
  ],
  "qualitativeClaims": [
    {
      "id": "graph",
      "expected": "P = (6, 7)."
    }
  ]
}
```

Suppressed fallback:

```json
{
  "figureSource": "source_grounded",
  "family": null
}
```

Captured model-program calls below were **suppressed, not recorded as rejected operator calls**. They are included to distinguish the available model scene from the final authority block.

#### Model response plan/primary, selected marker `True`

- `make_axes` / `axes`: `{"xMin":-1,"xMax":8,"yMin":-6,"yMax":9}`.
- `make_a1` / `point`: `{"x":0,"y":-5,"coordinateSpace":"world"}`.
- `make_a2` / `point`: `{"x":2,"y":-1,"coordinateSpace":"world"}`.
- `make_b1` / `point`: `{"x":0,"y":-2,"coordinateSpace":"world"}`.
- `make_b2` / `point`: `{"x":2,"y":1,"coordinateSpace":"world"}`.
- `make_line1` / `line`: `{"start":"a1","end":"a2"}`.
- `make_line2` / `line`: `{"start":"b1","end":"b2"}`.
- `find_P` / `intersection`: `{"first":"line1","second":"line2"}`.

#### Model response plan/alternate, selected marker `False`

- `make_axes` / `axes`: `{"xMin":-1,"xMax":8,"yMin":-6,"yMax":9}`.
- `make_a1` / `point`: `{"x":2,"y":-1,"coordinateSpace":"world"}`.
- `make_a2` / `point`: `{"x":4,"y":3,"coordinateSpace":"world"}`.
- `make_b1` / `point`: `{"x":2,"y":1,"coordinateSpace":"world"}`.
- `make_b2` / `point`: `{"x":4,"y":4,"coordinateSpace":"world"}`.
- `make_line1` / `line`: `{"start":"a1","end":"a2"}`.
- `make_line2` / `line`: `{"start":"b1","end":"b2"}`.
- `find_P` / `intersection`: `{"first":"line1","second":"line2"}`.

The stored plan-derived `(6,7)` satisfies both source equations exactly: `2·6−7=5` and `−3·6+2·7=−4`. A numeric disagreement with these recorded coordinates is not evidenced by the stored solver code.

### r1 — `hp07-negative-constant-membership`

Question: `Represent -3x + 4y <= -12 graphically. Mark P = (0, -4) and Q = (0, 0), and identify which point satisfies it.`

- Captured `emptyCause`: `candidates_invalid`; reason: `representation carries no readable label`; degradation: `candidate_invalid`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r1-candidate/runs/maths_h3r6_shaded_regions_hp07_negative_constant_membership_q1.json`.
- Original run SHA256: `9e8c4413d8c3fb2b578de75ad05e3867058af715862bb0cef93a70ce349d945e`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

All **6** rejected candidate validations and exact operator arguments follow. Argument strings below are unchanged from retained `rawArguments`. Each call identifies its construction index/ID and attribution; a document-level ownership rejection is not proof that an individual extra point or axes operator failed its own geometry check.

#### Candidate rejection 0: plan/alternate, initial

Raw program SHA256: `4eac9a5431d595078b9c85f421ab1414cc0c49a26c72bdbeb5dd63977432c6e1`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-2,"xMax":6,"yMin":-6,"yMax":2}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"-3x + 4y <= -12"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":0,"y":"py","coordinateSpace":"world"}
  ```

- Construction `3` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"z","coordinateSpace":"world"}
  ```

#### Candidate rejection 1: plan/primary, initial

Raw program SHA256: `84e683988934d53bd28ee552d56ed2f4c82da05470eba9c1b860b3a76e0d9d7f`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-2,"xMax":6,"yMin":-6,"yMax":2}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"-3x + 4y <= -12"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":0,"y":-4,"coordinateSpace":"world"}
  ```

- Construction `3` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":0,"y":0,"coordinateSpace":"world"}
  ```

#### Candidate rejection 2: repair/alternate, initial

Raw program SHA256: `f56b67119dd6aa2791a7ec0913d99b4ac88a4faff9c34889dd005ffe1dca6c04`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"-3x + 4y <= -12"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":0,"y":-4,"coordinateSpace":"world"}
  ```

- Construction `2` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":0,"y":0,"coordinateSpace":"world"}
  ```

#### Candidate rejection 3: repair/primary, initial

Raw program SHA256: `8e9f2a57ac31bd83de3f5b7a199ad9da9c2932ce40bc2930d37878c87c4f1019`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"-3x + 4y <= -12"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"py","coordinateSpace":"world"}
  ```

- Construction `2` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"z","coordinateSpace":"world"}
  ```

#### Candidate rejection 4: repair/primary, initial

Raw program SHA256: `4f4b281ab38f3c65c70e0c53a902b46d9bdb40164f06d503cd22484d90d92d4b`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"-3x + 4y <= -12"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"py","coordinateSpace":"world"}
  ```

- Construction `2` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"z","coordinateSpace":"world"}
  ```

#### Candidate rejection 5: repair/alternate, initial

Raw program SHA256: `44a348221bd62d2ece7ff109ded24d2cc951e2cb9c34d02d1e3ce2d31bc4ff54`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"-3x + 4y <= -12"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"py","coordinateSpace":"world"}
  ```

- Construction `2` / `make_Q`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"z","y":"z","coordinateSpace":"world"}
  ```

Finding: every captured linear inequality matches the original relation. Extra standalone `axes`/`point` constructions persist in the rejected atomic document; this is the ownership branch of `linear_source_mismatch`, not a spacing/Unicode/ordering/scaling equivalence failure.

### r1 — `hp06-positive-strict-membership`

Question: `Graph x + 2y < 6. On the same graph, indicate whether P = (1, 1) is in the solution region.`

- Captured `emptyCause`: `candidates_invalid`; reason: `representation carries no readable label`; degradation: `candidate_invalid`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r1-candidate/runs/maths_h3r6_shaded_regions_hp06_positive_strict_membership_q1.json`.
- Original run SHA256: `0c2199e8ec0b458408b7c244cde988f7b554e2b53c0644efd6dfe4d952b7cf2b`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

All **6** rejected candidate validations and exact operator arguments follow. Argument strings below are unchanged from retained `rawArguments`. Each call identifies its construction index/ID and attribution; a document-level ownership rejection is not proof that an individual extra point or axes operator failed its own geometry check.

#### Candidate rejection 0: plan/alternate, initial

Raw program SHA256: `dea6572979ca6206395529c11ce0db886ed075e04461c86d52b6acd52b7727df`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-2,"xMax":8,"yMin":-2,"yMax":5}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x + 2y < 6"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"g4","y":"g5","coordinateSpace":"world"}
  ```

#### Candidate rejection 1: plan/primary, initial

Raw program SHA256: `8642ad73681a918de05e92e52f4ba5d56c23e0f3d1882de22069c295b1984729`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-1,"xMax":7,"yMin":-1,"yMax":5}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x + 2y < 6"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"g4","y":"g5","coordinateSpace":"world"}
  ```

#### Candidate rejection 2: repair/alternate, initial

Raw program SHA256: `627d59cfff8e31b499b2dab842f0b0dae090590bfe29a37d887f8ec7b0bc2674`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"g4","y":"g5","coordinateSpace":"world"}
  ```

#### Candidate rejection 3: repair/primary, initial

Raw program SHA256: `587802203f607baa552227365d6cdd1043999285ed77a72b16d9d3e907e6bbab`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"g4","y":"g5","coordinateSpace":"world"}
  ```

#### Candidate rejection 4: repair/alternate, initial

Raw program SHA256: `9ff457d1e8c84b369a58b3f366ad5eac3a047b12fc4feb81271032fda68de5cd`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"g4","y":"g5","coordinateSpace":"world"}
  ```

#### Candidate rejection 5: repair/primary, initial

Raw program SHA256: `ffde4e9dbabc045af88440284e41a25b19a0fdc20e640fa011e18941b4aba38f`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":1,"y":1,"coordinateSpace":"world"}
  ```

Finding: every captured linear inequality matches the original relation. Extra standalone `axes`/`point` constructions persist in the rejected atomic document; this is the ownership branch of `linear_source_mismatch`, not a spacing/Unicode/ordering/scaling equivalence failure.

## Ungraded second-repeat prefix empties — not a second measured verdict

### r2 — `sys06-cbse10-unique`

Question: `Solve the pair x + y = 6 and x - y = 2 by the graphical method. Label their point of intersection.`

- Captured `emptyCause`: `fallback_suppressed`; reason: `solver_contradiction`; degradation: `solver_contradiction`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r2-candidate/runs/maths_h3r6_shaded_regions_sys06_cbse10_unique_q1.json`.
- Original run SHA256: `eca1d5aff7ad3fcbda05e3de68ea47f34d2c573df6a422eb3b60b0cb0f4a1fff`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

No rejected candidate or rejected operator argument exists in this capture. The following is the complete **persisted solver summary**, not a reconstructed full solver audit:

```json
{
  "status": "contradiction",
  "issueCodes": [
    "value_type_mismatch"
  ],
  "hasProjection": false,
  "projection": null
}
```

Persisted plan unknowns and derived values:

```json
{
  "unknowns": [
    {
      "id": "ux",
      "symbol": "x"
    },
    {
      "id": "uy",
      "symbol": "y"
    }
  ],
  "derived": [
    {
      "id": "ux",
      "symbol": "x",
      "value": 4
    },
    {
      "id": "uy",
      "symbol": "y",
      "value": 2
    }
  ],
  "qualitativeClaims": [
    {
      "id": "c1",
      "expected": "Intersection: (4, 2); both equations hold because 4 + 2 = 6 and 4 - 2 = 2."
    }
  ]
}
```

Suppressed fallback:

```json
{
  "figureSource": "source_grounded",
  "family": null
}
```

Captured model-program calls below were **suppressed, not recorded as rejected operator calls**. They are included to distinguish the available model scene from the final authority block.

#### Model response plan/primary, selected marker `True`

- `make_axes` / `axes`: `{"xMin":-1,"xMax":7,"yMin":-2,"yMax":7}`.
- `make_line1` / `function_curve`: `{"expression":"6-x","variable":"x","xMin":0,"xMax":7}`.
- `make_line2` / `function_curve`: `{"expression":"x-2","variable":"x","xMin":0,"xMax":7}`.
- `find_intersection` / `intersection`: `{"first":"line1","second":"line2"}`.

The stored plan-derived `(4,2)` satisfies both source equations exactly: `4+2=6` and `4−2=2`. A numeric disagreement with these recorded coordinates is not evidenced by the stored solver code.

### r2 — `nl09-union-puncture`

Question: `Let A = [-3, 1) and B = (1, 4]. Represent A union B on a number line and state whether 1 belongs to it.`

- Captured `emptyCause`: `candidates_invalid`; reason: `representation carries no readable label`; degradation: `candidate_invalid`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r2-candidate/runs/maths_h3r6_shaded_regions_nl09_union_puncture_q1.json`.
- Original run SHA256: `827324b391d11f0631b78efe805e343a6514a8ba9d637d8e1f793f881353b147`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

All **6** rejected candidate validations and exact operator arguments follow. Argument strings below are unchanged from retained `rawArguments`. Each call identifies its construction index/ID and attribution; a document-level ownership rejection is not proof that an individual extra point or axes operator failed its own geometry check.

#### Candidate rejection 0: plan/primary, initial

Raw program SHA256: `daefcdeee0ab05443a63174596d3c43a3d185b33e3bd68581d301387535e2bde`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "invalid_linear_region",
    "message": "A linear source clause requires exactly one comparison",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "union"
    ]
  }
]
```

- Construction `0` / `construct_union`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"inequality":"g1 <= x < g2"},{"inequality":"g2 < x <= g3"}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "union",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membership",
      "kind": "callout",
      "targetIds": [
        "union"
      ],
      "text": "1 ∉ A ∪ B"
    }
  ]
}
```

#### Candidate rejection 1: plan/alternate, initial

Raw program SHA256: `19515d3a7559f8fb4b0dc759bcc1dd23cddd5d50e90be6b1f68bc4429478ceef`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "invalid_linear_region",
    "message": "A linear source clause requires exactly one comparison",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "unionSet"
    ]
  }
]
```

- Construction `0` / `constructUnion`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"inequality":"g1 <= x < g2"},{"inequality":"g2 < x <= g3"}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "unionSet",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membershipAnswer",
      "kind": "narration",
      "targetIds": [
        "unionSet"
      ],
      "text": "1 ∉ A ∪ B"
    }
  ]
}
```

#### Candidate rejection 2: repair/primary, initial

Raw program SHA256: `91daff8ec1dd89b4eac607a450c7e77b8c3b1365d8fe2d9be4247d91fa853b31`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "untrusted_linear_claim",
    "message": "Linear solution values and boundary semantics must be emitted by the verified operator",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "union"
    ]
  }
]
```

- Construction `0` / `construct_union`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"intersection":[{"inequality":"-3<=x"},{"inequality":"x<1"}]},{"intersection":[{"inequality":"1<x"},{"inequality":"x<=4"}]}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "union",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membership",
      "kind": "narration",
      "targetIds": [
        "union"
      ],
      "text": "1 ∉ A ∪ B."
    }
  ]
}
```

#### Candidate rejection 3: repair/alternate, initial

Raw program SHA256: `b9b2083da399b44863b49c5386f032cf7c79153d01d7861ca07e4eaf48d88d26`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "untrusted_linear_claim",
    "message": "Linear solution values and boundary semantics must be emitted by the verified operator",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "union"
    ]
  }
]
```

- Construction `0` / `construct_union`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"intersection":[{"inequality":"-3<=x"},{"inequality":"x<1"}]},{"intersection":[{"inequality":"1<x"},{"inequality":"x<=4"}]}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "union",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membership",
      "kind": "narration",
      "targetIds": [
        "union"
      ],
      "text": "1 does not belong to A ∪ B."
    }
  ]
}
```

#### Candidate rejection 4: repair/alternate, initial

Raw program SHA256: `f626bd0529b5f72c6bf6d793ce9e8652627b6729fce8dbaf974c8f3bab2556b9`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "untrusted_linear_claim",
    "message": "Linear solution values and boundary semantics must be emitted by the verified operator",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "unionSet"
    ]
  }
]
```

- Construction `0` / `constructUnion`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"intersection":[{"inequality":"-3<=x"},{"inequality":"x<1"}]},{"intersection":[{"inequality":"1<x"},{"inequality":"x<=4"}]}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "unionSet",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membership",
      "kind": "narration",
      "targetIds": [
        "unionSet"
      ],
      "text": "1 ∉ A ∪ B."
    }
  ]
}
```

#### Candidate rejection 5: repair/primary, initial

Raw program SHA256: `50ac33a530c4e0c923729a88c1e6cd46f8c0ef5f9501add15faa699920fff064`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "untrusted_linear_claim",
    "message": "Linear solution values and boundary semantics must be emitted by the verified operator",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "unionSet"
    ]
  }
]
```

- Construction `0` / `constructUnion`, operator `number_line_set`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variable":"x","expression":{"union":[{"intersection":[{"inequality":"-3<=x"},{"inequality":"x<1"}]},{"intersection":[{"inequality":"1<x"},{"inequality":"x<=4"}]}]}}
  ```

Exact authored label/annotation fields from this raw program:

```json
{
  "entities": [
    {
      "id": "unionSet",
      "kind": "linear_region",
      "label": "A ∪ B"
    }
  ],
  "annotations": [
    {
      "id": "membershipAnswer",
      "kind": "narration",
      "targetIds": [
        "unionSet"
      ],
      "text": "1 ∉ A ∪ B."
    }
  ]
}
```

Finding: initial chained-comparison leaves are an argument-shape failure. The four repaired Boolean ASTs correctly represent `[-3,1) ∪ (1,4]`; their targeted `kind:"narration"` annotations retain `1 ∉ A ∪ B.` (three repairs) or `1 does not belong to A ∪ B.` (one repair). `validateLinearClaims` includes targeted annotation text in protected semantic claims, even when the annotation is narration. The retained message names that guard; this is neither a wrong set equivalence nor an entity-label `A ∪ B` mismatch. No source or guard was changed in response.

### r2 — `hp06-positive-strict-membership`

Question: `Graph x + 2y < 6. On the same graph, indicate whether P = (1, 1) is in the solution region.`

- Captured `emptyCause`: `candidates_invalid`; reason: `representation carries no readable label`; degradation: `candidate_invalid`.
- Original run: `.context/h3r7/source-equivalence/live-outputs/r2-candidate/runs/maths_h3r6_shaded_regions_hp06_positive_strict_membership_q1.json`.
- Original run SHA256: `83b771779d45b719971c4caca662d8dc0bc8bc519bf51b2bf00046444b35ba9a`.
- Final attempted-representation issues: `[]`. These do not replace candidate rejections below.

All **6** rejected candidate validations and exact operator arguments follow. Argument strings below are unchanged from retained `rawArguments`. Each call identifies its construction index/ID and attribution; a document-level ownership rejection is not proof that an individual extra point or axes operator failed its own geometry check.

#### Candidate rejection 0: plan/primary, initial

Raw program SHA256: `e1e952ca99d49557158ef868724df20f4d2a68063c794339aa8355a7bbe5b774`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-1,"xMax":7,"yMin":-1,"yMax":4}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x + 2y < 6"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"px","y":"py","coordinateSpace":"world"}
  ```

#### Candidate rejection 1: plan/alternate, initial

Raw program SHA256: `b61902a08c427011617e42b44a31d04087c21c39a6026acb0f9fd18c8a30dc52`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[1]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_axes`, operator `axes`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"xMin":-1,"xMax":7,"yMin":-1,"yMax":5}
  ```

- Construction `1` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"variables":["x","y"],"inequality":"x + 2*y < 6"}
  ```

- Construction `2` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"px","y":"py","coordinateSpace":"world"}
  ```

#### Candidate rejection 2: repair/alternate, initial

Raw program SHA256: `e4a13d85c8cd44b5fb555c9fbf1a91a6a2865f6906db0ad4224675a4e6860792`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":1,"y":1,"coordinateSpace":"world"}
  ```

#### Candidate rejection 3: repair/primary, initial

Raw program SHA256: `777b0b1bc99280c718a25c5f8f33f73ef6e9f495dd25cb64220723a146135e3e`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":1,"y":1,"coordinateSpace":"world"}
  ```

#### Candidate rejection 4: repair/primary, initial

Raw program SHA256: `d8c17784f3e278c06749df6541b94b09aa7f4f8ae26cfb1514598268c08cebb6`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x+2y<6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"px","y":"py","coordinateSpace":"world"}
  ```

#### Candidate rejection 5: repair/alternate, initial

Raw program SHA256: `8f074de810bd059deccb798da4c4e7021fcc3b4afb740e9c2eac15da5c3fb98f`. Original issue count `1`, omitted issues `0`.

Full retained validation errors:

```json
[
  {
    "code": "linear_source_mismatch",
    "message": "Linear figure marks must all be emitted by verified linear operators",
    "severity": "fatal",
    "path": "constructions[0]",
    "entityIds": [
      "solution"
    ]
  }
]
```

- Construction `0` / `make_solution`, operator `linear_half_plane`; attribution `reported_path_or_entity`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"inequality":"x + 2y < 6"}
  ```

- Construction `1` / `make_P`, operator `point`; attribution `candidate_rejected`, error indices `[0]`, omitted attributed errors `0`:

  ```json
  {"x":"px","y":"py","coordinateSpace":"world"}
  ```

Finding: every captured linear inequality matches the original relation. Extra standalone `axes`/`point` constructions persist in the rejected atomic document; this is the ownership branch of `linear_source_mismatch`, not a spacing/Unicode/ordering/scaling equivalence failure.

## Solver audit-detail gap

The original run JSON persists only solver status, issue codes and projection fields. `otherDetailedDiagnostics` is empty for both affected captures. The matching server logs contain no `value_type_mismatch` or full solver audit message. Therefore the actual runtime **message, requestId, quantityId, returned value type and approximate value** cannot be recovered from these artifacts. They are deliberately not fabricated here. Zero truncation flags do not imply that fields omitted by the original serializer were captured.

The measured candidate's unchanged `packages/scene-engine/src/ir/solverAuthority.ts` defines `value_type_mismatch` in the condition `value.valueType !== "scalar" || typeof value.approximate !== "number"`; its message template is `bound TurnPlan quantity ${unknown.id} requires a scalar solver value`. This is a **source-code explanation of the error class, not a recorded message from these runs**. It does not tell us which condition or actual solver binding triggered either case. Measured-source file SHA256: `26b8d42fefe92725f4da3cceecf86b0696277ccedf5802913a93e92f0ce9422f`.

## Truncation/omission audit across all 77 new captures

The ledger contains 40 first-repeat and 37 second-prefix captures, all with distinct `(rep,rowId)` identities. All 77 referenced original run JSON SHA256 hashes match. Every one of the 447 per-operator diagnostic references resolves to the retained candidate error list; no invalid reference was found.

| Explicit field/flag | Occurrences | Nonzero/true values |
| --- | ---: | ---: |
| `candidateRejections[].omittedIssueCount` | 157 | 0 |
| `rejectedOperatorCalls[].omittedErrorCount` | 447 | 0 |
| `rejectedOperatorCalls[].truncated` (argument) | 447 | 0; all false |
| `rejectionEvidenceTruncation` objects | 77 | 0; all three counters zero |
| `.candidateRecords` cap counters | 77 | 0 |
| `.candidateIssues` cap counters | 77 | 0 |
| `.operatorRecords` cap counters | 77 | 0 |
| Per-issue `truncated` detail objects | 0 | 0 |
| Decline-reason `truncated` flags | 0 | 0; no stated decline records |

There are **157 rejected candidate records containing 204 errors**, and their declared `issueCount` sums to exactly 204; **447 rejected operator-call records**; **zero omitted records/errors, shortened issue fields or truncated argument flags**. The largest retained error message is 120 UTF-8 bytes and the largest retained argument is 240 bytes. Observed maxima are six rejected validations per run, five issues in one validation, and 20 rejected calls in one run. These limits leave the measured records well below their caps.

Serialization limits are 32 rejected validation records per run, 64 errors per record, 128 rejected calls per run, 2048 UTF-8 bytes per error message/argument or decline reason, 512 per path, 128 per code/entity ID, and 16 entity IDs per issue. Field truncation would retain original lengths or shortened/omitted ID counts; record/issue omissions would be explicit. The audit counts every explicit truncation/omission flag in the captured objects, rather than treating raw model text as instrumentation.

Captured error codes over all 77 rows (not just empties):

- `derived_role_operator_mismatch`: 10.
- `duplicate_id`: 1.
- `empty_required_scene`: 5.
- `invalid_derived_value_label`: 4.
- `invalid_linear_region`: 19.
- `linear_source_mismatch`: 97.
- `untrusted_linear_annotation`: 15.
- `untrusted_linear_claim`: 53.

## Recommendations — not implemented or measured

1. Repair the planner/composite ownership contract generically so a source-given point is emitted by the verified composite and does not create a duplicate standalone point or axes construction. Give ownership refusals a diagnostic class/message that cannot be mistaken for mathematical inequivalence. Preserve atomic refusal of unverified marks.
2. Make the one-comparison-per-leaf Boolean shape unmistakable in the generic contract; use source literals in affine strings, retain interval endpoint strictness and grouping, and keep derived membership claims in engine-owned presentation/teaching authority. A corrected AST alone does not remove a protected solved annotation.
3. Investigate scalar/tuple request binding separately from source matching. Before a future authorized run, persist a safe whitelist of full solver audit fields so `value_type_mismatch` can be traced to the actual request and quantity. Do not bypass the contradiction guard because the planner's displayed numbers happen to satisfy the source.

No recommendation was applied after the measured source freeze; no new paid run was launched. Required-empty safety still fails in the complete first repeat, and the incomplete ungraded prefix cannot supply the requested second result.

## Evidence hashes

- `empty-diagnostics-r1.json`: `6a409f1f33b95632d22de9738ec3db425e5193bfb25ab20ca81c1ff7edc2bdf2`.
- `empty-diagnostics-r2.json`: `a62393e7a0a0de19f5fd9456f3aa5c6a16351612bf00ffe7d9b034bf7e03ee3d`.
- `all-new-rejection-diagnostics.jsonl`: `7233da5beea2683637116fb17bb393d12ed4209586011c297d105a3b50bf6a0e`.
