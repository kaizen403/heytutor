# Jev source review — 2026-09-22

Research snapshot for the [Accelute integration plan](../plans/jev-accelute-integration.md). Primary sources checked on September 22, 2026. This is documentation research, not a live Jev benchmark; no student content was sent to a provider. This file follows the repository's dated-snapshot convention.

## What Jev actually does

Jev evaluates supplied state against bounded questions. It does not generate teaching text, code, explanations, or arbitrary JSON documents. It can choose among supplied alternatives, grade an ordered rubric, or return the probability of a yes/no proposition. Independent questions share the same state and are evaluated in parallel; dependent decisions still require orchestration in application code. [TypeSafe introduction](https://docs.typesafe.ai/introduction)

The current direct model is `jev-1.13.0`; both `jev-latest` and `jev-preview` presently resolve to it. Direct limits are 64k tokens for state plus all questions, with a separate 32k cap for state plus the longest question. Inputs are text, including structured objects/arrays; image, audio, and video inputs are unsupported. Published limits are 250,000 tokens/second and 1,200 requests/minute, explicitly subject to change. English is its strongest language. Pin the version for calibrated production policies when the chosen transport supports it. [TypeSafe models](https://docs.typesafe.ai/models)

The Gateway catalog exposes `typesafe-ai/jev`, labels context as 32K, and dates the model release September 15, 2026. Do not infer that Gateway exposes every direct version ID or the larger aggregate question budget. [Vercel model listing](https://vercel.com/ai-gateway/models/jev)

## Decision semantics and limitations

| Primitive | Meaning | Engineering implication |
| --- | --- | --- |
| Choice | One supplied option, its distribution, and provider confidence | Include explicit `other`/`uncertain` options when the list is incomplete. |
| Score | Expected position across ordered rubric levels; may be fractional | Appropriate for graded relevance or completeness, not numeric extraction. |
| Noul / Gateway Boolean | Probability from zero to one | Threshold explicitly; the returned number is not a JavaScript boolean. |

TypeSafe's API allows at most 255 alternatives per Choice and two to ten Score levels. Its native endpoint is `POST https://api.typesafe.ai/v1/systemone`, using bearer authentication and `{model,state,questions}`. Native answers include `noul`; token usage uses `input_tokens`/`output_tokens`. Errors include 401, 422, 429, and overload status 529. [TypeSafe API reference](https://docs.typesafe.ai/api)

Choice and Score confidence summarizes their probability distributions; it is not an independently proved probability of correctness. Noul has no separate confidence field. Thresholds need labeled examples from the intended task. [Confidence documentation](https://docs.typesafe.ai/confidence)

The provider specifically documents unreliable arithmetic, counting, date comparison, multihop reasoning, numerical interpolation from Score values, irrelevant long context, and adversarial state. Semantically related questions and their negations need not obey logical identities. Typed output does not establish factual correctness. Accelute's solver, constraints, and geometry proofs must remain authoritative. Hindi/Hinglish and mathematical notation need their own evaluation slices. [Jev 1.13 known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

## Integration transports and SDK requirements

**Preferred initial transport for Accelute: a small server-side HTTP adapter.** Vercel documents `POST https://ai-gateway.vercel.sh/v1/evaluate`, bearer `AI_GATEWAY_API_KEY`, and the same top-level `{model,state,questions}`. Gateway uses `type: "boolean"` and returns `probability`, with camelCase `usage.inputTokens`/`outputTokens` and `providerMetadata` containing routing/cost data. OpenAI-, Anthropic-, and Cohere-compatible endpoints do **not** support evaluation. Replacing the model string in an existing chat-completions call therefore will not work. [Gateway evaluation](https://vercel.com/docs/ai-gateway/modalities/evaluation)

The AI SDK option is `experimental_evaluate` from `ai`. Vercel's launch note specifies **AI SDK 7.0.105 or later**, and places TypeSafe's additional Choice/Score confidence at `result.providerMetadata.typesafe.confidence`; generic answers primarily expose probabilities. [Vercel launch note](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)

At inspection, upstream `packages/ai/package.json` declared version `7.0.109`, Node `>=22`, and Zod `^3.25.76 || ^4.1.8`. This identifies the inspected source version, not an independently verified npm dist-tag. The official standalone quickstart uses Node 22.18+ to run `.mts` directly. An HTTP adapter avoids adding this SDK/runtime migration to the initial experiment. [AI package manifest](https://raw.githubusercontent.com/vercel/ai/main/packages/ai/package.json), [Gateway quickstart](https://vercel.com/docs/ai-gateway/getting-started/evaluation)

The inspected `evaluate()` implementation accepts `abortSignal` and `maxRetries`, defaulting to two retries, validates questions and answers, and exposes usage, warnings, and response metadata. For a live routing decision, retries must fit the whole turn deadline; a timeout should restore the existing route. [AI SDK implementation](https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/evaluate/evaluate.ts)

Alternative: TypeSafe's JavaScript SDK is `@typesafe-ai/sdk`, supports Node 20+, and exports `TypeSafeClient`. Its docs do not give a minimum package version for Gateway compatibility, so resolve and pin the installed version during implementation. [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)

Gateway can proxy that SDK via `baseURL: "https://ai-gateway.vercel.sh/typesafe"`; its compatibility endpoint is `/typesafe/v1/systemone` and preserves native Noul/snake_case fields. This is useful for existing TypeSafe clients, but Vercel recommends its generic evaluation API for new integrations. [Gateway TypeSafe compatibility](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)

**Deployment implication:** normal outbound HTTPS from the existing EC2 tutor server is sufficient; the HTTP interface and API-key authentication do not require moving the app to Vercel. Keep the credential on the server. This is an architectural inference from the documented HTTP interface, not a production deployment test.

## Pricing and fair cost comparisons

Direct TypeSafe list price is **$0.042 per million input tokens; output tokens are free**. The current Gateway listing says free, with promotional pricing ending **September 25, 2026**. Treat $0.042/M as a planning baseline and check the Gateway rate again after the promotion; do not assume permanent free inference. [Direct rate](https://docs.typesafe.ai/models), [Gateway promotion](https://vercel.com/ai-gateway/models/jev)

Illustrative arithmetic at that baseline, excluding retries, gateway extras, tax, and downstream models:

| Requests/month | Average billed input tokens | Jev model charge |
| ---: | ---: | ---: |
| 100,000 | 500 | $2.10 |
| 100,000 | 1,000 | $4.20 |
| 100,000 | 2,000 | $8.40 |
| 1,000,000 | 1,000 | $42.00 |

Use provider-reported input usage, including instructions and criteria; character counts or another provider's tokenizer are not a billing oracle. For independent decisions sharing state, one combined call avoids repeated context transmission. These are cost-planning recommendations, not measured Accelute savings.

Gateway says token pricing has no markup or platform fee. Free monthly credits cover only eligible models and cease after transition to purchased credits; model eligibility and effective rate limits are account-specific. Payment fees and optional add-ons can apply. BYOK still requires purchased Gateway credits and may fall back to system credentials. [Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)

A particularly relevant add-on: Gateway's **per-request ZDR has no surcharge**, while **team-wide ZDR costs $0.10/1,000 successful requests**. Both are documented for Pro/Enterprise. At 100,000 requests, the team-wide surcharge alone is $10, versus $4.20 of Jev inference in the 1,000-token scenario. Use the per-request control if it meets operational requirements; budget any needed plan cost. [Gateway ZDR pricing](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)

For a router, compute savings as avoided expensive work minus Jev calls, fallback calls, retry cost, and wrong-route cost. A classification call adds cost if it does not remove a downstream call or improve successful-turn yield. Jev does not directly replace the TTS bill or the tokens needed to narrate a lesson.

## Performance evidence, without extrapolating marketing

TypeSafe reports 70–500 ms response time and up to 193.6× faster / 444.6× cheaper workflows. The provider also discloses US West Coast measurement, a short favorable demonstration input, internally constructed workflows, reference probabilities from other models rather than human ground truth, and an LLM wrapper that requires distributions. These are vendor results, not Accelute latency or quality measurements. [TypeSafe launch methodology](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

A September 19 preprint evaluates bounded intent extraction in edge orchestration. Its abstract reports 15.9–26.5% lower median decision latency versus its DeepSeek setup, 69.0–70.6% lower API fees per correct completion, and that repeated-request caching largely removes the latency gap. This is primary external research on a different workload; it does not establish tutoring quality or expected savings here. [Li et al., arXiv:2609.22753](https://arxiv.org/abs/2609.22753)

Measure from the actual EC2 region: p50/p95 decision latency, timeout rate, first useful audio, complete successful turn, fallback frequency, and total billed cost. Compare against the current classifier, deterministic rules, and no-new-call baseline. Evaluate caching before attributing savings to a model substitution.

## Data handling relevant to student use

TypeSafe's privacy policy states no training/fine-tuning on input and US hosting. Its default retention language is purpose-based rather than a fixed deletion deadline. It also says the service does not knowingly collect personal data from under-18s. For an education product, clarify how the applicable commercial/gateway agreement covers student-linked content before sending it. This is an unresolved provider-contract applicability issue, **not** a conclusion that all educational API usage is prohibited. [TypeSafe privacy policy](https://typesafe.ai/legal/privacy-policy)

TypeSafe publishes a DPA covering processing on customer instructions and retention for as long as necessary; the commercial agreement permits application integration and separates service data, telemetry, and training rights. The website-only terms should not be treated as the complete commercial API contract. [DPA](https://typesafe.ai/legal/data-processing), [Master Customer Agreement](https://typesafe.ai/legal/mca)

Direct TypeSafe ZDR is offered to enterprise customers by arrangement. [TypeSafe legal documentation](https://docs.typesafe.ai/legal)

Gateway has its own TypeSafe ZDR agreement and explicitly lists TypeSafe as supporting ZDR and no training; that can differ from the provider's default direct contract. Enforce `providerOptions.gateway.zeroDataRetention: true`; unavailable compliant routes fail instead of silently dropping the requirement. BYOK uses the customer's provider agreement and is skipped for ZDR unless marked compliant. [Gateway ZDR policy and provider table](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)

`providerOptions.gateway.disallowPromptTraining: true` is available without surcharge on all plans. ZDR already implies no training; the separate control is useful when ZDR is unavailable, but does not create a retention guarantee. [Gateway no-training control](https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training)

Recommended initial payloads are public corpus questions and synthetic or properly de-identified cases, with no names, email addresses, student identifiers, photos, or raw conversation histories. Trace decision IDs, model/configuration versions, durations, distributions, token usage, and costs; keep actual student content out of this new telemetry path by default.

## What remains unverified

- Actual Accelute accuracy, calibration, language coverage, latency, and savings: no live benchmark has been run.
- Paid Gateway Jev pricing after September 25 and the project's actual free-tier/rate-limit eligibility.
- Gateway support for pinning an upstream Jev version and whether metadata exposes that exact upstream version reliably.
- Maximum Gateway aggregate multi-question token budget beyond the catalog's 32K value.
- Commercial coverage of student-linked data, applicable region requirements, and account entitlement to per-request ZDR.
- Exact published SDK versions to install if an SDK route is chosen; the report confirms the documented AI SDK minimum and inspected source manifest, not npm availability.

The implementation plan should use Jev as an optional, measurable decision service with a deterministic policy and a fallback. It must not become the authority for mathematical correctness, scene validity, or teaching generation.
