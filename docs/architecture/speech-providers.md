# Speech providers

Cartesia is the default for narration and microphone transcription. ElevenLabs remains available independently for each capability. All credentials and provider selection stay on the server.

## Configuration

In `apps/tutor/.env.local` (or the EC2 process's `.env.production`):

```dotenv
TTS_PROVIDER=cartesia
STT_PROVIDER=cartesia
CARTESIA_API_KEY=<set privately>
# Optional: choose a teaching voice after auditioning it.
# CARTESIA_VOICE_ID=<voice UUID>
```

The default model is `sonic-3.6`, using **Simi** (formerly Indian Lady) (`3b554273-4299-48b9-9aaf-eefd438e3941`) as the Indian English starting voice. The live voice API confirms native `indian-english` / `en-IN`. Short incline-lesson samples passed HTTP and WebSocket generation and transcription; perceived naturalness still needs a listening pass. The API version is pinned to `2026-08-14`. `CARTESIA_MODEL` overrides the model; `CARTESIA_LOW_LATENCY_MODEL` optionally selects an alternative when Settings requests faster responses. The default uses the same model for both settings. Sonic 3.6 receives the selected locale; older model overrides receive a base language instead. Accent quality depends on the voice's supported accents.

Optional `CARTESIA_VOICE_ID_EN_GB`, `CARTESIA_VOICE_ID_EN_US`, and `CARTESIA_VOICE_ID_HI` override the default voice. Dictation uses `ink-whisper` and the same key unless `CARTESIA_STT_API_KEY` is set. Its model can be overridden with `CARTESIA_STT_MODEL`.

To use ElevenLabs again, set `TTS_PROVIDER=elevenlabs` with the existing `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Set `STT_PROVIDER=elevenlabs` with `ELEVENLABS_STT_API_KEY` for dictation. Its model, accent voices, and expressive voice settings are retained. Providers are never selected based on which key happens to be present; missing Cartesia configuration does not spend against ElevenLabs.

Restart the server after changing configuration. No database migration is required. A deployment without a usable selected provider can use the existing browser speech fallback; the speech-start guard surfaces failures when that fallback cannot start either.

## Boundaries

- `lib/tts/providerConfig.ts` owns provider, credentials, voices, and model selection.
- `ttsProvider.ts` adapts HTTP and WebSocket generation to the app's sentence protocol. `transcriptionProvider.ts` adapts microphone requests.
- `server.ts` and `handleTtsRequest.ts` enforce the same authentication, grant budgets, cancellation, and usage recording around either provider. Successful generation records the actual provider and model. Failed generation does not record a completed TTS spend; the attempt still consumes the grant's character fuse.
- `StreamingSpeechClient` and `HttpSpeechClient` share playback, lookahead, pause/stop, capture, and timing. Old ElevenLabs class imports are compatibility aliases. The browser requests language and latency preferences; it does not select credentials or a provider.
- `CartesiaContexts` keeps each concurrently generated sentence separate. It assembles 24 kHz signed 16-bit PCM into one WAV at completion. The browser already plays complete sentences, so this retains the existing lookahead policy. ElevenLabs continues to provide MP3.
- Word timestamps map onto the submitted text's character offsets. Character positions inside a word are interpolated. If provider normalization prevents a reliable match, exact timings are omitted and the existing estimated handwriting schedule applies.
- Live capture, uploads, private object keys, replay, and MP4 export accept both WAV and MP3. Existing MP3 objects remain readable. WAV needs more space: uploads allow 8 MiB per sentence, 96 MiB total audio and 128 MiB per request (about 35 minutes at 24 kHz mono). No concatenation of independent WAV headers is used.

`CARTESIA_USD_PER_1K_CHARS` controls the internal cost estimate (default $0.05). This is a configurable estimate, not an invoice: Cartesia charges credits and effective USD varies with the subscription. ElevenLabs retains its existing rate overrides. Both rates are visible in admin cost reporting.

## Verification

`pnpm --filter @heytutor/tutor verify:speech` exercises both provider contracts, default selection, concurrent contexts, cancellation, malformed/truncated streams, Unicode timestamp alignment, microphone requests, and audio storage. The browser integration test takes Cartesia relay output through lookahead, WAV decoding, timing callbacks, capture, and HTTP fallback while retaining language/latency preferences.

These are deterministic mocked-provider checks. `scripts/live/probe-speech-providers.ts` adds a billable live check for the selected provider: HTTP and WebSocket generation plus transcription. Run with `pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/probe-speech-providers.ts`. Before deployment, audition the rough-incline incident question with the chosen voice, verify microphone dictation, pause/resume, and replay a saved lecture.

## Provider references

Verified against the official documentation on 2026-09-23:

- [Cartesia WebSocket generation](https://docs.cartesia.ai/api-reference/tts/websocket)
- [Cartesia HTTP SSE generation](https://docs.cartesia.ai/api-reference/tts/sse)
- [Audio formats](https://docs.cartesia.ai/build-with-cartesia/capability-guides/tts-output-audio-format)
- [Multilingual voices and locales](https://docs.cartesia.ai/build-with-cartesia/capability-guides/multilingual-voices)
- [Batch transcription](https://docs.cartesia.ai/api-reference/stt/transcribe)
- [Credit pricing](https://docs.cartesia.ai/pricing)

Indian English default voice ID checked against the [SignalWire Cartesia voice catalog](https://signalwire.com/docs/platform/voice/tts/cartesia). Live account access and synthesis were verified on 2026-09-23. The voice API returns the current name Simi for this same ID. Perceived naturalness and production playback still need a listening pass.
