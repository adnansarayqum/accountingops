# Operations runbook

## CI

Pull requests and pushes to `main` run `.github/workflows/ci.yml` on Node 20 and 24. Each quality job installs with `npm ci`, runs typecheck, lint, the complete Vitest suite, a production build, and `npm audit --audit-level=moderate`.

The quality jobs provide PostgreSQL and set `DATABASE_URL`. `npm run test:ci` first connects to it and fails if it is absent or unreachable; this prevents the critical auth/practice-data tests from being reported as harmless skips. A separate Node 20 job installs Chromium and runs the browser-only Playwright smoke test without application secrets.

## Browser-only mode is demo/local storage

When `DATABASE_URL` is absent, the app intentionally runs without sign-in and persists only to that browser's `localStorage`. This is suitable for demonstration and local evaluation only. Data is device/profile-specific, can be cleared by the browser, has no server backup or collaboration, and must not contain real client or taxpayer information.

Production/shared deployments must configure PostgreSQL, temporary bootstrap passwords, HTTPS, and provider settings described in `.env.example`.

## Database changes and migrations

The current shared-mode tables are created idempotently by `server/lib/db.mjs`; `db/schema.sql` documents both the target relational model and interim snapshot tables. Before changing schema:

1. Take and verify a restorable database backup.
2. Write forward and rollback SQL, including data conversion and lock/runtime expectations.
3. Test both directions against a production-sized copy with secrets and personal data removed.
4. Deploy backward-compatible application code before destructive schema changes.
5. Run the PostgreSQL CI suite and smoke checks against the migrated schema.
6. Record the applied revision and migration in the deployment log.

Do not edit an already-applied migration. Add a compensating migration. Do not rely on the browser-only mode to validate a database migration.

## Deployment and rollback

Before deployment, record the current application SHA, confirm a fresh database backup, run `npm ci`, `npm run check`, `npm audit --audit-level=moderate`, and the relevant Playwright smoke checks.

For application-only regressions, redeploy the previously recorded SHA. For an additive, backward-compatible migration, leave the schema in place while rolling the application back. For a data-changing or destructive migration, stop writes, capture another backup, apply the tested rollback/compensating migration, verify row counts and tenant boundaries, then redeploy the prior application SHA.

After rollback, verify `/health`, sign-in, practice-data load/save, tenant isolation, and the browser smoke journey. Preserve logs and the failed revision for incident review; never paste credentials or client data into an issue.
