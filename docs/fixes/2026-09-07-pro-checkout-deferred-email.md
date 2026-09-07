# Pro: payment before email confirmation

The public Auth signup endpoint sends email before returning. Its email cooldown therefore prevented the Pro flow from ever reaching Asaas, despite the UI promising payment first.

Pro now uses server-side admin creation with `email_confirm: false` (no email). Existing pending commercial accounts are recovered only after Supabase Auth verifies the password (`email_not_confirmed`, emitted after password verification in upstream Auth). Passwords are never persisted by the commercial UI, logged, or changed on existing accounts. Confirmed accounts retain the existing authenticated flow; accounts from the new flow reuse their pending purchase even after email confirmation.

The browser receives a restricted purchase proof stored in sessionStorage, not a clinical session. This proof is checked against server-owned app metadata. The server reuses an active checkout and a partial unique index prevents concurrent creation for the new flow. Unknown provider outcomes stay pending instead of silently creating another purchase. Legacy pending records are consulted and preserved.

Email is requested only after the verified webhook stores `paid` for a production checkout. A failed email delivery can be retried without reapplying billing. The return page checks server state; URL parameters never confirm a payment. Freemium, the isolated Débora page and sandbox do not use this email flow.

## Release order (not yet applied)

1. Apply `supabase/phase-pro-checkout-deferred-email.sql`. It adds a service-role-only lookup and a partial unique index, without changing existing records.
2. Deploy `saas-checkout` and `saas-billing-webhook`, including `../_shared/post-payment-email.ts`; preserve their current `verify_jwt: false` setting and existing secrets. The functions perform their own authentication/proof verification.
3. Publish the Worker and commercial assets together through the repository's existing Cloudflare deployment.
4. Validate one authorized purchase in the production environment: no email before approval; one checkout across retries; email after approval; confirmed login and profile setup. No real payment or email was triggered during local verification.

The email redirect uses the existing production commercial Workers URL. Keep it in the Supabase redirect allowlist. Existing SMTP configuration is used unchanged.

## Evidence

- `node scripts/test-deferred-email-flow.mjs`: API, actual form handler and webhook behavior including replay and email failures. It fails against the prior Edge Function (401 instead of preparing the pending account).
- All existing `scripts/test-*.mjs` passed.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/validate-deferred-email-migration.mjs`: actual isolated PostgreSQL with PGlite 0.5.8, verifies permissions, repeat application and uniqueness; CI installs the pinned test runtime in a temporary directory.
- `npm run build` passed. Pre-existing warnings: duplicate `sharp` key and no Tailwind utility classes.

No live migration, function deployment, email delivery or actual payment has been performed. A provider request left in `pending_provider` after an ambiguous network failure requires reconciliation before another checkout is created; this deliberately prevents duplicate purchases.
