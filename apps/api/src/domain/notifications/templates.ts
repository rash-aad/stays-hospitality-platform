/** Built-in templates. Tenants override per key/channel in notification_templates. `{{var}}` is escaped on render. */
export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; sms?: string }> = {
  'auth.password_reset': {
    subject: 'Reset your password',
    body: 'Hello {{name}},\n\nUse the link below to choose a new password. It expires in 1 hour.\n\n{{link}}\n\nIf you did not ask for this, you can ignore this email.',
  },
  'auth.email_verify': {
    subject: 'Confirm your email for {{property}}',
    body: 'Hello {{name}},\n\nPlease confirm your email address:\n\n{{link}}',
  },
  'auth.staff_invite': {
    subject: "You're invited to {{property}}",
    body: 'Hello {{name}},\n\n{{inviter}} has invited you to the {{property}} workspace. Set your password here (valid 7 days):\n\n{{link}}',
  },
  'guest.access_link': {
    subject: 'Your stay at {{property}}',
    body: 'Hello {{name}},\n\nOpen your stay — dining, requests and everything else for booking {{reference}} — with this private link (valid 24 hours):\n\n{{link}}',
  },
  'booking.confirmed': {
    subject: 'Booking confirmed — {{reference}}',
    body: 'Dear {{name}},\n\nThank you for choosing {{property}}. Your booking {{reference}} is confirmed.\n\nArrival: {{checkIn}}\nDeparture: {{checkOut}}\nRoom: {{room}}\nTotal: {{total}}\n\nManage your stay: {{link}}',
    sms: '{{property}}: booking {{reference}} confirmed for {{checkIn}}. Manage: {{link}}',
  },
  'booking.awaiting_payment': {
    subject: 'Complete your payment — {{reference}}',
    body: 'Dear {{name}},\n\nWe are holding your room until {{holdUntil}}. Pay {{total}} by UPI to {{vpa}} and submit your UTR on the payment page:\n\n{{link}}',
  },
  'booking.payment_submitted': {
    subject: 'Payment received for verification — {{reference}}',
    body: 'Dear {{name}},\n\nWe have received your UPI reference {{utr}}. Our team will verify it shortly and confirm your booking.',
  },
  'booking.payment_rejected': {
    subject: 'We could not verify your payment — {{reference}}',
    body: 'Dear {{name}},\n\nWe could not match UPI reference {{utr}} to a payment: {{reason}}\n\nPlease check and resubmit before {{holdUntil}}: {{link}}',
  },
  'booking.cancelled': {
    subject: 'Booking cancelled — {{reference}}',
    body: 'Dear {{name}},\n\nYour booking {{reference}} has been cancelled. {{refundNote}}',
  },
  'booking.expired': {
    subject: 'Your booking hold has expired — {{reference}}',
    body: 'Dear {{name}},\n\nWe did not receive a verified payment for {{reference}} in time, so the room has been released. You are welcome to book again.',
  },
  'booking.pre_arrival': {
    subject: 'We look forward to welcoming you, {{name}}',
    body: 'Your stay at {{property}} begins on {{checkIn}}. Check-in is from {{checkInTime}}. Your guest portal: {{link}}',
  },
  'restaurant.reservation_confirmed': {
    subject: 'Table confirmed at {{restaurant}}',
    body: 'Dear {{name}},\n\nYour table for {{partySize}} at {{restaurant}} on {{when}} is confirmed. Reference {{reference}}.',
  },
  'restaurant.reservation_waitlisted': {
    subject: 'You are on the waitlist at {{restaurant}}',
    body: 'Dear {{name}},\n\nWe have added you to the waitlist for {{partySize}} on {{when}}. We will write as soon as a table opens up.',
  },
  'restaurant.reservation_cancelled': {
    subject: 'Reservation cancelled — {{restaurant}}',
    body: 'Dear {{name}},\n\nYour reservation {{reference}} for {{when}} has been cancelled.',
  },
  'order.status': {
    subject: 'Order {{reference}}: {{status}}',
    body: 'Your order {{reference}} is now {{status}}.',
  },
  'request.status': {
    subject: '{{title}}: {{status}}',
    body: 'Your request "{{title}}" ({{reference}}) is now {{status}}.{{note}}',
  },
  'experience.confirmed': {
    subject: '{{experience}} — confirmed',
    body: 'Dear {{name}},\n\n{{experience}} on {{when}} for {{participants}} is confirmed. Reference {{reference}}.',
  },
  'message.new': {
    subject: 'New message from {{property}}',
    body: '{{body}}',
  },
  'staff.payment_to_verify': {
    subject: 'UPI payment to verify — {{reference}}',
    body: '{{guest}} submitted UTR {{utr}} for {{amount}} ({{reference}}). Verify it in Payments → Verification.',
  },
};

export function render(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}
