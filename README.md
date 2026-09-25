# Stays — hospitality CRM, direct booking & guest experience platform

Multi-tenant platform for hotels, resorts and villas: a tenant CRM and operations workspace, a branded website with a visual builder (10 templates), direct room booking with UPI payments, restaurant reservations and ordering, and one mobile-first guest portal (PWA) for the whole stay.

**Status:** feature-complete across all surfaces, covered by API integration tests and Playwright end-to-end tests of the full guest journey.

| Surface | Where | Who |
|---|---|---|
| Super Admin console | `/platform` | Platform operators — onboard properties, module plans, suspend |
| Tenant Admin | `/admin` | Owner, GM, front desk, restaurant, kitchen, housekeeping, maintenance, concierge (nav and actions follow each role's permissions) |
| Visual website builder | `/admin/site` | Content editors and publishers |
| Property website | tenant domain `/` | The public |
| Booking & UPI payment | tenant domain `/book` | Guests |
| Guest portal (installable PWA) | tenant domain `/stay` | Staying and upcoming guests |

## Stack
- `apps/api` — Node.js + TypeScript, Fastify, REST under `/api/v1`, OpenAPI at `/docs`, BullMQ workers
- `apps/web` — Next.js 16 (App Router), React 19, Tailwind 4; host-based routing serves every tenant's own site
- `packages/db` — PostgreSQL 16 via Drizzle; migrations with row-level security on every tenant table
- `packages/contracts` — shared module registry, permissions, page-builder schema and site templates

## Highlights
- **Tenant isolation** in the query layer *and* PostgreSQL row-level security
- **19 switchable modules** enforced server-side (disabled → 403, dependents cascade off)
- **Booking engine** with a row-locked nightly inventory ledger (no double booking), idempotency keys, seasonal/weekend/occupancy pricing, GST slabs, coupons and cancellation policies
- **UPI payments** chosen per tenant: the property's own UPI ID with staff verification of the UTR, or a UPI gateway (Razorpay adapter; signed webhooks), plus room charge and pay-at-property
- **Restaurant**: table allocation with an exclusion constraint against overlaps, waitlist, menus with variants/add-ons/allergens, kitchen queue
- **Guest services**: configurable request types with workflows and SLAs routed to housekeeping and maintenance
- **Website builder**: structured JSON pages (no raw HTML), autosave with revision checks, publish, version history, rollback, custom domains verified by DNS TXT

## Run locally
```bash
cp .env.example .env            # dev defaults
docker compose up -d            # Postgres 16, Redis 7, Mailpit
npm install
npm run db:reset                # migrate + seed two demo properties
npm run dev:api                 # http://localhost:4000  (docs at /docs)
npm run dev:web                 # http://localhost:3000
```
Demo sites: http://seabreeze.localhost:3000 (resort with dining) and http://printworks.localhost:3000 (city hotel, no restaurant).
Demo logins are listed at the top of `apps/api/src/seed.ts`. Emails are captured by Mailpit at http://localhost:8025.

## Documentation
- [Architecture](docs/ARCHITECTURE.md) — tenancy, modules, booking concurrency, page model, jobs
- [Payments](docs/PAYMENTS.md) — own-UPI-ID with staff verification, UPI gateway, room charge
- [Operations](docs/OPERATIONS.md) — deployment, custom domains/TLS, backups, monitoring

## Tests
```bash
npm test          # API integration suites (isolation, modules, concurrency, payments, restaurant, builder, domains…)
npm run e2e       # Playwright: guest journey, edge cases, roles, builder, platform, mobile (needs dev servers running)
```
