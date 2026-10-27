# LLM provider: Azure gpt-6.1-sol, a relay, or Fireworks Kimi K3

One switch, `LLM_PROVIDER`, picks who serves every model call. Code:
`apps/tutor/lib/llm/llmProvider.ts`. Gate: `scripts/verify/verify-llm-provider.ts`.

| Setting | What runs |
|---------|-----------|
| `LLM_PROVIDER=azure` plus `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Every lane calls the one Azure AI Foundry deployment through the OpenAI v1 API (`<endpoint>/openai/v1/chat/completions`, `Authorization: Bearer <key>`) |
| `LLM_PROVIDER=fireworks` or unset | The Kimi K3 lanes, exactly as before the switch |
| `azure` with any Azure variable missing | One `[llm]` error in the log, then Fireworks |
| `LLM_PROVIDER=openai_compat` plus `OPENAI_COMPAT_BASE_URL` (ends in `/v1`), `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL` | Every lane calls one model on an OpenAI compatible relay (`<base>/chat/completions`), with the Azure body translation. See "Relay" below |
| `openai_compat` with any variable missing | One `[llm]` error in the log, then Fireworks |

Lanes covered: planners (turn plan, scene, code lesson), fast planners,
teaching and fast teaching, Problem IR, the cheap notes lane, photo reading,
notes chat, and home suggestions. Every resolver in `fireworksModels.ts`
returns the deployment on Azure; models change in env, never at call sites.
Fast mode has nothing to choose on Azure, and the teaching retry has no
second deployment to move to, so it retries the same one.

## Azure resources (9 Oct 2026)

Subscription Sponsorship, resource group `heytutor-ai` in `southindia`,
Foundry resource `heytutor-foundry` (AIServices S0, custom domain
`heytutor-foundry.cognitiveservices.azure.com`), deployment `gpt-6-1-sol`:
model `gpt-6.1-sol` version `2026-09-29`, GlobalStandard, capacity 2000
(2M tokens and 2K requests per minute). Read the key with
`az cognitiveservices account keys list -n heytutor-foundry -g heytutor-ai`.

Price per 1M tokens: $2 input, $0.10 cached input, $10 output. Azure returns
no cost; `usageCost.ts` prices tokens (lane `gpt-6.1-sol`, env override
prefix `AZURE_GPT_SOL_`).

## What the deployment accepts (probed 9 Oct 2026)

| Parameter | Result | What the code does |
|-----------|--------|--------------------|
| `temperature` | Only the default 1. `0` and `0.3` are 400s | Dropped. Planners lose temperature 0 |
| `max_tokens` | 400, use `max_completion_tokens` | Renamed, plus reasoning headroom (low 2048, medium 4096, high 8192) because reasoning counts against it |
| `reasoning_effort` | `low`, `medium`, `high`, `xhigh`. `none` and `minimal` are 400s | `thinking: disabled` and `none` become `low`; a 1024 budget is `low`, 2048 is `medium` |
| `thinking`, `perf_metrics_in_response` | Unknown parameter, 400 | Dropped |
| `response_format` | `json_object` and strict `json_schema` both work | Passed through |
| `stream_options.include_usage` | Works; usage arrives on a final chunk with `choices: []` | Passed through |
| Image input | Works; read a printed kinematics question exactly | Passed through |
| Cache hits | `usage.prompt_tokens_details.cached_tokens` (plus `cache_write_tokens`) | Priced at the cached rate |
| Reasoning tokens | `usage.completion_tokens_details.reasoning_tokens`; no reasoning text is streamed | Recorded as `reasoning_tokens` on generations |
| Latency | `latency_checkpoint` with `service_ttft_ms`, `service_ttlt_ms` | Read into `ttft_ms` and `tokens_per_sec` |

Even at `low` the model reasons a little: 0 to 220 reasoning tokens per call
in the smoke run below.

## Smoke run, same harness, both providers (9 Oct 2026)

Three lessons through `runLecture` against a local dev server, one at a time.
"Ask to first word" is planning plus the teaching stream's first content.

| Lesson | Provider | Ask to first word | Figure (plan) | Teaching first token | Tokens in / out | Cost |
|--------|----------|------------------:|--------------:|---------------------:|----------------:|-----:|
| Physics, incline with friction | Azure gpt-6.1-sol | 41.4 s | 37.5 s | 3.9 s | 15.9k / 4.2k | $0.074 |
| | Kimi K3 Fast | 62.0 s | 60.1 s | 1.9 s | 33.2k / 6.7k | $0.275 |
| Maths, simultaneous equations | Azure gpt-6.1-sol | 41.5 s | 36.4 s | 5.1 s | 13.2k / 3.9k | $0.063 |
| | Kimi K3 Fast | 32.2 s | 27.3 s | 4.9 s | 16.4k / 2.7k | $0.108 |
| Photo, printed kinematics | Azure gpt-6.1-sol | 42.6 s (OCR 9.5 s before) | 37.9 s | 4.7 s | 19.7k / 6.1k | $0.098 |
| | Kimi K3 Fast | 28.5 s (OCR 3.7 s before) | 20.2 s | 8.2 s | 7.5k / 2.4k | $0.064 |

Lesson cost excludes photo reading (about $0.002 on Azure: 707 tokens in,
86 out). Kimi's photo lesson made fewer calls because Problem IR returned no
result. Kimi's first photo attempt stalled (planner deadline, then the teaching
first-content deadline) and was rerun. The figure tiers matched on physics
(question representation, no family operator on either) and maths
(qualitative); Kimi drew the photo question at exact tier, Azure at
qualitative. Three lessons are not a benchmark: Azure was steady near 41 s,
Kimi ranged 28 to 62 s, and Azure cost about a third as much. The earlier
lab baseline for Kimi K3 Fast was a 25 s p50 Ask to first teaching token
over 24 turns (startup latency work, 4 Oct 2026).

Azure output runs at roughly 50 to 80 tokens a second, so long planner JSON
(turn plan near 1,000 tokens) takes 15 to 20 s.

## Known gaps

- Home suggestions take 15 to 17 s on both providers against the route's 8 s
  timeout, so they fall back to the stock cards either way.
- The lecture lab's diagram example picker (branch
  `feat/diagram-eval-harness`) calls Fireworks directly with
  `DEFAULT_CHEAP_FIREWORKS_MODEL`, and its cost estimates use Fireworks
  prices. Lab scripts should use `resolveLlmEndpoint`, `providerChatBody`,
  `resolveCheapFireworksModel` and `calculateLlmCostDetails` instead.

## Relay: `openai_compat` (tokens-flow, probed 27 Oct 2026)

tokens-flow (`https://tokens-flow.com/v1`) resells `gpt-6-sol`, `gpt-6-astra`
and `gpt-6.1-sol`. Its errors are `new_api_error`, the open source new-api
relay that pools upstream accounts. Probe it with
`scripts/latency/compat-probe.ts` (parameters per upstream, caps, three real
turn plans through our parser, three teaching streams; about 40 calls).

| Finding | What the code does |
|---------|--------------------|
| One model name is served by two pools: `resp_...` ids (Responses API) and short `chatcmpl-...` ids. Split was about even | Planner generations record `relay_upstream` (`responses`, `chat_completions`) so drift shows in Langfuse |
| Most calls carry about 4,200 hidden prompt tokens; on turn plans the `resp_` pool reported them uncached (5,460 input for a 1,000 token prompt) | Billed as input at the relay's rates; nothing we can strip |
| `reasoning_effort` `none` passes on one pool and is a 400 on the other (3 of 6 calls); `minimal` is a 400 everywhere and took 49 to 69 s to fail | Azure translation, floor `low` (`OPENAI_COMPAT_MIN_REASONING_EFFORT` overrides) |
| `temperature`, `thinking`, `perf_metrics_in_response`, `service_tier` accepted (ignored) | Dropped as on Azure |
| `max_tokens` and `max_completion_tokens` are not enforced: a 16 token cap returned 77 to 399 tokens | The cap still sizes the spend reservation; it is an estimate, not a bound |
| `n` above 1 is a 400 | Every lane sends `n: 1` |
| `json_object`, strict `json_schema`, image input, streaming with `include_usage` and `[DONE]` all work | Passed through |
| Usage: the `chatcmpl-` pool adds top level `input_tokens`, `output_tokens`, `reasoning_tokens` | `parseProviderUsage` reads both shapes |
| Python urllib got a 403 (user agent filter); Node `fetch` is fine | Nothing |
| Turn plans with `TURN_PLAN_V3_PROMPT`: 9 of 9 valid. `resp_` pool 5 to 7 s, `chatcmpl-` pool 8 to 24 s | Measured in the lab before any rollout |
| Teaching stream first content: `resp_` 1.4 to 1.7 s, `chatcmpl-` 4.6 s | Same |

Circuit breaker (`CompatCircuit` in `llmProvider.ts`): a 401 or 403 opens it
at once; three 408, 429, 5xx or connect failures within a minute open it. While
open, `resolveLlmEndpoint` returns Fireworks (with `fallbackReason`) for five
minutes, so the next request and the client's startup retry run on Kimi K3 with
a Fireworks body and Fireworks prices. The failing call itself is not rescued.
It stays shut when `OPENAI_COMPAT_FALLBACK=off` or there is no
`FIREWORKS_API_KEY` (never mock lessons). The lab sets fallback off and refuses
to build a profile while the circuit is open, so a round measures only the relay.

Prices: lane `openai-compat`, env prefix `OPENAI_COMPAT_`, defaulting to the
Azure gpt-6.1-sol rates. The lab refuses a relay round until
`OPENAI_COMPAT_INPUT_USD_PER_1M` and `OPENAI_COMPAT_OUTPUT_USD_PER_1M` are set.
The relay lane only applies while `LLM_PROVIDER=openai_compat`, because its
model id is also Azure's.

