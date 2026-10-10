# Share previews

Both `accelute.co` and `app.accelute.co` use a 1200×630 PNG and a muted H.264
MP4 derived from the native tutor recording in
`apps/landing/public/hero/lesson-loop.mp4`. The entire interface stays visible;
no generated diagram or separate demo UI is added to the recording.

To refresh them after recording a new lesson:

1. Bump the asset filenames in `SITE` (`apps/landing/src/lib/seo.ts`) and
   `SITE_PREVIEW` (`apps/tutor/lib/site.ts`) so sharing services request fresh
   assets. Update the exact public video path in
   `apps/tutor/lib/auth/publicPaths.ts`.
2. Select the excerpt and still times in
   `apps/landing/scripts/generate-share-assets.mjs`. Run
   `pnpm --filter @heytutor/landing gen:share-assets` with ffmpeg and ffprobe
   installed. The script writes both apps' assets and refreshes the landing's
   old image/video URLs for cached metadata.
3. Run `pnpm --filter @heytutor/landing verify` and
   `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-safe-login-redirect.ts`,
   then build both apps. Verify the emitted HTML and anonymous image/video
   requests before deploying both sites through the normal deploy workflow.

Landing share tags are stamped into all seven public pages by the Vite SEO
plugin. The tutor declares its image explicitly in root metadata; a Next.js
`opengraph-image` file would take precedence over that declaration. Social
services may retain an existing page preview until they crawl its URL again.
