# Production incline lecture diagnosis

Investigated on `main`, based on production commit `4e4942f`.
Changes are local and have not been deployed.

## Affected runs

Question: “Explain how to draw a free-body diagram for a block on a rough incline, and show how friction enters Newton's second law.”

| UTC start | Board | Trace |
| --- | --- | --- |
| 2026-09-22 17:56:24 | `ba4f87f6-6669-4f09-9810-969e6fdaf724` | `473f1d5d-4d6a-4564-a1f2-de1e2dd7b7d9` |
| 2026-09-22 17:58:01 | `82e257a6-b8c7-44c7-b37a-6f82b123f482` | `313da0bc-4e85-4c77-950e-6cd6e8228e8c` |

The linked board contains no saved turns. The traces show both attempts were
cancelled before persistence, after roughly 78 and 152 seconds.

## Evidence and fixes

- Production `/api/tts/stream` repeatedly returned 401. A direct authenticated
  provider check returned `invalid_api_key`. The local keys also failed. A
  working ElevenLabs credential is required to restore the intended voice;
  no credential was changed during this investigation.
- Browser speech fallback never reported starting in the latest trace. Each
  segment waited 16–31 seconds before timing out. Browser fallback now resumes
  the speech queue, limits startup waiting to 2.5 seconds, settles cancellation
  even without browser events, and ignores callbacks from cancelled speech.
- Drawing waited for speech, then skipped its ink at eight seconds. Silent
  speech used to count as success. It now reaches the existing repeated-failure
  policy, shows a retry error, and is excluded from recorded segments.
- Inline FOCUS tags split “the block … sits on the incline …” into separate
  speech requests. Non-code teaching now emits a complete STEP with all its
  pointing/writing cues. Code-conductor segmentation remains unchanged.
- The latest intro spoke “Next comes scene” and “force_component”. Presentation
  now uses entity reveal prose when the group lacks prose, and normalizes role
  names before speaking them.
- Original lessons had 29 and 31 steps, repeated definitions/equations, and
  taught `f = μN` without consistently distinguishing static and kinetic
  friction. Concept lessons now have an idea-based budget, discourage filler,
  and require conditions before formulas and substitutions.
- A local replay exposed incomplete incline fallback geometry. `normal_at`
  was always hidden, including required normal reaction vectors. Required
  force/reaction vectors now render; optical normals remain helpers. The
  existing rough-incline builder includes a parallel friction arrow with a
  conditional explanation of its direction and a fatal parallelism assertion.

## Validation

New regressions cover browser speech lifecycle, silent speech failure,
continuous STEP speech across chunk boundaries, concept narration/pacing,
and visible perpendicular/parallel contact forces. Each underlying defect
was reproduced before its fix.

Both captured production transcripts replay as one continuous speech clip per
STEP (29 and 31), retaining their commands. Three live-model lab runs of the
same question produced 17, 15, and 16 steps; the last two distinguished static
and kinetic friction. The lab does not exercise actual audio playback. Its
remaining findings concern row/voice cue placement and, in the final run,
missing result emphasis. These samples do not establish perfect narration.

Passed: changed-package typechecks and lint (one existing hook warning),
drawing verification, scene-engine and family synthesis verification, intro
pacing, verified presentation, representation fallback, turn persistence,
speech startup/lifecycle, live writing sync, WebSocket fallback, lesson scope,
and concept prompt checks.
The tutor production build also completed successfully.

Broader checks encounter these failures, also reproduced in a detached checkout
of unchanged `4e4942f`:

- `verify-work-energy-visuals`: missing vertical-circle family fixture.
- `verify-tts-lookahead`: prefetch opens no context in the test harness.
- `verify-lecture-page-halt`: source-text check expects the old `stopTurn`
  signature.

Raw production captures remain outside the repository. Local generated runs
are under `apps/tutor/.lecture-lab/incline-repair*` (ignored by Git).
