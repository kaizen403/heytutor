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

- Aborted planner generations (level WARNING, `aborted: true`) are mostly by
  design. Measured 4 to 11 Nov 2026: 17 of 19 aborted `scene-planner-v2` calls
  were a peer stopped about a second after the winning lane's valid scene (the
  750 ms grace plus validation), hence the 10 to 13 s cluster at a 9 s p50;
  two were a repair round started with 11 s left of the 60 s figure deadline.
  Of 10 aborted `turn-plan-v3` calls, 4 were Stop, 3 a peer after the 3 s
  grace, and 3 hit the 20 s deadline: one turn's lanes both stalled, the other
  started its retry only after the slower lane also failed, with 5 s left (it
  now starts when the first lane fails).
- Each planner request sends a random `x-planner-request-id`, and its
  generation id derives from it. The server records `abort_source`
  (`client_closed`, `server_deadline`, `request_timeout`, `attempt_timeout`);
  the client's `planner-request-aborted` event merges `abort_reason`
  (`superseded`, `deadline`, `turn_cancelled`) into the same generation.
- Home suggestions take 15 to 17 s on both providers against the route's 8 s
  timeout, so they fall back to the stock cards either way.
- The lecture lab's diagram example picker (branch
  `feat/diagram-eval-harness`) calls Fireworks directly with
  `DEFAULT_CHEAP_FIREWORKS_MODEL`, and its cost estimates use Fireworks
  prices. Lab scripts should use `resolveLlmEndpoint`, `providerChatBody`,
  `resolveCheapFireworksModel` and `calculateLlmCostDetails` instead.

## Relay: `openai_compat` (probed 27 Oct and 3 Nov 2026)

A relay is an open source new-api server in front of upstream model accounts.
Probe one with `scripts/latency/compat-probe.ts` (parameters per upstream, caps,
three real turn plans through our parser, three teaching streams; about 40
calls) before anything else. The table below is what the first relay did; the
one production uses (below it) is much better behaved.

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

Guards in `resolveLlmEndpoint`: the base URL must end in `/v1` (a missing
`/v1` makes every call a 404) and carry no credentials, query or fragment; in
production it must be https, and the relay also needs
`OPENAI_COMPAT_ALLOW_PRODUCTION=1`, because a reservation sized by a cap the
relay ignores does not bound what a student's turn bills. Any failure logs one
`[llm]` error and serves Fireworks. If production has no Fireworks key either,
the chat and notes chat routes answer 502 (`providerUnavailableReason`, logged
once as `[llm] refusing lessons`) rather than mock lessons, which would be
canned and unbilled; this also covers a misconfigured Azure env. Not 503: the
client reads a bare 503 as a billing outage. Notes chat refuses before saving
the student's message. Failed turn telemetry tags such a turn `unknown`, not
`mock`. Relay reservations also add
`RELAY_HIDDEN_PROMPT_TOKENS` (4,500) of input (`paidUsage.ts`).

Circuit breaker (`CompatCircuit`, kept on `globalThis` so every route bundle
shares it): a 401, 402, 403, 404 or 410 opens it at once; three 408, 429, 5xx
or connect failures within a minute open it. The chat route reports once per
request (the response that ended its retries, or a connect failure on every
attempt; a planner success only once its body has been read), never for a
student who left or a planner deadline. A 400 never counts. Failed turn
telemetry tags the configured provider, as `openai_compat_circuit_open` when
the circuit was open at checkpoint time. While open, `resolveLlmEndpoint` returns Fireworks (with
`fallbackReason`, recorded as `llm_fallback_reason` on generations) for five
minutes, so the next request and the client's startup retry run on Kimi K3 with
a Fireworks body and Fireworks prices. The failing request itself is not
rescued. It stays shut when `OPENAI_COMPAT_FALLBACK=off` or there is no
`FIREWORKS_API_KEY` (never mock lessons). Routes that await between resolving
the endpoint and picking a model (home suggestions, notes chat) pass
`endpointEnv(llm)` to the resolvers so the two cannot disagree. On Azure and a
relay the planner no longer blacklists a model that answered 404 or 410: there
is no second model, so the blacklist stopped figures until a restart.

The lab refuses a relay round unless `OPENAI_COMPAT_FALLBACK=off` and all three
`OPENAI_COMPAT_*_USD_PER_1M` prices are set; the runner prints the server's
reason. Its worst case per call includes the hidden prompt allowance.

Known limits (second review, 27 Oct 2026): one student turn sends about five
relay requests at once, so one bad turn can open the circuit for everyone, and
a single 403 or 404 opens it at once; slow planner calls that hit our own
deadlines never count; output caps are still not enforced on streams, which is
why production needs the explicit opt-in.

Prices: lane `openai-compat`, env prefix `OPENAI_COMPAT_`, defaulting to the
gpt-6-sol rates measured on the production relay (below).
The relay lane only applies while `LLM_PROVIDER=openai_compat`, because its
model id is also Azure's.

### The production relay (gpt-6-sol, 3 and 4 Nov 2026)

No hidden prompt, token caps enforced, chat endpoint only needed. Calibrated on
its usage counter: gpt-6-sol and gpt-6.1-sol $10 per 1M output, $2 input, $2.50
on the first send of a long prompt, $0.20 cached; gpt-6-astra $50 output. No 429
up to 30 parallel streams (162,000 output tokens a minute at 140 tok/s per
stream on gpt-6-sol). It is plain http, so production needs
`OPENAI_COMPAT_ALLOW_INSECURE_HTTP=1`: an owner decision, recorded 4 Nov 2026.
The address and key live only in env files; this repo is public.

### AI credits tracker

The admin Overview shows total AI credits against `AI_CREDITS_MONTHLY_USD` ($1,000)
per cycle, turning over on the day of `AI_CREDITS_CYCLE_ANCHOR` at midnight India
time. `lib/admin/aiCredits.ts` reads the relay's `/v1/dashboard/billing/usage`
counter (`total_usage`, cents, the key's whole life) once a minute into
`ai_credit_cycles`. Only the counter sees every call on the key: failed attempts,
aborted streams, staff, lab and local runs, which the per user ledger leaves out.
The counter can dip, so spend is measured from its high water mark and only two
readings in a row below half of it count as a refill's reset. Sentry alerts once
each at 50, 80 and 95%, and again at the switch. $5 before the budget,
`compatCircuit.setBudgetExhausted` sends new requests to Fireworks until the next
cycle, because the relay may refuse requests near its own limit; an unreadable
counter keeps the saved decision and never blocks a lesson. If the relay is refilled
mid cycle, raise `AI_CREDITS_MONTHLY_USD` and restart to move back. Voice and Fireworks spend are outside this figure. Gate:
`scripts/verify/verify-ai-credits.ts`.

## First relay against Fireworks, same harness (27 Oct 2026)

Same build, same local server, only the provider changed. Relay prices are a
proxy (Azure gpt-6.1-sol rates); Fireworks is production routing (`--model
fast`, Kimi K3 Fast). Rounds under `apps/tutor/.lecture-lab/{relay,fireworks}-20261027`
and `*-ask-20261027`.

Diagram eval, 12 rows (`v1` physics, maths, chemistry, `--sample 12 --seed 27`,
`planner_examples_strict`, strict maths and physics, figure only):

| | Relay gpt-6.1-sol | Fireworks Kimi K3 Fast |
|---|---:|---:|
| Figures drawn | 2 (both partial, none wrong) | 3 (1 mostly right, 2 wrong) |
| Rows lost to the 60 s figure deadline | 2 | 0 |
| Mean time per row | 31.3 s | 17.8 s |
| Mean time to commit a figure | 30.4 s | 23.2 s |
| Example picker timeouts | 4 of 6 | not hit |
| Measured cost | $0.75 (proxy rates) | $1.82 (+ $0.83 unresolved) |

Wrong on Fireworks: the Wheatstone bridge was wired wrongly; latus rectum put
three conics on one set of axes with the parabola's vertex off the origin.
Partial on the relay: the series-parallel network had no source; drift velocity
was one double arrow. Twelve rows judged by eye is not a quality result.

Full lessons, four asks one at a time (incline with friction, simultaneous
equations, horizontal projectile, VSEPR water):

| | Relay | Fireworks |
|---|---:|---:|
| Ask to first word | 67.3, 37.8, 67.4, 13.1 s (median 52.6) | 28.5, 14.0, 22.0, 6.1 s (median 18.0) |
| Teaching first token | 4.3 to 7.2 s | 1.0 to 1.6 s |
| Figures | 1 of 4 | 2 of 4 |
| Missing required figure | 3 (two hit the 60 s deadline) | 2 |
| Measured cost | $0.48 (proxy rates) | $0.87 |

Cancelled calls are unmetered in the lab and booked at their full ceiling: 17
on the relay round (ProblemIR past its 18 s client deadline, picker timeouts,
the losing turn plan lane), 9 on Fireworks. Relay latency depends on which
upstream pool answers: the `resp_` pool planned in 5 to 7 s, the `chatcmpl-`
pool in 8 to 24 s.

Verdict: the relay fails the rollout rule (no more wrong figures, no more
failed turns, and clearly better latency or cost). It is about three times
slower to the first word, misses more required figures through deadlines, and
its real price was unknown. That relay was not adopted.

