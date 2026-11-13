# Indian language narration

Approved scope: add Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia,
Punjabi, Tamil and Telugu to the existing English and Hinglish voices.

Students select a voice in either settings surface. Narration and subtitles use
the selected language's native script with English subject terms and maths.
Board text, protocol tags and verified diagram geometry keep their existing
English authority and synchronization contracts. Existing English accents and
Hinglish remain available.

The shared language catalog in `packages/tutor-core/src/tts/voiceLanguage.ts`
owns language/locale mapping. Shared narration prompts and runtime phrases live
in `packages/tutor-core/src/llm/`. Server configuration and both Sarvam transports
use the requested locale; credentials remain server-only. Regional choices are
offered only with `SARVAM_API_KEY`, and unavailable saved choices are masked
without overwriting storage. Switching narration languages during a turn waits
for the next question. No schema change or dependency is needed.

Implementation uses existing TypeScript functions, typed catalogs and settings
pills, for example `toVoiceKey("tamil", "india")` returns `ta-IN`. No additional
geometry, provider selection or translated board commands come from the model.

Validation:

```sh
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-indian-languages.ts
pnpm --filter @heytutor/tutor verify:speech
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-settings-persist.ts
pnpm typecheck
pnpm lint
pnpm build
```

The regression gate covers all nine mappings, settings persistence and masking,
native-script openings and lesson prompts, unchanged English board rows, and
locale propagation through HTTP and WebSocket speech. Live provider probes
check short synthetic teaching lines when credentials are available. Browser
verification uses Pomerado when an authenticated connection is available.

## Validation record — 13 November 2026

- All nine regional locales generated WAV audio successfully over both HTTP
  and WebSocket with the configured Sarvam account: 18 of 18 probes.
- `verify-indian-languages`, settings persistence, voice wiring, the primitive
  figure tour and 25 focused tutor-core speech/sync/opening checks passed.
- Monorepo typecheck and lint passed. The production build passed.
- The full speech suite encounters two existing figure assertions:
  `verify-diagram-audio-resume` expects `[14, 7, 9]` commands while the baseline
  produces `[15, 7, 6]`; `verify-spoken-units-roundtrip` expects a planner role
  containing `reaches 20 m/s` in a figure introduction. Both were reproduced
  with the unchanged baseline presentation module. Their assertions are intact.
- The wider tutor-core suite stops at five missing mechanics probe figures;
  scene-engine behavior is outside this change.
- Browser verification could not run because the hosted Pomerado endpoint
  rejected the unauthenticated connection. Native-speaker listening and full
  lesson quality review remain outstanding. No deployment was performed.
