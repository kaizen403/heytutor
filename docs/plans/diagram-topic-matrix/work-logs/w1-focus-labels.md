# Verified focus names, 6 October 2026

Parent worker on cov/w1-focus-labels-20261006, based on landed handoff9031aac.
Integration pending; no READY, accepted count, main checkout or remote change.

The actual f459df7b AB/BA student lesson advertised numeric cell values as
names for entire arrays and described R1/R2 as rows of A. The verified scene
already names those anchors A, B, AB and BA, with roles source matrix A,
source matrix B, requested AB and requested BA. Actual runtime evidence is
`/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/batch-f459df7b/ab-ba-narration-blocker.json`.

The presentation dictionary previously chose the first label primitive for
each anchor, including the first cell of a compound figure. It now prefers
the entity label when that exact text exists in the compiled ink. Otherwise
it preserves the visible-label fallback, rather than inventing a label from
metadata. The teaching context also carries each verified entity role with
its focus target, so a requested result is described as that result. No
geometry, quantities, reveal order or diagram commands change. No family
router or question-specific teaching cue is introduced.

Regression gate `apps/tutor/scripts/verify/verify-w1-focus-labels.ts` compiles
three source programs (AB/BA, order and entries, transpose), checks the focus
dictionary with both normal and reversed primitive order, and checks a
generic compound object plus a measurement whose metadata name is not drawn.
The unpatched source fails immediately: A is advertised with its first cell.
Patched gate passes46 checks. Existing verified presentation and label
glossary gates pass. Existing intro pacing passes9 figures/22 beats/162 cued
commands/43 labels, with first strokes within400ms. Scoped ESLint and scoped
TypeScript of the changed source and gate pass. Initial temporary tsconfig
outside the worktree lacked Node type roots; adding the actual worktree's
Node type roots resolved the setup error, and the test fixture gained its
required groupId fields. Diff check passes. Per-package drawing, scene-engine
and tutor-core builds pass.

A fresh real AB/BA student run remains required after independent review and
landing. This patch supplies faithful context; it does not certify arbitrary
LLM narration. The separate captured wrapped-WRITE order/coordinate defect
is owned by Bohr in w1-wrap-order and remains a matrix READY blocker until
its fix is reviewed, landed and rendered. Native q5 and exhaustive matrix
variants are still outstanding for FULLY-CERTIFIED.

Only Rishi Vhavle is the commit author; no coauthors.
