FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.32.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/tutor/package.json apps/tutor/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/drawing/package.json packages/drawing/
COPY packages/tutor-core/package.json packages/tutor-core/
COPY packages/whiteboard/package.json packages/whiteboard/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm turbo run build --filter=@heytutor/tutor...

WORKDIR /app/apps/tutor

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec tsx server.ts"]
