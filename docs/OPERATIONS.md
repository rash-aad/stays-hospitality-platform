# Deploying and operating

## Production topology

`deploy/docker-compose.prod.yml` runs **Caddy → web → api**, plus a **worker** (same image, `node apps/api/dist/worker.js`). Use managed PostgreSQL 16 and Redis 7 in production.

1. Create `.env.production` from `.env.example`. Generate fresh secrets:
   - `JWT_SECRET`: 48+ random bytes
   - `SECRETS_MASTER_KEY`: 32 bytes hex (`openssl rand -hex 32`) — **back this up**; without it, stored gateway keys cannot be decrypted
   - `REVALIDATE_SECRET`, VAPID keys (`npx web-push generate-vapid-keys`)
   - `APP_DATABASE_URL` must use the unprivileged `hp_app` role so row-level security applies; migrations use the owner role (`DATABASE_URL`).
2. Run migrations: `npm run db:migrate` (creates the role grants and RLS policies).
3. `docker compose -f deploy/docker-compose.prod.yml up -d`.
4. Create the first platform admin (see `apps/api/src/seed.ts` for the pattern) and onboard properties from `/platform`.

## Custom domains and TLS

Tenants add a domain in **Website → Domains** and create a TXT record `_stays-verify.<host>` plus a CNAME to your edge. Only **verified** domains resolve to a tenant. Caddy's on-demand TLS issues certificates as traffic arrives; restrict issuance with its `ask` hook to verified hostnames.

## Backups and recovery

- Nightly logical backups: `pg_dump --format=custom --no-owner "$DATABASE_URL" > stays-$(date +%F).dump`; keep 30 days, copy off-site.
- Point-in-time recovery: enable WAL archiving (or use your managed provider's PITR).
- Restore drill (monthly): `createdb stays_restore && pg_restore --no-owner -d stays_restore stays-YYYY-MM-DD.dump`, then run `npm run db:migrate` against it and smoke-test.
- Uploaded files live in the `uploads` volume (`UPLOAD_DIR`) — back it up with the database.
- Back up `SECRETS_MASTER_KEY` separately from the database.

## Health and monitoring

- `/live` (process up), `/ready` (DB + Redis + queue depths, 503 when degraded), `/metrics` (Prometheus: request latency histogram, job counts, Node runtime).
- Every response carries `x-request-id`; logs are JSON with the same id.
- Alert on: `/ready` failing, `jobs_processed_total{result="error"}` rising, queue `failed` > 0, p95 latency.

## Background jobs

| Job | Schedule | Purpose |
|---|---|---|
| `notify` | on demand + sweep | Drain the notification outbox (email, SMS/WhatsApp adapters, web push) |
| `expire-holds` | every minute | Release unpaid booking holds; expire stale order/experience payments |
| `sla-sweep` | every minute | Escalate requests past their target time |
| `reconcile-gateway` | every 5 minutes | Gateway status reconciliation hook |
| `generate-housekeeping` | 00:30 daily | Create stayover cleaning tasks for occupied rooms |
