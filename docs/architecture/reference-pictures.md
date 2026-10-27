# Reference pictures

A default-off tier (`DIAGRAM_REFERENCE_PICTURE=on`) that shows a real diagram
when no verified figure is drawn: biology (subject `other`), and maths,
physics or chemistry turns whose verified figure failed. The owner approved it
on 26 Oct 2026 as an explicit exception to AGENTS.md rule 2.

It is not scene-engine geometry and is never counted or presented as verified.
`figureSource` and `diagramResultStatus` stay `text_only`, so every engine
metric still reads the turn as text only. Its own outcome is
`sceneArtifacts.referencePictureOutcome`.

## Why this cannot draw something false the way #245 did

The parked floor tier (#245) built figures from the model's understanding of
the question, so the model's mistakes became the figure. Here the picture's
content comes from a person: a free licence Wikimedia Commons file. The model
only chooses, and a vision judge rejects anything wrong, off topic, misspelled,
unlabelled (numbers only), foreign language, watermarked, crowded, or a bare
symbol. A decline teaches as text, exactly as before. Generated pictures are a
second source, off until an images endpoint is configured; they must carry no
text and pass the same judge.

## Pipeline (server, `apps/tutor/lib/reference-picture/`)

1. `pictureQuery.ts`: one cheap call (DeepSeek V4.1 Flash) writes the topic
   ("must show") and 2 to 4 Commons search phrases, or says no picture helps
   (calculations, essays). A deterministic guard (`questionSpecificFigure`)
   then declines any graph, circuit, ray, force or chart topic whose question
   states numbers: that figure is the question's own, a stock picture would
   carry other values, and the verified engine draws it or the lesson is text.
2. `wikimediaSearch.ts`: Commons search, filtered to CC0, public domain, CC BY
   and CC BY-SA; drops translated files by title suffix, tiny or extreme
   aspect files; ranks drawings and English files above scans.
3. `pictureJudge.ts`: Ember-1 reads the picture and its labels. A numbered
   diagram is accepted only with a complete English key (from the picture,
   else the author's description, at most 24 entries, every mark matched one
   to one, any misspelling rejects); a picture labelled in words beats it. It is the only
   Fireworks model that read all 22 labels of a Commons animal cell on 27 Oct
   2026; five others read one. Three candidates per round in parallel, a
   second round only when the first rejects all. A round ends 1.5 s after its
   first usable verdict (`ROUND_GRACE_MS`) instead of waiting for its slowest
   call, and each call is capped at 25 s.
   **Fact check** (`factCheckPicture`): beside every judge call runs a second
   Ember-1 call that lists each claim the picture states (numbers, ranges,
   names, pointers, arrows, order) and grades it correct, simplified or false.
   One false claim, or an unreadable check, rejects the picture. Measured 27
   Oct 2026: the judge alone accepted Commons "Atmospheric Layers.svg" (its
   stratosphere ends at 30 km, its mesosphere at 50 km) in one round after
   rejecting it in the round before; the fact check rejected it 3 of 3 times
   and passed five correct pictures 14 of 15 times (the miss was a misread
   arrow, which declines, never draws). Labels longer than 120 characters are
   captions and are dropped (`normalizeReferencePictureLabels`), never fatal.
4. `pictureGenerator.ts`: optional, any OpenAI-compatible images endpoint.
5. `strokePlan*.ts`: a sharp-only port of the whiteboard animation method from
   geeklee/srt-whiteboard-animation (MIT) and letuandat131/whiteboard-animation-vi
   (CC0): paper colour, ink mask, grid path outline strokes, lane sweep fill
   strokes, coverage checked to 100%. About 80 to 200 ms and 10 to 25 KB per
   picture; it yields to the event loop between stages, so the longest stretch
   it holds the one production process (which also relays TTS) is under 50 ms.
6. `pictureStore.ts`: Postgres (`reference_pictures`, migration 25) holds the
   picture, plan and the judge's reading; `reference_picture_queries` caches a
   topic's outcome (declines for a day) so a repeat skips the paid judge.

`POST /api/reference-picture` is paid (`picture` reservation kind, `paid` IP
bucket). The asset routes `GET /api/reference-picture/<id>[/image|/plan]` are
public and immutable: free licence pictures, no student data, and the landing
replay is anonymous.

## Authority

A picture id (`rp_` + 24 hex) exists only for a stored, judged picture.
`DRAW_PICTURE` is runtime-only (not in `DRAW_COMMAND_TYPES`), so the teaching
model can never emit it. The board admits it only with a valid id, entity
`reference_picture` and a placement inside `REFERENCE_PICTURE_ZONE`. On save,
`lib/scene/referencePicturePersistence.ts` loads the record and rebuilds both
passes from it; a missing record strips the picture and keeps the words.

## Board

`DRAW_PICTURE` params are `[x, y, w, h, pass, boardLengthPx]`, `text` the id.
`Whiteboard.drawPicture` lays a paper card in the picture's paper colour, the
pencil traces the outline strokes revealing only the ink mask, then sweeps the
fill strokes revealing the colour, then swaps in the exact picture and writes
the credit line. A numbered picture has a third pass: the pen writes its key
("1 Renal cortex", ...) in a column beside the card at figure label size,
wrapping rather than shrinking; `referencePictureLayout(record)` places picture
and key, and declines a key that would leave the picture under 240 px. Outline 4 to 14 s, fill 2 to 7 s at 1x, paced by stroke
length. Seek and export draw the final state instantly; assets are same-origin
so snapshots and MP4 export stay untainted.

## Turn

`useQuestionHandler` starts the request as soon as the turn plan wants a
figure (every subject but the chemistry lane), so for maths and physics the
search and judge run while the scene plans and add no wait when the figure
fails; a verified figure that wins aborts it. For subjects with no engine the
request is the whole wait before teaching. The turn waits up to 25 s past
scene planning. Two runtime beats introduce the
picture ("Here is a labelled diagram of ..." then "Let me colour it in."), and
the prompt addon lists the judge's labels, forbids drawing tags and allows only
`[FOCUS:reference_picture]`.

## Analytics

`/admin/pictures` (`lib/admin/pictures*.ts`, `features/admin/pictures/`) counts
saved lessons that needed a figure the engine did not draw, and of those how
many attempted, showed, declined (with reasons) or timed out a picture, by
subject, with median and p90 time, the stored picture library with use counts,
and the topic cache. The lab replays the same step with `--reference-picture`
(`scripts/lecture-lab/labReferencePicture.ts`, see docs/agent/lecture-lab.md).

## Measured

**Probe** (27 Oct 2026, 17 questions, `scripts/live/reference-picture-probe.ts`):
pictures for 10 of 15 questions that want one, none for the two that do not.

**Live lab rounds** (27 Oct 2026, 12 questions in 10 areas, Fast models, strict
arm as production, `--reference-picture`; full tables in the PR):
- Round 4, final pipeline, cold cache: the engine drew 2 (brine, diode
  graph); of the 10 it did not, a picture was shown for 5 (heart, mitosis cell
  cycle, Daniell cell, AC generator, Moon phases), correctly declined for 3
  (the v-t graph with numbers, a specific Venn diagram, myopia with no clean
  labelled file), and ran past the 25 s wait for 2 (atmosphere, water cycle).
  No shown picture was wrong; no stock picture ever appeared for a question
  with given numbers.
- Added wait before teaching: about 0 s for maths and physics (the search runs
  inside scene planning), 17 to 19 s for biology and chemistry where the engine
  plans nothing, capped at 25 s. A turn that stops waiting at the cap does
  not abort the request, so the search finishes and is cached: the next ask of
  that topic answered in 1 s. Any abort (a verified figure won, a Stop, a
  replaced turn) stops the server's work.
- Round 2 to 3 (grace rounds) cut engine-less waits from 20 to 25 s to 6 to 13
  s; round 4 (with the fact check) gave some of that back (17 to 25 s) in
  exchange for catching the false atmosphere picture.

Judge tuning that moved the numbers, so it is not undone by accident:
- The judge never sees the student's question (a shared picture must not be
  steerable by one student), so the topic carries the aspect asked about
  ("structure of the human eye", "stages of mitosis"). Without the aspect, a
  nerve diagram passed for the eye and one anaphase cell for mitosis.
- "Incomplete is not wrong": rejecting for a missing minor part declined the
  heart and the flower. Off aspect still rejects.
- Searches run in parallel and interleave, because the first phrase used to
  fill every slot.
- The fact check exists because the judge alone is not repeatable on numbers.

## Open

- A tab loaded before the key legend shipped would draw a numbered picture
  without its key; the stale-tab reload (#307) covers it at deploy.
- The 240 px legibility floor for a picture beside its key is a guess.
- For subjects the engine cannot plan (biology, geography), the picture
  request is the whole wait before teaching (17 to 25 s cold). Levers, not yet
  taken: prewarm common topics (`scripts/live/reference-picture-prewarm.ts`),
  or start the request at question submit instead of after the turn plan
  (saves the 3 to 9 s plan time; costs a query call on every lesson).
- Saving checks the flag: with the tier off no record resolves, so picture
  ink is stripped and the words kept.
- Accepted topics are judged again after 30 days. To purge one now, delete its
  `reference_picture_queries` row (and the `reference_pictures` row).
- Two `/admin/pictures` queries (recent lessons, library use counts) scan the
  period's lessons without the scoped id set: fine at today's volume and fail
  closed (read only, 15 s timeout), but join them to the scoped set before
  traffic grows.
- With the flag on, the early start reserves about seven judge ceilings of the
  student's balance for 10 to 40 s on every figure turn; a nearly empty
  balance could see its teaching reservation refused meanwhile.
