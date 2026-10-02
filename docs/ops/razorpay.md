# Razorpay payments

Plus is the only paid plan: **US$29 per month**, with a **US$10 Add credits**
pack. India sees and pays a recent INR equivalent; other countries see USD.
Razorpay Standard Checkout provides one-month purchases, with no recurring
mandate or automatic renewal. Historical Pro access remains readable, but no
new Pro orders can be created. New purchases cannot use the old Autumn catalog.

## What the account owner supplies

- Confirm the account is a **Payment Gateway merchant account**, and tell us
  whether KYC/account activation is complete and Live API keys are available.
  An account being called “individual” does not establish which payment
  methods/currencies Razorpay has approved. Complete required KYC inside
  Razorpay; do not send passwords, OTPs, bank documents, or PAN to a developer.
- Generate a **Test Key ID and Test Key Secret** in Dashboard → Account &
  Settings → API Keys. Put them in the private tutor environment.
- Add a webhook with a separate random secret (e.g. `openssl rand -hex 32`).
  Put the same value in Razorpay and `RAZORPAY_WEBHOOK_SECRET` on the server.
- Confirm Live INR and international payment-method approval. Razorpay's
  [international payments documentation](https://razorpay.com/docs/payments/international-payments/)
  says individuals must integrate PayPal for international payments. Enable
  that approved method in the account and verify a real USD sandbox/Live flow
  before setting `RAZORPAY_USD_ENABLED=1`. A flag cannot grant account approval.
- Supply Live keys privately after activation and sandbox acceptance. Test
  and live mode require separate keys and webhook configuration.

Nothing secret belongs in chat, Git, the landing deployment, or a
`NEXT_PUBLIC_*` variable. KYC/bank details are managed by Razorpay.

## Private tutor configuration

```dotenv
BILLING_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_REPLACE
RAZORPAY_KEY_SECRET=REPLACE
RAZORPAY_WEBHOOK_SECRET=REPLACE
RAZORPAY_USD_ENABLED=0
```

The server fetches the [ECB daily reference rates](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)
and computes INR per USD from the EUR cross-rates. Rates are cached for six
hours, with a five-minute retry after failures; a reference older than seven
days disables INR purchases. INR charges are rounded to paise. There is no
fixed INR price to keep in sync or guessed USD fallback for an Indian purchase.
A server-signed price quote lasts 30 minutes and binds the displayed amount,
currency, plan, and allowance. Order creation validates the quote and stores
that immutable amount. An expired quote refreshes the options and asks the
buyer to review before trying again; it never silently charges a new price.

The landing's first-party `/api/region` reads the hosting country signal on
Vercel or Cloudflare Pages and returns only a country code, without IP storage
or a third-party geolocation service. The tutor uses the same endpoint with
restricted CORS. Country IN selects INR; others select USD. If the country
signal is unavailable, browser timezone/language supplies a best-effort fallback.
An accessible currency selector lets buyers correct the detection, including
VPN/location mismatches, and preserves their choice across the login link.
`NEXT_PUBLIC_LANDING_URL` must identify the deployed landing origin.

Cloudflare Pages receives `public/_worker.js` and `_routes.json` through Vite's
public copy. Only `/api/region` runs the Worker; all other paths remain static.
Vercel uses `api/region.ts`. Both endpoints return private, uncached responses.

The public billing catalog supplies tutor and landing displays. Upgrade links
preserve the currency through login and open `/usage`; Add credits links open
`/settings/usage`. The buyer reviews the live amount and presses the purchase
button to open checkout. Account test mode is clearly labelled in the tutor.

Checkout requires all three credentials, including the webhook secret. With
`BILLING_PROVIDER=razorpay`, missing credentials disable new checkout while
existing persisted entitlements remain readable. Autumn is bypassed. Do not
switch an existing Autumn subscriber base without an explicit migration plan;
Razorpay mode only recognizes Razorpay purchases.

Production rejects `rzp_test_*` keys unless `RAZORPAY_ALLOW_TEST_MODE=1` is
explicitly set for staging. Remove that override before opening real checkout.
Test purchases and Free usage periods are separated from live purchases/usage.
Verified-email allowance floors retained after account deletion are also scoped
to Autumn, Razorpay live, or Razorpay test. Historical unscoped identity records
retain a conservative production floor until expiry, since their original mode
was not stored; they never debit sandbox usage.

## Razorpay dashboard

Set payments to **automatic capture**. Authorized payments alone never grant
access. Add the application URL and required policy/contact information in
Razorpay's account onboarding. Check the actual approved payment methods;
this integration does not force UPI, cards, or methods the account lacks.

Set the webhook URL to:

```text
https://app.accelute.co/api/billing/razorpay/webhook
```

Subscribe to `payment.captured`, `order.paid`, and `refund.processed`. Use
the deployment's own URL for staging. Localhost needs a public HTTPS tunnel.
Check deliveries in Razorpay; a provider/database failure returns 503 so
Razorpay can retry. Invalid signatures return 400. The route is session-free
and signature-authenticated. It verifies the exact raw request body.

## Access and accounting

- The server creates a price-snapshotted purchase and then an order. The client
  supplies a plan, never an authoritative price, user ID, or balance.
- A checkout signature is checked against the **stored order** and ownership.
  The payment is then fetched from Razorpay and must be captured, match the
  stored amount/currency, and belong to the order. Webhooks also fetch current
  provider state so stale events cannot undo refunds.
- Callback, recovery, and webhook delivery share a PostgreSQL transaction and
  per-user advisory lock. An order is credited once, including concurrent
  callback/webhook delivery. Replayed checkout idempotency keys reuse orders.
- A paid month starts when confirmed. Renewals queue another full month.
  Plus bought during historical Pro coverage starts after existing paid coverage. UTC month ends are
  clamped for dates such as January 31.
- Included paid usage follows that purchase's period. Free usage follows the
  UTC calendar month. Extra usage has its original expiry, remains available
  through upgrades, and is spent after included usage in expiry order.
- Full refunds revoke the affected purchase. Partial top-up refunds remove
  proportional allowance; partial plan refunds keep the month active. Refunds
  revoke cached grants and retained WebSocket allowance. Future unused queued
  months are compacted; historical consumed months are never regranted.
- New purchases refresh an exhausted existing grant without resetting its
  trace ownership or per-lesson speech ceiling. Paid-call admission rechecks
  current access. Expiry does not authorize more paid provider calls; narration
  already generated can finish playing.
- Notes-message quotas reserve a slot atomically. Invalid/failed requests,
  empty responses, and streams that fail before delivering text release it.
- Purchase history is authenticated, mode-separated, and bounded. Buyers can
  check pending payments after closing checkout or losing a callback. Refunds
  are initiated in the Razorpay dashboard; the app never initiates money moves.

## Validation and rollout

1. Generate Prisma and apply the additive migration before selecting Razorpay:
   `pnpm --filter @heytutor/tutor db:generate` and
   `pnpm --filter @heytutor/tutor db:migrate`. Production uses the EC2 runbook's
   environment and migration step, not a local production database command.
2. Run `pnpm --filter @heytutor/tutor verify:billing`, typecheck, lint, and build.
3. DB/HTTP payment tests run with `pnpm --filter @heytutor/tutor
   verify:razorpay-db` and a `DATABASE_URL` pointing to a dedicated **local**
   database named `heytutor_razorpay_verify_*`. They refuse production/shared
   application DBs. Provider HTTP responses are controlled test data; signatures,
   route handlers, transactions, and database grants execute real application code.
4. With genuine Razorpay Test keys, test Plus in INR and USD, Add credits, cancel, payment
   failure/retry, closed tab, pending capture, duplicate webhook, early renewal,
   currency detection/override, expired quotes, partial/full refunds, and wrong-account recovery. Verify Razorpay's
   own test payment record, delivery log, purchase row, and usage screen agree.
5. Configure approved Live keys/webhook and perform the owner's agreed live
   smoke purchase. Verify capture, activation, refund, and settlement in the
   dashboard. No real payment is attempted by offline tests.

Fresh-database migration caveat: existing migration directory names are sorted
lexically by Prisma (`13_*` precedes `8_*`), so the pre-existing full migration
chain cannot currently bootstrap an empty DB with `migrate deploy`. Payment
verification applied those SQL files in numeric order in an isolated DB. The
new migration is additive to an already-migrated application DB. Do not rename
applied migrations or mark failed migrations resolved on a production DB blindly.

## Verification recorded on 2026-10-02

- The isolated release was reconciled with the current production branch. Full
  workspace typecheck, lint, and production build pass. Lint reports nine
  existing warnings and no errors. The dependency audit reports no advisories.
- Billing checks, signed currency/FX quotes, controlled-provider HTTP tests,
  real PostgreSQL payment transactions, capture/refund races, renewals, expiry,
  and mode isolation pass. A deterministic checkout-versus-usage regression
  reproduced a PostgreSQL deadlock before advisory locks were moved ahead of
  user row locks in admission and settlement; both overlaps now pass.
- The security suite passes, including account deletion, durable usage caps,
  trace ownership, WebSocket lifecycle, and independent retained identity floors
  for sandbox and live billing. Navigation, lecture audio/player, queue races,
  landing demonstrations, and country handlers pass after dependency updates.
- Chromium checks cover automatic country selection, currency correction and
  persistence, the sole paid plan, Add credits, mobile layout, signed quote
  submission, cancellation/recovery, double clicks, expired quotes, SDK retry,
  and confirmed-payment refresh failure. Provider responses in those checks are
  fixtures; they do not create real payments.
- The owner's existing Live keys were verified with an authenticated read-only
  Razorpay API request. Production private credentials are configured, with
  international checkout disabled pending merchant approval. The existing paid
  production account is staff; no ordinary Autumn subscribers require migration.
- The owner declined Test keys and authorized the existing Live credentials.
  No genuine sandbox or real-money capture, refund, or settlement was performed.
  The disabled dashboard webhook must be enabled after deployment health checks,
  and the owner's first agreed payment must confirm capture and activation.

## Primary references

- [Razorpay Standard Checkout integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [API keys and test/live environments](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/)
- [Webhook signatures and duplicate delivery](https://razorpay.com/docs/webhooks/validate-test/)
- [Account creation and activation](https://razorpay.com/docs/payments/create-account/)
- [Sharp security patch](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
- [pnpm workspace configuration](https://pnpm.io/settings)
