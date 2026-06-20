# heytutor monorepo

pnpm + Turborepo workspace for the heytutor SaaS product.

## Structure

```
apps/
  tutor/      Next.js whiteboard tutor (product)
  landing/    Vite marketing site
packages/
  design-tokens/
  drawing/
  tutor-core/
  whiteboard/
  typescript-config/
  eslint-config/
```

## Setup

```bash
pnpm install
```

Copy env for the tutor app:

```bash
cp apps/tutor/.env.example apps/tutor/.env.local
```

Provision Cloudflare R2 for lecture audio (Wrangler CLI — see [docs/r2-setup.md](docs/r2-setup.md)):

```bash
wrangler login
pnpm --filter @heytutor/tutor r2:setup
```

## Development

```bash
pnpm dev              # both apps via turbo
pnpm dev:tutor        # tutor only → http://localhost:3000
pnpm dev:landing      # landing only → http://localhost:5173
```

## Build

```bash
pnpm build
pnpm typecheck
pnpm lint
```

## Deploy

| App | Path | Suggested domain |
|-----|------|------------------|
| `@heytutor/landing` | `apps/landing` | marketing root |
| `@heytutor/tutor` | `apps/tutor` | app subdomain |

Set Vercel **Root Directory** to the app folder for each project.
