#!/usr/bin/env bash
set -euo pipefail
pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild @prisma/client @prisma/engines esbuild prisma
pnpm --filter @heytutor/tutor exec prisma generate
# Sequential package builds reduce peak memory; the cgroup is the hard ceiling.
pnpm turbo run build --filter=@heytutor/tutor... --concurrency=1
