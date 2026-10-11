# Independent stock health audit — 12 October 2026

Owner: `/root/r10_prompt_split`. This audit inspected metadata and source only: no images, crops, primary verdicts, judgment files, grading, model/provider requests, new Azure snapshots, delegation, source/runtime changes or retries. The only file written is this audit log.

## Frozen identities, configuration and copies

All four arms contain exactly 60 unique frozen IDs, with no missing/extra/duplicate IDs and exact questions and complete evaluation/rubric dictionaries. The 40/20 cohort split is unchanged; all inputs require figures. Input SHA-256: `acbb80c5d9dddcb57b127c4e27513c98970f129c034a10b758293ea57aaa78be`.

Summary provider, execution and evaluation fingerprints match retained MAIN1; every row matches its provider and execution fingerprints: Azure `st-gpt-6-sol-h3`, `planner_examples_strict`, configured model, figure-only, concurrency 3, planner 60000ms, strict subjects `[maths]`, unchanged decline policy, no resume. Library fingerprint: `b3bdf087450a49c57e50c06f9c112e7caeb9005b62881e0daec9b92a01acd820`; exclusion fingerprint: `5615b026bbc2b13518c0cc48fcdb3f21d2ba7fe83852747a78d6e6eb497adc02`.

Verified 257 evidence metadata files against both original bytes and `evidence/artifact-hashes.jsonl`: 240 run JSONs, four each of summary/health/spend-checkpoint, frozen input, Azure pair and two server logs. Zero hash/size/copy mismatches. Image, crop and judgment bytes were deliberately not opened or rehashed. Frozen worktrees are clean at MAIN `9e50dd3e12db6113de5dbd56520f944af4156058` and regions `f2db27cb7ef4939e81a894f81467a6a6f8b11264`.

## Health findings

| Whole arm | Decision | Planner-deadline row upper bound | Advisory client deadlines | Actual noncancel network/fetch failures | Drawn / empty |
| --- | --- | ---: | ---: | ---: | ---: |
| Retained MAIN1 retry | Admit | 0 | 0 | 0 | 54 / 6 |
| branch1 | Admit | 0 | 3 | 0 | 47 / 13 |
| MAIN2 | Admit | 2 | 3 | 0 | 52 / 8 |
| branch2 | Exclude all 60 | 0 | 0 | 1 | 52 / 8 |

MAIN2 has two explicit stock 25000ms provider-attempt `TimeoutError` events at server elapsed 832572/832573ms. Timing matches `nl06-fractional-inequality` primary/alternate requests and that row's two 30001ms client outcomes, followed by a successful serial fallback. The retry logs lack trace IDs: attribution to one row is temporal inference, so the conservative bound is two affected rows, within the frozen allowance of four. The generic `provider fetch failed` event label does not override its explicit deadline cause. Do not claim zero MAIN2 planner deadlines.

Branch1 and MAIN2 each preserve three advisory accounting `transport` labels on nl01/nl02/nl03. Actual client assessments say the stock 3000ms advisory deadline; server logs show HTTP 200 responses. The accounting wrapper labels every thrown fetch error `transport`. All 60 merged visual requirements stay required. Retained MAIN1 and branch2 have zero advisory deadline labels. No actual connection/socket failure or HTTP >=400 is recorded in the admitted runs. Blank losing-call cancellation errors remain normal.

Branch2 records a noncancel primary-plan `fetch failed` on `maths|h3r8-finish-regions|shifted-triangle-minimum|q1`, HTTP null, 5449ms. Stock classification separates this from AbortError cancellation; the underlying socket cause is not retained. Its server section has no explicit provider-attempt deadline or additional nonempty error cause. Later HTTP 200 candidates do not erase the transport failure. Exclude the whole run; retain all 60 raw rows ungraded. Source/math refusals, invalid candidates, solver and subject/strategy misses remain quality outcomes, including those in admitted arms.

Structural cohort counts (committed marks only, no correctness judgment): MAIN1 frozen40 37/3 and independent20 17/3; branch1 30/10 and 17/3; MAIN2 36/4 and 16/4; excluded branch2 35/5 and 17/3 (drawn/empty).

## Existing Azure pair and response accounting

The copied pair exactly matches the originals. Before SHA-256: `83c72fb0162ca8fcc8b221f6ab3ab09e06492a5baf61cf79cc606ebfc9d40c7d`; after: `557406e137b09df6397b1f6c513fc780ce15d3343bd4cec0e45d74016dec5bf9`. Snapshot endpoints are 2026-10-11 20:22:20Z and 20:55:11Z; both begin at that UTC day's midnight, interval PT1M.

Prompt/generated totals: before 14,546,254 / 3,248,732; after 19,022,802 / 4,212,967; delta **4,476,548 / 964,235**. At recorded $2 input / $10 output per million, uncached arithmetic is **$18.595446**. New-run response metadata confirms 270,725 cached input tokens; the recorded $0.10 cached-input rate yields a confirmed discount of **$0.5143775**, giving **$18.0810685** after that credit only. No cache credit is assumed for unreported calls.

New response totals are branch1 $5.271250 + MAIN2 $4.792863 + excluded branch2 $5.132458 = **$15.196571**. Known tokens total 3,812,503 input / 808,589 output; exact cache-aware token arithmetic is $15.1965185, with $0.0000525 difference from summing stock six-decimal per-call cost rounding. Retained MAIN1's $4.578498 belongs to the prior job and is not added to the continuation cap. Excluded attempts still count toward spend.

Azure metrics are deployment-wide, may lag or include other usage, and lack per-run/cache breakdown; these are recorded-rate calculations, not an invoice. The known-response/metric difference and unreported cancellation usage remain visible. No additional snapshot or paid call was made.

## Disposition and limits

The frozen zero-transport rule excludes branch2; a whole retry cannot fit the remaining $0.803429 known-response allowance. The second pair and complete comparison remain incomplete. The three healthy full runs can support blind descriptive reporting, with no second-pair or readiness claim. This audit establishes input/configuration/copy/accounting and health evidence, not figure correctness; primary grades remain unread.
