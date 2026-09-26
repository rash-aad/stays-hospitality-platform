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

- Nightly backups: `scripts/backup.sh` (cron it) writes a verified `pg_dump` custom-format dump plus an uploads tarball to `BACKUP_DIR` and prunes after `KEEP_DAYS` (30). Copy `BACKUP_DIR` off-site afterwards.
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
| `reconcile-gateway` | every 5 minutes | Ask the gateway about payments whose webhook never arrived |
| `reminders` | every 10 minutes | Pre-arrival (with online check-in link), experience and table reminders, post-stay feedback requests — each sent once |
| `ical-sync` | every 30 minutes | Import OTA calendars (Airbnb, Booking.com…) and hold or release rooms; clashes are flagged, never oversold |
| `generate-housekeeping` | 00:30 daily | Create stayover cleaning tasks for occupied rooms |

## Channel calendars (iCal)

**Settings → Channels (iCal)**. *Share our calendar* creates a secret `…/api/v1/public/ical/<token>.ics` link per room type listing sold-out or closed nights (no guest data) — paste it into each OTA. *Import a channel* takes the OTA's https calendar link; imported reservations hold one room per night like a booking. Imports only fetch public https addresses (private/internal IPs are refused at connect time, redirects are not followed, 2 MB / 10 s caps).

## Guest data (DPDP Act)

Guests can download their data or erase it from the portal (**More → Your data**); staff can erase from a guest's profile. Erasure is refused while a stay is upcoming or in progress, removes names, contacts, messages and preferences, and keeps pseudonymised financial records (bookings, invoices) as tax law requires. Online check-in stores only the last four characters of an ID number.

## CI

`.github/workflows/ci.yml` runs typecheck, the API/contract test suites against Postgres and Redis service containers, and production builds of both apps on every push and pull request.

## Super Admin console on its own origin

The platform console (`/platform`) is served only on `PLATFORM_HOST`; every other host answers 404 for it, and the console origin exposes nothing but the console and its `/api/v1/auth` + `/api/v1/platform` endpoints. Platform sessions use their own refresh cookie, so a hotel login in the same browser never replaces them.

- **Development:** `npm run dev:platform` serves it on http://localhost:3001 (`apps/web/.env.local`: `PLATFORM_HOST=localhost:3001`, `NEXT_PUBLIC_PLATFORM_URL=http://localhost:3001`).
- **Production:** set `CONSOLE_HOST=console.example.com` for `deploy/docker-compose.prod.yml`; Caddy gives it its own certificate. Consider restricting it further by IP allow-list in the Caddyfile.

## Two-step sign-in and sessions

- Staff and platform admins can turn on authenticator-app codes (TOTP) with ten single-use recovery codes in **Your account**. Each code is accepted once.
- **Settings → Security** makes it mandatory for owners/managers or everyone; affected people must set it up before they can use the admin (existing sessions are stepped up within 15 minutes). Owners must enrol themselves first.
- Platform admins must use it in production (`PLATFORM_REQUIRE_MFA`, default on when `NODE_ENV=production`). `PLATFORM_IP_ALLOWLIST` (comma-separated IPs/CIDRs) restricts the console at the API.
- Lost phone: an owner uses **Staff & roles → Reset two-step**, which also signs that person out everywhere.
- **Your account → Where you’re signed in** lists devices and can sign out the others.

## Shared devices, PIN sign-in and scan-to-clean

- A manager opens **Settings → Staff & roles → Shared devices** *on the tablet or phone itself* and sets it up; the browser gets a long-lived httpOnly device cookie. Removing a device ends every shift session on it.
- Staff set a 4–6 digit PIN in **Your account** (guessable PINs like 1234 or 0000 are refused). On a shared device they tap their name at `/admin/pin`; the session lasts one 12-hour shift and counts as two-step sign-in (device + PIN). Five wrong PINs lock PIN sign-in for 15 minutes. Owners always use their password.
- **Housekeeping → Room QR codes** prints a code per room. Scanning opens the room’s page: start/finish the clean, pass or fail inspection, or report a fault (becomes a maintenance ticket and can take the room out of sale).
