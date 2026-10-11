# Regions approved for review under the owner’s revised bar

The owner now accepts **right rises, wrong falls, wrong plus required empty falls** for this PR. The first healthy 60-row pair passes: right 1→30, wrong 22→0, wrong+empty 28→13. Required empties increase 6→13 and drawn decreases 54→47; the previous empty ≤MAIN+2 gate failed and remains recorded in the historical report. The second regions run is excluded whole for a noncancel local fetch failure; no complete second-pair claim.

| Run | Drawn | Right | Partial | Wrong | Required empty | Wrong+empty |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Retained MAIN 1 |54|1|31|22|6|28|
| Regions 1 |47|30|17|0|13|13|
| MAIN 2 |52|0|33|19|8|27|
| Regions 2, excluded whole |52|—|—|—|8|—|

Excluded-run drawn/empty are structural only; its images were not judged. Every healthy run retains all 60 required rows. Frozen 40: MAIN 1 D37/R1/P19/W17/E3 vs regions1 D30/R20/P10/W0/E10. Additional 20, originally independently authored but now repair data: MAIN 1 D17/R0/P12/W5/E3 vs regions1 D17/R10/P7/W0/E3. [Full per-cohort and A/B counts](../../../../data/diagram-eval/v1/reports/linear-regions-measurement-20261012/counts.csv).

Sources measured: MAIN `9e50dd3e`, regions `f2db27cb`. This review branch merges current main `157992b3` without rebasing or force pushing; all scene/planner regions blobs remain frozen-identical. Prompt commits `554fc71c` and `0a819156` are absent and remain separately in draft [#151](https://github.com/kaizen403/heytutor/pull/151). No production change or topic acceptance increment.

Same frozen 60, 169-row leak-filtered library/full 60 exclusions, stock runner, maths production-strict, configured Azure, figure-only, concurrency 3, planner 60000ms. Retained healthy MAIN 1 unchanged; old 31-row prefix excluded. A/B 153 cards each, 146 agreements; 7 source-blind C disagreements all majority-resolved, zero recoveries. 40 anchors first without feedback: 35/40 A and B, 32/40 C, codex-reference consistency rather than human accuracy. Root image views 0.

The previous measurement spent response $15.196571 / Azure estimate $18.081069 (uncached $18.595446); publication and free replays start a separate new $20 cap. Publication spend $0. Scene-engine and tutor-core builds, scene-engine `verify:linear`, and tutor `verify:diagram-experiments` pass after merging main. Current measurements have not been repeated on the merged startup UI.

Latest portable inputs, PNGs, first streams, mapping, counts and health evidence are in `data/diagram-eval/v1/reports/linear-regions-measurement-20261012/`. Local complete stock plans/rejections and excluded-run artifacts remain under `.context/h3r10/finish-measurement/evidence/` for free replay. Stage 1 audit: `.context/h3r11/open-regions/stage1-audit.md`.
