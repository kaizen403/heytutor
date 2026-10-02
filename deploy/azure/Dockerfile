FROM node:24-bookworm-slim

WORKDIR /app
ENV COREPACK_HOME=/usr/local/share/corepack

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ffmpeg \
  && ffmpeg -version >/dev/null \
  && ffprobe -version >/dev/null \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.32.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/landing/package.json apps/landing/
COPY apps/tutor/package.json apps/tutor/
COPY apps/tutor/prisma apps/tutor/prisma
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/drawing/package.json packages/drawing/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/scene-engine/package.json packages/scene-engine/
COPY packages/tutor-core/package.json packages/tutor-core/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/whiteboard/package.json packages/whiteboard/

RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild @prisma/client @prisma/engines esbuild prisma

COPY . .

RUN pnpm --filter @heytutor/tutor exec prisma generate \
  && pnpm turbo run build --filter=@heytutor/tutor... \
  && mkdir -p /app/apps/tutor/.next/cache \
  && chown -R node:node /app/apps/tutor/.next

WORKDIR /app/apps/tutor

ENV NODE_ENV=production
ENV HOSTNAME=app.accelute.co
# The container's published port requires this network namespace binding.
ENV LISTEN_HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

USER node

# Run prisma migrate deploy as a controlled deployment step before rollout.
CMD ["pnpm", "exec", "tsx", "server.ts"]
