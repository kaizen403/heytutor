# Cloudflare R2 setup (lecture audio)

Lecture replay stores per-segment MP3 audio in Cloudflare R2. **Wrangler CLI** handles provisioning and runtime uploads — no S3 API keys.

## Prerequisites

- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed and logged in:

```bash
wrangler login
wrangler whoami          # confirms OAuth + account id
wrangler r2 bucket list  # confirms R2 access
```

## Automated setup (recommended)

From the repo root:

```bash
pnpm r2:setup
```

This runs (via `apps/tutor/scripts/r2-setup.ts`):

| Step | Wrangler command |
|------|------------------|
| Auth check | `wrangler whoami` |
| List buckets | `wrangler r2 bucket list` |
| Create bucket (if missing) | `wrangler r2 bucket create heytutor-lectures` |
| Enable public r2.dev URL | `wrangler r2 bucket dev-url enable heytutor-lectures` |
| Read public URL | `wrangler r2 bucket dev-url get heytutor-lectures` |
| Upload smoke test | `wrangler r2 object put … --remote` |

It writes `R2_ACCOUNT_ID`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL` into `apps/tutor/.env.local` and `.env.example`.

### Options

```bash
pnpm r2:setup -- --bucket my-custom-bucket
pnpm r2:setup -- --env apps/tutor/.env.local
pnpm r2:setup -- --dry-run
```

## Runtime uploads

The tutor server uploads audio via **`wrangler r2 object put --pipe --remote`** using your Wrangler OAuth session. No `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` needed.

Required env (from `pnpm r2:setup`):

```bash
R2_ACCOUNT_ID=...
R2_BUCKET=heytutor-lectures
R2_PUBLIC_BASE_URL=https://pub-....r2.dev
```

If `wrangler login` expires, audio upload is skipped until you re-authenticate — turns still save script + drawings to Postgres.

## Manual Wrangler reference

```bash
# Bucket info
wrangler r2 bucket info heytutor-lectures

# Upload / delete objects (debugging)
wrangler r2 object put heytutor-lectures/lectures/test.mp3 --file=./sample.mp3 --remote
wrangler r2 object delete heytutor-lectures/lectures/test.mp3 --remote

# Custom domain (production alternative to r2.dev)
wrangler r2 bucket domain --help
```

## Runtime code

- `apps/tutor/lib/r2.ts` — `uploadAudio()`, `deleteAudio()`, `lectureAudioKey()`
- Object key pattern: `lectures/{boardId}/{turnId}/{segmentIndex}.mp3`
- Public URL: `{R2_PUBLIC_BASE_URL}/{key}`

## Current provisioned resources (this workspace)

| Resource | Value |
|----------|-------|
| Account ID | `37fe66534312238914af0ff34d128ac3` |
| Bucket | `heytutor-lectures` |
| Public base URL | `https://pub-f2027524da874779ae9726cb99d4205d.r2.dev` |

Re-run `pnpm r2:setup` after switching Cloudflare accounts or buckets.
