# Frozen independent image rubric

All 20 rows require figures. The denominator is always 20, including unsupported,
missing, skipped, question-representation-only, partial, unreadable, or failed
figures. Such cases are not removed, relabelled optional, or scored from narration
alone. A successful source/build check is not evidence of a successful figure.

Review the actual final rendered image against each row's frozen mathematical
oracle and figure requirements. A pass requires correct geometry, topology,
boundary inclusion, shading, requested point positions, exact corner/solution
values, complete optimum sets, and required legible labels. A representation that
only repeats the inequalities does not satisfy a request to graph their solution.
Mathematically equivalent exact labels are acceptable. Do not accept a rounded
coordinate as an exact rational coordinate when it changes the claimed answer.

Record distinct error categories even when several apply:

- `missing_figure`: no appropriate rendered figure, or only a text restatement.
- `wrong_geometry`: line, endpoint, point position, slope, intercept, or system
  relation differs from the oracle. Includes spurious intersections or separate
  geometry for coincident lines.
- `wrong_boundary`: solid versus dashed, open versus closed, or boundary membership
  is wrong. At a named point on a strict boundary, equality never grants membership.
- `wrong_shading_boolean`: wrong side, union/intersection/difference, gap, interval,
  domain restriction, or feasible-set shading. All Boolean operations range over
  the explicitly declared real domain.
- `wrong_membership`: a named source point's claimed membership is incorrect.
- `wrong_corners`: omitted, invented, rounded-as-exact, or incorrect feasible corner.
- `wrong_objective`: wrong per-corner score, optimum value, unique/multiple status,
  or omission of an optimal edge's interior. Compare exact Fraction values.
- `missing_label`: required line name/equation, boundary/corner coordinate, named
  source-point label, membership statement, objective score, or optimum designation
  is absent or unreadable. A mathematically correct unlabeled shape is classified
  here, not automatically as wrong geometry. If both are wrong, record both.
- `unreadable_layout`: overlap, clipping, or an unsuitable viewport prevents judging
  a required mathematical feature. This also fails the figure requirement.

Axes must be legible and consistent with the marked coordinates. Exact labelled
anchors, line relationships, boundary style, shading, and point membership jointly
determine correctness. Rendering precision alone is not an excuse for a wrong
mathematical label. Labels can use a clear legend/table to avoid overlaps; every
required named entity must still be unambiguously associated with its geometry.

No case may be softened or changed in response to implementation capabilities,
images, grades, or run outcomes. Report image passes out of 20 separately from
error-category counts; category counts can overlap.
