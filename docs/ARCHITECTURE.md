# Architecture

## Shape

A **modular monolith**: one API service with clear domain modules, one web app, one database. No microservices — each domain (bookings, payments, restaurant, guest services, content…) owns its routes, service logic and tables behind a thin HTTP layer, so a module can be extracted later if scale ever demands it.

```
Browser ──► Next.js (apps/web) ──same-origin /api/v1──► Fastify API (apps/api) ──► PostgreSQL (RLS)
   │            │ proxy.ts: Host → tenant site                      │            └─► Redis (cache, rate limits, BullMQ)
   │            └─ /internal/revalidate ◄── purge after publish ────┘
   └─ Service worker (PWA): app shell, offline stay & guide, web push
Worker (same image as the API): notifications outbox, hold expiry, SLA escalation, daily housekeeping
```

### Surfaces (one Next.js app)

| Host / path | Surface |
|---|---|
| platform host `/platform` | Super Admin: onboard tenants, module plans, suspension |
| platform host `/admin` | Tenant Admin (all staff roles; nav filtered by modules and permissions) |
| platform host `/admin/site/edit/:id` | Visual website builder (full-screen) |
| tenant host `/`, `/:slug` | Tenant website rendered from published page documents |
| tenant host `/book`, `/book/pay/:id` | Booking flow and UPI payment page |
| tenant host `/stay/*` | Unified guest portal (installable PWA) |

`proxy.ts` rewrites any non-platform host to `/t/<host>/…`, so a custom domain like `www.seabreeze.in` serves that tenant with no per-tenant configuration in the web tier.

## Multi-tenancy

- Every tenant table carries `tenant_id NOT NULL`.
- **Two layers of isolation.** Services always filter by tenant, *and* PostgreSQL row-level security enforces `tenant_id = current_setting('app.tenant_id')` for the unprivileged runtime role (`hp_app`). A query that forgets its filter still cannot read or write another tenant's rows (tested).
- Tenant context comes only from a verified token or the resolved site host — never from request bodies. A token minted for one property is refused on another property's host.
- `asSystem()` (RLS bypass) is used only for host resolution, login lookup, platform administration and background jobs.

## Modules

`packages/contracts/src/modules.ts` is the single registry (19 modules with dependencies). The API rejects disabled modules with `403 module_disabled` at the route level; disabling a module cascades to its dependents; the admin nav, guest portal tabs and website sections read the same registry.

## Key domain decisions

- **Inventory**: a nightly ledger per room type (`availability.booked ≤ total` CHECK). Rows are locked `FOR UPDATE` in date order inside the booking transaction. Eight concurrent requests for the last room produce exactly one booking (tested).
- **Idempotency**: booking, order and experience POSTs take an `Idempotency-Key`; a retry replays the stored response, a different body under the same key is rejected.
- **Restaurant tables**: best-fit allocation under a per-outlet row lock, backed by a PostgreSQL exclusion constraint on `(table_id, tstzrange)` so no two active reservations can overlap.
- **Payments**: one `PaymentProvider` flow with per-tenant choice of methods (see PAYMENTS.md). Domains register what happens when their payment settles (`registerPaymentTarget`), so payments never import domain code.
- **Service requests**: a generic engine — configurable types, form fields, workflows, SLAs — that routes into housekeeping tasks or maintenance tickets and closes the loop when the work is done.
- **Stay context**: room numbers for orders and requests come from the guest's verified in-house stay, never from the client.
- **Pages**: structured JSON validated by a Zod discriminated union (19 section types). No raw HTML is stored; links and images are scheme-restricted; tags are stripped. Drafts save with an optimistic revision number; publishing creates an immutable version; rollback restores any version.
- **Notifications**: an outbox table written inside the business transaction and drained by the worker (`FOR UPDATE SKIP LOCKED`), so a rolled-back booking never emails a confirmation.
- **Post-commit hooks**: side effects such as purging the web cache run only after the tenant transaction commits (`afterCommit`).

## Observability

Structured pino logs with request IDs (echoed as `x-request-id`), Prometheus metrics at `/metrics`, `/live`, `/health`, `/ready` (DB, Redis, queue depths), audit log for every sensitive action, graceful shutdown that drains in-flight requests.
