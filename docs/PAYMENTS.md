# Payments (UPI-first)

Each property chooses its methods in **Settings → Payment methods**. Guests only see what the property enabled.

| Method | How it works | Confirmation |
|---|---|---|
| **UPI to your own UPI ID** (`upi_manual`) | Guest scans a QR / taps a `upi://pay` link for the exact amount to the property's VPA, then enters the 12-digit UTR. | Staff with `payments.verify` approve or reject in **Payments → To verify** after checking their bank/UPI app. |
| **UPI gateway** (`upi_gateway`) | Razorpay UPI checkout (adapter pattern — Cashfree/PhonePe can be added). | Automatic, via a signed webhook (plus signed browser callback). |
| **Room charge** | In-house guests add dining/experiences to their folio. | Immediate; appears on the invoice. |
| **Pay at property** | Confirm now, settle at the desk. | Staff record desk payments against the booking. |

## Manual UPI lifecycle

```
awaiting_payment ──UTR submitted──► pending_verification ──approve──► captured ──► booking confirmed
        ▲                                   │
        └──────── rejected (reason emailed, guest resubmits) ◄──reject
expired ◄── hold window lapses (room released, guest emailed)
```

- The room is **held** while the guest pays (default 30 min) and while staff verify (default 24 h); both windows are configurable. A background job expires lapsed holds and releases inventory.
- **Duplicate UTRs** are refused across the tenant (unique index), except for rejected attempts.
- Every approve/reject is written to the audit log with the verifying staff member.
- A payment verified after its hold lapsed re-takes the room if still available; otherwise it is flagged "Refund due".

## Gateway

- Keys and webhook secrets are **encrypted at rest** (AES-256-GCM with `SECRETS_MASTER_KEY`) and never returned by the API.
- Webhook URL per tenant: `/api/v1/public/payments/webhook/<tenant-slug>/razorpay` — signatures are verified against the raw body; replays are idempotent; an amount mismatch never auto-confirms.
- Refunds on gateway payments go through the gateway API; refunds on direct UPI/desk payments are recorded (the property pays them back directly).

## Never stored

Card numbers, UPI PINs, or gateway secrets in plain text.
