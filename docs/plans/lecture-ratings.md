# Lecture ratings

Every lecture asks the student how it went: one to five stars, and an
optional note. The question is asked twice at most, once while the lecture is
playing and once when it ends, and never blocks teaching.

## What the student sees

- **During** (lesson turns only, not a Continue): after the lecture has taught
  for `DURING_PROMPT_AFTER_MS` (60 s) from its first finished step, a small
  card floats at the top right of the board: "How is this lecture so far?"
  with five stars. It takes no layout, so the paper never refits mid-lesson.
  Untouched, it leaves after `DURING_PROMPT_VISIBLE_MS` (25 s).
- **After** (lesson and Continue turns): when the board goes idle and the turn
  has ended (complete, or stopped by the student), a card sits above the
  composer, the same place and style as the paused lesson bar: "Rate this
  lecture". If the student rated it midway, the card says so.
- Picking a star saves it at once. The note field then opens; Send updates the
  same rating. "Not now" or the × closes the card for that turn. Starting the
  next question closes it too.
- Never asked: doubt answers, a lesson that taught no step, replays, the
  Community viewer, the embed demo, admin Watch and the headless recorder
  (`SessionCapabilities.rateLectures`, on for `full` only).
- A reloaded board never asks about its old lectures: the prompt reads the
  tab's live save registry, which only holds turns taught in this tab.

## Storage

`lecture_ratings` (migration `28_lecture_ratings`): one row per
`(turn_id, moment)`, `moment` is `during` or `after`. Upserted, so a changed
star or a later note rewrites the row. `steps_taught` records how far the
lecture had gone. Cascades with its user, board and turn.

A rating is sent only once the turn's row exists (the registry's first
acknowledged checkpoint). A star picked earlier waits in the hook and is sent
when the save lands; if the turn is abandoned the rating is dropped.

## API

`PUT /api/boards/{boardId}/turns/{turnId}/rating`
`{ moment, stars, feedback?, stepsTaught? }`. Owner only; 404 for a turn that
is not on the caller's board; 400 for a doubt turn or a bad body. Feedback is
trimmed and capped at 1000 characters.

## Admin

`/admin/ratings`: average stars, count, response rate (rated lessons over
lessons taught in the window), the star distribution, and the newest ratings
with their note, question, student and moment. Filters: window (7, 30, 90
days, all), stars, has a note.

## Code map

| Part | File |
|------|------|
| Body parse, limits | `apps/tutor/lib/lecture-rating/ratingInput.ts` |
| Browser client | `apps/tutor/lib/lecture-rating/ratingClient.ts` |
| Route | `apps/tutor/app/api/boards/[boardId]/turns/[turnId]/rating/route.ts` |
| When to ask (pure) | `apps/tutor/features/tutor-session/lib/turn/lectureRatingPrompt.ts` |
| Prompt state and timers | `apps/tutor/features/tutor-session/hooks/useLectureRating.ts` |
| Send queue (tab-wide, outlives the board) | `apps/tutor/features/tutor-session/lib/turn/lectureRatingQueue.ts` |
| Card and toast | `apps/tutor/features/tutor-session/components/LectureRating.tsx` |
| Registry read | `LiveTurnSaveRegistry.ratableTurnFor` in `lib/turn/liveTurnSave.ts` |
| Admin | `lib/admin/ratingsQueries.ts`, `app/api/admin/ratings/`, `features/admin/ratings/` |
| Gate | `apps/tutor/scripts/verify/verify-lecture-rating.ts` |

## Later

- Quick reason chips on a low rating (too fast, wrong answer, figure was off,
  voice) so the notes can be counted, not only read.
- Join ratings to the Logs and Fails rows so a two-star lecture opens its
  trace.
- A phone layout check for the compact board chrome, where the composer is a
  panel and the after card shows only when that panel is open.
