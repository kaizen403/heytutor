# Diagram evaluation set v1: row format

One JSON object per line. Files live under `data/diagram-eval/v1/` on your own
branch made from `origin/main`. One file per subject: `physics.jsonl`,
`maths.jsonl`, `chemistry.jsonl`.

```json
{
  "id": "physics|5|newtons-second-law|q1",
  "topic_id": "physics|5|newtons-second-law",
  "subject": "physics",
  "difficulty": "easy",
  "ask_style": "exam_stem",
  "question": "A 2 kg block on a frictionless table is pulled by a horizontal force of 10 N. Find its acceleration.",
  "source": { "kind": "bank", "ref": "q_0135e0f6..." },
  "figure_need": "required",
  "figure_kind": "vectors_fbd",
  "must_show": ["one block on a horizontal surface", "applied force arrow pointing horizontally", "weight and normal force arrows"],
  "must_label": ["2 kg", "10 N"],
  "must_not_show": ["inclined plane", "pulley", "friction arrow"],
  "trap": null,
  "answer_facts": ["a = 5 m/s^2"],
  "notes": ""
}
```

## Fields

| Field | Rule |
|---|---|
| `id` | `topic_id` plus `|q1` to `|q4`. Unique. |
| `topic_id` | Copied exactly from `docs/plans/diagram-topic-matrix/topic-progress.csv` on `origin/main`. Never invent one. |
| `difficulty` | `easy`, `medium` or `hard`. |
| `ask_style` | `exam_stem` (a full question with numbers), `topic_ask` (a short request such as "teach me projectile motion" or "angles in a scalene triangle"), or `vague_or_misspelled` (how a student really types: "sine rull triangle", "magnet chapter doubts"). |
| `question` | The full stem a student would type. Prefer real stems from `data/question-bank/questions.jsonl` or `data/syllabus-probes/*.json`. Clean OCR damage but keep every number. Never append a drawing cue like "draw a labelled diagram" unless a student would really write it. |
| `source.kind` | `bank` (question bank id in `ref`), `probe` (probe id in `ref`) or `authored` (you wrote it; `ref` is null). |
| `figure_need` | `required` (cannot be taught well without a figure), `optional` (helps) or `none` (pure algebra, definitions, facts). |
| `figure_kind` | One of: `geometry`, `function_plot`, `circuit`, `ray_optics`, `vectors_fbd`, `motion_path`, `field_lines`, `wave`, `solid_3d`, `apparatus`, `molecule`, `energy_diagram`, `chart_table`, `none`. Pick the main one. |
| `must_show` | 2 to 6 short items a correct figure must contain: things you can point at on the board (objects, arrows, curves, axes, connections). Never an answer or a reasoning step ("the molar mass is 45", "kinetic energy compared by Z^2/n^2"): those go in `answer_facts`. Empty list when `figure_need` is `none`. |
| `must_label` | Values or names that must appear on the figure, with the exact numbers from the stem. Empty list if none, and always empty when `figure_need` is `none`. |
| `must_not_show` | The most likely wrong pictures for this stem: the neighbouring topic's figure, a wrong topology (series instead of two loops), a default value not in the stem. |
| `trap` | `null`, or one of `figure_absent` (stem says "shown in the figure" but gives no drawable description), `no_figure_needed`, `near_miss_topic` (words that point to a different topic's figure). A trap must read like something a student or an exam paper really says. Never write a stem that explains its own trap ("a figure is printed beside the question but is not needed"). |
| `answer_facts` | Optional. The key results a correct lesson must reach, for grading the teaching later. Not part of the figure. |
| `notes` | Anything a grader needs. Short. |

## The one rule that matters most

Write `must_show`, `must_label` and `must_not_show` from the question and your
subject knowledge only. **Never run the current engine to decide what the
expected figure is, and never copy from its output.** This set grades the
engine. If it is written from the engine, it measures nothing.

## Mix per topic

- 3 questions per topic:
  - one `exam_stem`, `easy` or `medium`
  - one `exam_stem`, `hard`
  - one `topic_ask` or `vague_or_misspelled`, written the way a student types
    it: short, no numbers, sometimes misspelled. For these, `must_show` is the
    one foundational picture of the topic, and `must_label` is usually empty.
- About 1 topic in 5 gets a fourth question that is a `trap`.
- Topics where nothing can be drawn still get rows, with `figure_need: none`.
  An honest text-only lesson is a correct answer there.

Why the third question: the real questions students have typed in
production so far are mostly short topic requests, often misspelled, not
exam stems. Several are Cambridge O Level, not JEE. Real student text is
private and never goes in this repository; the examples here are invented.
