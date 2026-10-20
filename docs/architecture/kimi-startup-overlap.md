# Kimi Fast startup: unchanged-opening preparation

## Result and scope

A default-off preparation-only change on main `565cb1781`. Spend: **$0**.
No model, voice, Jev, production, environment or database calls were made.
The 24 supplied lessons were recorded on 19 October with Kimi K3 Fast for
turn/scene/teaching, DeepSeek Flash for the picker, and TTS disabled.

**This does not demonstrate a reduction in time to first spoken word.** The
recordings have neither first audio nor the live first-usable-teaching-step
timestamp. Earlier synthesis might save the remaining TTS wait, or nothing if
the old lookahead already hid it. The roughly 20-second planning barrier remains.

## Critical path

The two initial TurnPlan lanes already race in parallel. Selection includes
consensus and up to a 3-second peer grace; if neither is valid, the alternate
retry is serial. Visual need starts alongside TurnPlan, not afterwards.
After selected TurnPlan, numeric ProblemIR starts before the visual-need join.
The example picker starts after that join and already overlaps ProblemIR.
With scene speculation off, scene planning waits for both. Final validation,
selection and presentation precede the figure-dependent teaching prompt.

Ordinary opening synthesis currently starts after planning; opening playback,
Given rows and the verified figure intro wait for the first usable teaching
step. A teaching nonmarkup text token is not that live gate, and neither event
is audible speech.

Recorded stages (nearest-rank p90; ordinary median):

| Metric | Median | p90 | Maximum |
|---|---:|---:|---:|
| TurnPlan, all 24 | 6.760 s | 14.626 s | 15.034 s |
| ProblemIR, 15 requested | 3.547 s | 6.200 s | 9.938 s |
| Picker, 16 requested | 1.928 s | 4.002 s | 4.003 s |
| Scene, 17 requested | 15.087 s | — | 38.412 s |
| Whole planning, all 24 | 20.225 s | 39.383 s | 54.019 s |
| Aligned nonmarkup first-content proxy | 20.928 s | 40.063 s | 54.762 s |

The last row is `totalMs - teachMs + teaching.ttftMs`, a reconstruction that
includes unseparated wrapper/post-teaching work, not an observed timestamp.
It explains the supplied 21/40/55-second values without calling them speech.
L10/L20/L22 have solver contradictions: this historical lab taught, while the
live hook stops before teaching. They are not live-success timing evidence.

L04: both initial plans rejected at 7.826/8.205 s, alternate retry accepted in
another 6.730 s; selected plan at 14.935 s. L08: initial plans rejected at
5.409/5.721 s, retry accepted in another 5.512 s; selected plan at 11.233 s.
L21/L22 have one rejected initial peer; L24 cancels an unused peer after grace.
Do not add the two parallel lane durations.

Visual need was unavailable in every recording (21 missing-key, 3 deadline);
its duration was not saved. Picker overlaps IR in 9/16 requested rows; 8 already
have zero picker tail. Total picker critical-path tail is 13.383 s across all
24, not the 35.074 s sum of picker durations. Scene is the largest stage in
16/24 lessons. Cancelled scene peers are censored, not naturally completed runs.

## Safe change and rejected shortcuts

`NEXT_PUBLIC_LESSON_OPENING_PREFETCH=1` prepares the **same original opening**:

- At the question stage only if both possible Given-row states yield identical
  complete segment bytes.
- Otherwise after deterministic correction and final numeric reconciliation,
  only if both possible board widths yield identical complete segment bytes.
- Never for doubts, resumes, DSA, paused/superseded turns or the separate early
  acknowledgement experiment. Contradictory/null authority cannot unlock the
  authority-dependent preparation.

It never enqueues, writes, plays, persists or modifies a prompt. The old final
prefetch remains as deduplicated fallback. A failed/stopped lesson stays silent.
The telemetry event `lesson-opening-prefetch-requested` records an attempt,
not accepted generation or audio readiness. Later failures can waste synthesis;
the flag remains off pending a live audio/cost check.

Speaking the opening before verification/usable teaching would add speech to
previously silent failure paths. Enabling the existing acknowledgement changes
both words and teaching prompts. Starting teaching before the verified figure
would change its geometry/focus addon. None satisfies strict all-outcome parity.

Moving the picker before consensus or visual need can change its full serialized
plan/subject request. The recordings do not retain first-accepted or pre-authority
plan bodies, so they cannot prove reusable request identity. A conditional
earlier-picker ceiling is only 7.146 s across 24 (0.298 s mean), not an established
saving. Removing retries would change selected plans. These shortcuts are not
shipped.

## Before/after: recorded-duration scheduling replay, not a new run

The model holds all recorded durations and verdicts fixed. Final planning and
teaching release are unchanged. No TTS latency is invented.

| Metric | Before | After |
|---|---:|---:|
| Planning median | 20.225 s | 20.225 s (held fixed) |
| Aligned first-content proxy median | 20.928 s | 20.928 s (held fixed) |
| Modeled prefetch-launch offset median, 21 admissible pairs | 19.749 s | 0 s (11 question-only) |
| Actual first spoken word | not recorded | not measured |
| Proven model critical-path saving | — | 0 ms |

11 rows are question-invariant, 10 authority-dependent, 3 blocked by authority,
in both English and Hinglish. Blocked rows have no normal live prefetch in
either arm and are excluded from the 21 launch pairs; their lab planning/TTFT
values remain in the 24-row timing table. The modeled paired launch head start
has median 15.104 s,
but the conservative interval for each authority-dependent row starts at zero
because stage epochs/visual tail/synchronous setup are missing. This is not a
15.104-second speech improvement, nor does the zero median launch offset mean
instant speech.

Safe IDs follow original manifest order. Milliseconds below; zero IR/picker/
scene is a skipped stage, not zero-latency I/O. `Plan` is unchanged before/after.
`Q: 0` is modeled planning-origin launch; admission is earlier but unrecorded.
`A: lower..Plan` is an estimated authority launch interval. TTFT is request-
relative nonmarkup text, not speech. No real questions or crops are included.

| ID | TurnPlan | IR | Picker / tail | Scene | Plan | Teach TTFT | New prefetch-launch model |
|---|---:|---:|---:|---:|---:|---:|---|
| L01 | 6356 | 0 | 1566 / 1567 | 11389 | 19749 | 692 | Q: 0 |
| L02 | 3213 | 0 | 1908 / 1908 | 21965 | 27243 | 695 | Q: 0 |
| L03 | 8716 | 3547 | 3268 / 0 | 20067 | 32406 | 828 | A: 12263..32406 |
| L04 | 14935 | 4042 | 1420 / 0 | 20212 | 39383 | 674 | A: 18977..39383 |
| L05 | 7913 | 1627 | 0 / 0 | 0 | 9556 | 751 | Q: 0 |
| L06 | 6190 | 2923 | 0 / 0 | 0 | 9139 | 745 | Q: 0 |
| L07 | 8844 | 0 | 0 / 0 | 0 | 8863 | 758 | Q: 0 |
| L08 | 11233 | 3513 | 0 / 0 | 0 | 14773 | 737 | A: 14746..14773 |
| L09 | 3739 | 3111 | 2291 / 0 | 5579 | 12482 | 736 | A: 6850..12482 |
| L10 | 4250 | 2551 | 4003 / 1457 | 6235 | 14520 | 584 | blocked: no launch |
| L11 | 5372 | 2420 | 0 / 0 | 0 | 7805 | 771 | A: 7792..7805 |
| L12 | 5027 | 3714 | 1672 / 0 | 7831 | 16637 | 774 | A: 8741..16637 |
| L13 | 3494 | 0 | 0 / 0 | 0 | 3499 | 720 | Q: 0 |
| L14 | 2837 | 1687 | 0 / 0 | 0 | 4527 | 728 | A: 4524..4527 |
| L15 | 7306 | 0 | 1769 / 1769 | 10110 | 19212 | 711 | Q: 0 |
| L16 | 7163 | 6060 | 2382 / 0 | 38412 | 51931 | 712 | A: 13223..51931 |
| L17 | 5178 | 3693 | 1393 / 0 | 12168 | 21258 | 743 | A: 8871..21258 |
| L18 | 11051 | 0 | 1340 / 1340 | 8764 | 21878 | 753 | Q: 0 |
| L19 | 5675 | 0 | 1250 / 1250 | 13515 | 20700 | 671 | Q: 0 |
| L20 | 14626 | 9938 | 0 / 0 | 29384 | 54019 | 738 | blocked: no launch |
| L21 | 15034 | 6200 | 2719 / 0 | 15087 | 36338 | 757 | A: 21234..36338 |
| L22 | 12115 | 5249 | 4002 / 0 | 17367 | 34885 | 734 | blocked: no launch |
| L23 | 5067 | 0 | 2144 / 2145 | 22426 | 29789 | 738 | Q: 0 |
| L24 | 10205 | 0 | 1947 / 1947 | 26584 | 38765 | 720 | Q: 0 |

Historical L09 figure admission differs under today's main selector. This is
reported, not interpreted as a new quality result; replay parity is OFF vs ON
against the **same current stock selector** and frozen historical inputs.

## Gates and reproduction

`pnpm --filter @heytutor/tutor verify:opening-preparation` executes synthetic
opening/prompt equality and actual-hook OFF/ON cases. The actual hook checks
raw visual/planner/teaching request **body** hashes, complete enqueue/playback/
board event payloads, selected plan/scene and error outcomes. It covers English,
Hinglish, a real verified figure, a numeric scene wait, acknowledgement
exclusion, control-only teaching failure, and Stop before/during planning.
TTS is mocked: neither provider audio bytes nor all HTTP headers are covered.

For private recordings:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-opening-preparation-recordings.ts \
  --records /path/to/round/runs --lessons /path/to/lessons.jsonl \
  --out /path/to/ignored/preparation-replay
```

24 payloads: 318 exact opening checks, 144 full prompt checks, all 24 payload
hashes unchanged. The `--mutate-opening` recording mode and
`--mutate-opening-prefetch` actual-hook mode fail deliberately. Empty/missing
recordings fail, never pass with zero work. Raw evidence and its manifests stay
ignored; the public tool embeds no private path or student text.

Also checked: legacy 34-pair opening/figure parity, 30-mode startup hook plus
symlink checks, 18 planning-overlap scenarios, startup telemetry, teaching prompt,
chat request parameters and TTS lookahead. Targeted lint and whitespace pass.

Broader checks are not fully green: tutor typecheck has the unchanged
`verify-board-empty-delete.ts:1` TS2578; `verify:startup` reaches its unchanged
fast-figure authority assertion at line 144 (null vs
`qualitative_verified/contact_body`). Those sources, engine/core packages and
representation fallback are identical to the base. No validator changes were
made to make these unrelated checks pass.
