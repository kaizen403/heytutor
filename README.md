# heytutor

an ai tutor that explains things by drawing on a whiteboard while talking. you ask a question, it narrates and draws the answer at the same time — shapes, labels, handwritten text, all in sync with the voice.

built with Next.js, Konva, ElevenLabs, and a custom drawing protocol that lets the llm emit whiteboard commands inline with its response.

---

## how it works

1. you type a question
2. the llm streams a response with drawing commands embedded in it
3. as the response streams in, tts narration and whiteboard drawing run in parallel
4. everything stays in sync — the voice and the pen move together

sessions are saved. you can replay any board from the beginning with audio and drawing in sync.

---

## stack

| | |
|---|---|
| frontend | Next.js 15, React 19, Tailwind v4 |
| canvas | Konva + react-konva |
| handwriting | roughjs, tegaki (stroke-based glyphs) |
| llm | Fireworks AI (kimi-k2p6) |
| tts | ElevenLabs flash v2.5, websocket streaming |
| database | Prisma + Neon Postgres |
| audio storage | Cloudflare R2 |
| monorepo | pnpm + Turborepo |

---

## structure

```
apps/
  tutor/      main product — Next.js whiteboard tutor
  landing/    marketing site — Vite + React

packages/
  drawing/        drawing protocol, parser, shapes, handwriting, animation
  tutor-core/     llm client, tts clients, audio sync, mock responses
  whiteboard/     Konva canvas component with imperative handle
  design-tokens/  shared colors, spacing, canvas size
```

---

## getting started

```bash
pnpm install
cp apps/tutor/.env.example apps/tutor/.env.local
```

fill in `.env.local` — the app runs in mock mode without api keys (no llm or tts needed to try it out).

```bash
pnpm dev:tutor
```

this starts postgres via docker automatically if `DATABASE_URL` points at localhost, runs migrations, then starts the server at `http://localhost:3000`.

for audio storage (optional):

```bash
wrangler login
pnpm r2:setup
```

---

## environment variables

| variable | what it's for | required |
|---|---|---|
| `DATABASE_URL` | postgres connection string | yes |
| `FIREWORKS_API_KEY` | llm | no — mock mode if missing |
| `ELEVENLABS_API_KEY` | tts | no — browser voice fallback |
| `ELEVENLABS_VOICE_ID` | tts voice | no |
| `R2_ACCOUNT_ID` | cloudflare r2 | no — audio won't persist |
| `R2_BUCKET` | r2 bucket name | no |
| `R2_PUBLIC_BASE_URL` | public r2 url | no |
| `LANGFUSE_PUBLIC_KEY` | observability | no |
| `LANGFUSE_SECRET_KEY` | observability | no |

---

## drawing protocol

the llm emits drawing commands inline with its response text. the incremental parser picks them up character by character as the stream arrives:

```
[DRAW_RECT:x,y,width,height]
[DRAW_CIRCLE:cx,cy,radius]
[DRAW_LINE:x1,y1,x2,y2]
[DRAW_CUBOID:x,y,width,height,depth]
[WRITE:text,x,y]
[LABEL:text,x,y]
[PAUSE:ms]
[CLEAR]
[ERASE:x,y,width,height]
```

canvas is 1200×700, origin top-left.

---

## commands

```bash
pnpm dev              # both apps
pnpm dev:tutor        # tutor → :3000
pnpm dev:landing      # landing → :5173
pnpm build
pnpm typecheck
pnpm lint

# database
pnpm db:up            # start local postgres container
pnpm db:down          # stop it
pnpm --filter @heytutor/tutor db:migrate
```

---

## deploy

Vercel. set **Root Directory** per app:

| app | root directory |
|---|---|
| tutor | `apps/tutor` |
| landing | `apps/landing` |
