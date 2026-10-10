# Storage accounting reconciliation

The account storage allowance remains **1 GiB (1,073,741,824 bytes)**. Storage
accounting includes saved lesson metadata, measured owned audio, notes, and
pending object/upload reservations. Historical audio references no longer mean
an automatic 8 MiB charge each. Existing content is retained; this tool never
deletes lesson content or objects.

## Report first

Run from the repository root with `DATABASE_URL` explicitly supplied in the
operator's environment. Use the application's object-store configuration and
read-only object permissions (`s3:GetObject` for HEAD and `s3:ListBucket` for
bounded prefix checks). Do not put credentials or account IDs in shared logs.

```bash
pnpm --filter @heytutor/tutor exec tsx scripts/live/reconcile-storage.ts
```

The default is a **dry run**. All database reads run inside repeatable-read
transactions with `SET TRANSACTION READ ONLY`. Object requests only measure
sizes or check whether an owned prefix is empty. No write method is called.
`readOnlyTransactionsVerified` records transactions whose PostgreSQL
`transaction_read_only` setting was checked to be `on` before reading data.
Output contains aggregate account counts and byte totals; account identities,
object keys, URLs, lesson content, provider errors, and credentials are omitted.

Optional `--user-id ID` restricts the scan to one account. The default limit is
1,000 accounts; `--limit N` accepts 1–10,000. `hasMoreAccounts: true` means the
scan is incomplete. Byte totals cover only `accountsMeasured`; unresolved
accounts are reported separately and are never treated as zero-byte accounts.

Exit status 0 means the selected scan completed, 2 means some accounts remained
unresolved/changed/failed or the scan was truncated, and 1 means the command
could not complete. A dry run may still report proposed corrections with exit
status 0; inspect the JSON before authorizing any write.

## What can be corrected

The tool uses the same snapshot, measurement, and apply helpers as storage
admission. It replaces known legacy estimates and excess turn metadata charges
with measured per-turn receipts. A bounded inventory of each owned turn prefix
counts every stored clip, including unreferenced clips. Retained canonical and
Continue-state references are deduplicated; a reference absent from the
inventory is checked with HEAD. Audio object keys must belong to the stored
account's board and turn. Objects covered by pending cleanup jobs retain the
job's charge and are not charged twice. `orphanObjects` and `orphanAudioBytes`
report stored clips without retained references; those clips are counted, not
deleted. Only a confirmed missing object can count as zero. Permission errors,
timeouts, unrecognized references, and other uncertain measurements leave the
account unchanged.

Legacy notes with zero-byte receipts are measured from UTF-8 content plus any
tag JSON; modern recorded note charges are preserved. `notesToUpdate` and
`legacyNoteBytesToCharge` report these corrections without exposing note text.

For S3, a missing object produces 404 only when the caller also has
`s3:ListBucket`; without that permission it can produce 403. A 403 therefore
cannot prove absence. See the [AWS HeadObject permissions documentation](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

Unrepresented image or other residual charges are preserved. Historical photo
uploads have no complete durable receipt, so an audio reconciliation cannot
prove that those bytes are stale. Active upload reservations and cleanup jobs
remain charged. A stale job is released only when its entire owned prefix is
confirmed empty and its receipt is unchanged; the job and its charge are then
removed together. No active upload or worker lease is bypassed.

Board deletion remains available when storage measurement fails. Recorded
charges and recognizable historical reservations transfer to a durable cleanup
job; no capacity is refunded until object deletion is confirmed. An absent
ledger receives a conservative migration baseline. A smaller inconsistent ledger
retains ambiguous residual charges and protects the recorded lower floor.
Existing upload jobs retain their separate charges. Historical estimates here
recover ownership of former reservations; new save admission uses stored bytes.

## Apply only after owner approval

The write mode has **not been run as part of this fix**. The owner reviews the
dry-run report and approves the selected scope before an operator adds the
explicit flag:

```bash
pnpm --filter @heytutor/tutor exec tsx scripts/live/reconcile-storage.ts --write
```

Apply takes the existing account lock, fences involved cleanup jobs, and
re-reads the source snapshot. If a concurrent save, deletion, or worker claim
changed it, the account is skipped instead of applying stale measurements.
Corrected turn/note receipts and the aggregate ledger update atomically.
Receipt-only corrections preserve the lesson's activity timestamp. Re-run the
same dry run afterward to confirm that no additional correction is proposed;
investigate unresolved accounts individually without publishing their data.

The allowance is unchanged by reconciliation. A genuinely full account must
receive a clear save error in the app; measuring storage is not an automatic
quota increase. Stored lesson status/idempotent updates that need no new bytes
must remain possible at capacity.
