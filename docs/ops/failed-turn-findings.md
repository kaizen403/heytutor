# Failed-turn findings and regressions

The original read-only audit acquired all 28 rows behind `/admin/fails`.
Positive failure evidence separates **8 confirmed failures, 17 expected text or
continuation turns, and 3 unverified historical records**. The five confirmed
staff turns are all expected outcomes; the remaining cohort is probable learners,
not a verified student identity classification. No retained question, identity or
trace identifier belongs in this report or the public fixtures.

| Finding | Resulting behavior | Main regression |
| --- | --- | --- |
| Healthy continuations and explicit no-figure turns counted as fails | Fails, KPI and Sentry share positive evidence. Unknown outcomes stay visible in All logs. | `verify-turn-failure-classification.ts` |
| Completed continuation without recorded teaching | Empty, opening-only and partial-only lessons cannot complete; stopped work remains resumable. | `verify-live-turn-save.ts`, `verify-turn-checkpoint-route.ts` |
| Missing/declined conceptual figures | A generic directed-relation compiler draws reference-bound Born, Faraday, constructor, circulation and neuronal phase components. Contradictory bindings reject. | `verify-source-concept-representation.ts` |
| Resistor-chain diagrams supplied for a magnetic setup | Relevance rejection reaches candidate repair before a wrong scene can win. Independently computed two-coil apparatus is available without guessed values. | `verify-coaxial-coils-representation.ts` |
| Neuronal ion/“complex” vocabulary selected chemistry | Monatomic ions and an adjective alone cannot choose chemistry; genuine chemical structures remain supported. | `verify-chemistry-subject-context.ts` |
| A skipped teaching beat followed by successful beats hid failure | An owned terminal-beat latch prevents completion and emits one teaching failure with partial work retained. | `verify-started-speech-failure.ts`, `verify-sentry.ts` |
| Late canceled speech/drawing callbacks could disturb a successor | Canceled callbacks have cancellation diagnostics and do not abandon successor speech. | `verify-started-speech-failure.ts` |
| Browser voices became ready after the initial retry | One `voiceschanged` retry runs within the existing 2.5-second startup deadline, without a paid provider retry. | `verify-browser-speech-retry.ts` |
| Missing release configuration could remain stale across deployments | The deploy stamps the build and service environment with the same full Git SHA, preserving other settings and permissions. | `deploy/aws/verify-sentry-release.mjs` |
| Sentry lease updates could invalidate storage measurements | Infrastructure receipts do not alter retained lesson fingerprints; real lesson changes still invalidate them. | `verify-storage-sentry-receipts.ts` |

All seven retained diagram failures now produce independently admitted drawable
components in offline replay. They remain `question_representation`, explicitly
nonmetric and limited in narration. They certify the pictured component, not
every requested fact or whole-topic coverage. An accepted exact diagram keeps
priority. Symbolic components can avoid unnecessary scene-model requests in the
current strategy; strict planner-only experiments retain their existing policy.

Of eleven traces with secondary speech/drawing error names, five timeouts were
after cancellation. Six had failures before cancellation: four browser startup
deadlines, one playback stall and one drawing rejection. Historical voice-list
state and the last two underlying causes were not retained. The voice-readiness
mechanism is reproduced and fixed; arbitrary browser/provider/drawing errors
remain visible, bounded and resumable rather than being promised impossible.

The integrated command is `pnpm --filter @heytutor/tutor verify:failure-findings`.
The engine's default verify includes the source and chemistry regressions.
Fault injection removes queueing, completion protection, source relations or
classification rules and must fail the corresponding gate. Tests use synthetic
sources and mock transports; reproductions incurred no model or TTS spend.

Production application changes, migration and historical backfill remain a
reviewed deployment step. The separately owner-authorized configuration action
confirmed existing nonempty DSN settings, set `SENTRY_RELEASE`, and restarted an
idle healthy service. No DSN value was printed and no production database write
was performed. See [Sentry setup and alerts](failed-turn-sentry.md).
