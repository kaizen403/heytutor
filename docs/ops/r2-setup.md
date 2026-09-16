# Cloudflare R2 setup (retired)

Lecture audio and question photos now live on private S3. See [s3-setup.md](s3-setup.md).

The Wrangler CLI upload path (`wrangler login` + `wrangler r2 object put`) is
gone. Do not restore it for production: the OAuth session expires and replay
loses its MP3s.
