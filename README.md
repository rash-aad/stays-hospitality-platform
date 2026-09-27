# bookEZ — hotel software for direct bookings, operations and guest experience

**bookez.in** · Multi-tenant platform for hotels, resorts and homestays in India.

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
- **Restaurant**: table allocation with an exclusion constraint against overlaps, waitlist, menus with variants/add-ons/allergens, kitchen queue with orders assigned to a cook ("Only mine" filter)
- **Guest services**: configurable request types with workflows and SLAs routed to housekeeping and maintenance
- **Website builder**: structured JSON pages (no raw HTML), autosave with revision checks, publish, version history, rollback, custom domains verified by DNS TXT; image fields pick from the media library; an events enquiry section feeds the events desk
- **GST tax invoices**: GSTIN checksum validation, SAC codes, CGST/SGST split, financial-year numbering, company bill-to; issued invoices are frozen
- **Guest journey automation**: pre-arrival email with online check-in, experience and table reminders, waitlist promotion notices, post-stay feedback with NPS and staff replies
- **Self-service**: guests change dates (priced first, then committed) and complete online check-in (only the last 4 ID characters stored)
- **Channel manager**: two-way sync through Channex (rooms left, rule-adjusted rates, stop-sell, min stay pushed as deltas; OTA bookings pulled, acknowledged only once recorded; overbookings recorded and flagged) plus a built-in test provider
- **Channel sync (iCal)**: export of sold-out nights and SSRF-safe import of OTA calendars that holds inventory and flags clashes
- **bookEZ subscriptions**: per-property monthly/yearly price and free days set by the super admin; owners pay by UPI QR and submit the UTR; manual verification queue with a 12-hour target; GST tax invoices (CGST/SGST or IGST) numbered per financial year; reminders, grace period, suspension and instant reactivation
- **Languages**: English, Hindi, Tamil and Malayalam for the website chrome, booking flow, payment page and guest app; per-page content translations with stale-source fallback
- **Loyalty & CRM**: points on stays with tiers, redeemable in the guest app and returned on cancellation; opt-in email campaigns with segments and one-click unsubscribe; one-time public review invitations after 4★+ feedback
- **Revenue tools**: automatic pricing by occupancy, lead time and weekday with floors/ceilings and previews; 30-night revenue grid with pickup; honest scarcity nudge
- **Front office**: tape chart (drag to move/extend), night audit with daily owner report, cash drawer shifts
- **Security**: two-step sign-in with recovery codes and per-hotel policy, device sessions, shared-device PIN sign-in, console IP allow-list
- **Privacy (DPDP Act)**: guest data export and erasure, with financial records kept pseudonymised

## Run locally
```bash
cp .env.example .env            # dev defaults
docker compose up -d            # Postgres 16, Redis 7, Mailpit
npm install
npm run db:reset                # migrate + seed two demo properties
npm run dev:api                 # http://localhost:4000  (docs at /docs)
npm run dev:web                 # http://localhost:3000
npm run dev:platform            # Super Admin console on http://localhost:3001
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
