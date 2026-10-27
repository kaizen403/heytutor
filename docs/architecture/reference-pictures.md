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
   (calculations, essays).
2. `wikimediaSearch.ts`: Commons search, filtered to CC0, public domain, CC BY
   and CC BY-SA; drops translated files by title suffix, tiny or extreme
   aspect files; ranks drawings and English files above scans.
3. `pictureJudge.ts`: Ember-1 reads the picture and its labels. It is the only
   Fireworks model that read all 22 labels of a Commons animal cell on 27 Oct
   2026; five others read one. Three candidates per round in parallel, a
   second round only when the first rejects all.
4. `pictureGenerator.ts`: optional, any OpenAI-compatible images endpoint.
5. `strokePlan*.ts`: a sharp-only port of the whiteboard animation method from
   geeklee/srt-whiteboard-animation (MIT) and letuandat131/whiteboard-animation-vi
   (CC0): paper colour, ink mask, grid path outline strokes, lane sweep fill
   strokes, coverage checked to 100%. About 200 ms and 10 to 25 KB per picture.
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
the credit line. Outline 4 to 14 s, fill 2 to 7 s at 1x, paced by stroke
length. Seek and export draw the final state instantly; assets are same-origin
so snapshots and MP4 export stay untainted.

## Turn

`useQuestionHandler` starts the request early only when the planner classed
the subject `other`; maths, physics and chemistry request it at the text-only
point. The turn waits up to 25 s more for it. Two runtime beats introduce the
picture ("Here is a labelled diagram of ..." then "Let me colour it in."), and
the prompt addon lists the judge's labels, forbids drawing tags and allows only
`[FOCUS:reference_picture]`.

## Measured (27 Oct 2026, 17 probe questions, `scripts/live/reference-picture-probe.ts`)

Final round, after the review fixes: pictures for 10 of 15 questions that want
one (animal and plant cell, heart, flower, neuron, eye, digestive system, cell
cycle for mitosis, photosynthesis, a Hinglish heart ask), none for the two that
do not (a quadratic, an essay). Declined: nephron, DNA, distillation, AC
generator, transformer, where Commons offered only numbered, unlabelled or off
aspect files. 7 to 19 s and about $0.01 to $0.04 a question; a repeat topic is
a cache hit in about 2 s. Every accepted picture was checked by eye.

Judge tuning that moved the numbers, so it is not undone by accident:
- The judge never sees the student's question (a shared picture must not be
  steerable by one student), so the topic carries the aspect asked about
  ("structure of the human eye", "stages of mitosis"). Without the aspect, a
  nerve diagram passed for the eye and one anaphase cell for mitosis.
- "Incomplete is not wrong": rejecting for a missing minor part declined the
  heart and the flower. Off aspect still rejects.
- Searches run in parallel and interleave, because the first phrase used to
  fill every slot.

## Open

- Numbered Commons diagrams (eye, heart, distillation variants) carry their
  key in the file description; accepting them needs a key legend on the board.
- The 25 s turn wait is derived from the route's stage caps, not measured on
  live turns. Read `reference_picture_ms` and `wait_ms` once the flag is on.
- The stroke plan (about 200 ms of synchronous work) runs on the one server
  process; move it to a worker thread before heavy use.
- Saving does not check the flag: a client may attach any stored picture id to
  its own text only turn. It affects only that user's lesson.
- Accepted topics are judged again after 30 days. To purge one now, delete its
  `reference_picture_queries` row (and the `reference_pictures` row).
