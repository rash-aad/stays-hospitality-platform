import { guests, notifications, notificationTemplates, users } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';
import { enqueue } from '../../infra/queue.js';
import { DEFAULT_TEMPLATES, render } from './templates.js';

export type Recipient = { type: 'guest' | 'user'; id: string };
export type Channel = 'email' | 'sms' | 'whatsapp' | 'push' | 'in_app';

/**
 * Outbox: rows are written inside the caller's transaction and dispatched by the worker after commit,
 * so a rolled-back booking never sends a confirmation.
 */
export async function notify(
  tx: Tx,
  input: {
    tenantId: string;
    recipient: Recipient;
    templateKey: string;
    vars: Record<string, unknown>;
    channels?: Channel[];
    related?: { type: string; id: string };
  },
) {
  const channels = input.channels ?? ['email', 'in_app'];
  const person =
    input.recipient.type === 'guest'
      ? (await tx.select({ email: guests.email, phone: guests.phone, prefs: guests.notificationPrefs }).from(guests).where(eq(guests.id, input.recipient.id)))[0]
      : (await tx.select({ email: users.email, prefs: users.notificationPrefs }).from(users).where(eq(users.id, input.recipient.id))).map((u) => ({ ...u, phone: null as string | null }))[0];
  if (!person) return;
  const overrides = await tx
    .select()
    .from(notificationTemplates)
    .where(and(eq(notificationTemplates.tenantId, input.tenantId), eq(notificationTemplates.key, input.templateKey), eq(notificationTemplates.active, true)));
  const base = DEFAULT_TEMPLATES[input.templateKey] ?? { subject: input.templateKey, body: '' };
  const rows = channels
    .filter((ch) => ch === 'in_app' || person.prefs[ch] !== false)
    .map((ch) => {
      const o = overrides.find((t) => t.channel === (ch === 'in_app' ? 'email' : ch));
      const subject = render(o?.subject ?? base.subject, input.vars);
      const body = render(o?.body ?? (ch === 'sms' || ch === 'whatsapp' ? (base.sms ?? base.body) : base.body), input.vars);
      const to = ch === 'email' ? person.email : ch === 'sms' || ch === 'whatsapp' ? person.phone : ch === 'push' ? 'subscriptions' : null;
      return {
        tenantId: input.tenantId,
        channel: ch,
        recipientType: input.recipient.type,
        recipientId: input.recipient.id,
        toAddress: to,
        templateKey: input.templateKey,
        subject,
        body,
        status: ch === 'in_app' ? ('sent' as const) : ('queued' as const),
        sentAt: ch === 'in_app' ? new Date() : null,
        relatedType: input.related?.type,
        relatedId: input.related?.id,
      };
    });
  if (rows.length) await tx.insert(notifications).values(rows);
  // Nudge the dispatcher; the periodic sweep guarantees delivery even if this is lost.
  await enqueue('notify', {}, { delayMs: 300 });
}
