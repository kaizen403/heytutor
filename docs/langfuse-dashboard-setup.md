# HeyTutor Pipeline Dashboard (Langfuse UI)

Langfuse does not expose a public API for creating dashboards. Build this once in the Langfuse UI after traces are flowing.

## Prerequisites

- Langfuse keys in `apps/tutor/.env.local`
- At least one real tutor question asked (so `tutor-turn` traces exist)

## Open Langfuse

1. Go to [cloud.langfuse.com](https://cloud.langfuse.com)
2. Open your project
3. Navigate to **Dashboards**

## Create dashboard

1. **Dashboards** → **New dashboard**
2. Name: `HeyTutor Pipeline`
3. Add the widgets below ( **Widgets** tab → **New widget**, then add each to the dashboard)

## Widget specs

### 1. Questions over time

| Setting | Value |
|---------|--------|
| Data source | Traces |
| Metric | Count |
| Dimension | Time (hour or day) |
| Filter | `name` = `tutor-turn` |

### 2. Average step latency

| Setting | Value |
|---------|--------|
| Data source | Observations |
| Metric | Avg latency (or p95) |
| Dimension | Observation name |
| Filter | name in `thinking`, `websocket-connect`, `fireworks-llm`, `segment-0`, `draw-0`, `tts-segment` |

Compares time spent in each pipeline step.

### 3. Fireworks tokens over time

| Setting | Value |
|---------|--------|
| Data source | Observations |
| Metric | Sum input + output usage |
| Dimension | Time |
| Filter | name = `fireworks-llm` |

### 4. TTS characters

| Setting | Value |
|---------|--------|
| Data source | Observations |
| Metric | Sum usage (characters) |
| Filter | name = `tts-segment` |

### 5. TTS transport mix

| Setting | Value |
|---------|--------|
| Data source | Observations |
| Metric | Count |
| Dimension | metadata.transport |
| Filter | name = `tts-segment` |

Shows ws vs http vs browser-fallback.

## Per-question timeline (main debug view)

This is not a dashboard widget — use **Tracing → Traces**:

1. Filter by name `tutor-turn`
2. Open any trace
3. Timeline shows (in order):
   - `thinking` — submit → first LLM token
   - `websocket-connect` — TTS prewarm
   - `fireworks-llm` — tokens + TTFT
   - `segment-N` — each teaching segment
   - `draw-N` — nested under segment when drawing runs
   - `tts-segment` — ElevenLabs character usage (server-side)

Trace metadata includes `total_duration_ms`, `segment_count`, `total_draw_ms`, `total_tts_chars`.

## Curated dashboards

Also enable Langfuse built-in dashboards:

- **Latency** — end-to-end and observation latency
- **Cost** — after configuring model prices in **Settings → Models**

### Model pricing (recommended)

| Model | Unit |
|-------|------|
| `accounts/fireworks/models/kimi-k2p6` | per input/output token |
| `eleven_flash_v2_5` | per character |

## Sessions view

Filter by **Sessions** using `session_id` = whiteboard board ID to see all questions on one board grouped together.
