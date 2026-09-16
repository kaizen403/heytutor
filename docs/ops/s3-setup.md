# S3 setup (lecture audio and question photos)

Lecture replay stores per-segment MP3s in a private S3 bucket. Question photos
from the ask-bar camera are stored under the same bucket after OCR succeeds.
The tutor serves both through `/api/media?key=…` so the bucket stays closed.

## Bucket

Create a private bucket in `ap-south-2` (Hyderabad), for example `heytutor-lectures`.
Block all public access. No CORS is required: the browser never talks to S3.

Object keys:

| Prefix | Contents |
|--------|----------|
| `lectures/{boardId}/{turnId}/{segmentIndex}.mp3` | Replay audio |
| `images/{userId}/{imageId}.{ext}` | Question photos |
| `backups/postgres-*.sql.gz` | Nightly `pg_dump` from the EC2 box |

## IAM

Attach an instance role to the EC2 box. Do not put access keys on disk unless
you are debugging locally.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::heytutor-lectures/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::heytutor-lectures"
    }
  ]
}
```

Local uploads without a role: set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
in `apps/tutor/.env.local`. Production prefers the instance role.

## Env

```bash
AWS_REGION=ap-south-2
S3_BUCKET=heytutor-lectures
```

Leave `S3_PUBLIC_BASE_URL` unset. Persist writes `/api/media?key=…` URLs into
Postgres; `/api/media` and `/api/lecture-audio` stream the object after checking
that the signed-in user owns the board or photo.

## Runtime

- `apps/tutor/lib/object-store/s3.ts` — put / get / delete via `@aws-sdk/client-s3`
- Board delete removes `lectures/{boardId}/`
- Account delete removes that user’s `images/` prefix and every board’s lecture prefix
