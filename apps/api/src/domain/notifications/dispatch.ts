import { notifications, pushSubscriptions } from '@hp/db';
import { and, eq, sql } from 'drizzle-orm';
import webpush from 'web-push';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../../config.js';
import { asSystem } from '../../infra/db.js';

export type OutboundMessage = { to: string; subject: string | null; body: string; tenantId: string; recipientType: 'guest' | 'user'; recipientId: string; relatedType: string | null; relatedId: string | null };
/** Channel adapter. SMS/WhatsApp/push ship with a logging driver; swap in a vendor (MSG91, Gupshup, FCM) here. */
export interface ChannelDriver {
  send(msg: OutboundMessage): Promise<void>;
}

class EmailDriver implements ChannelDriver {
  constructor(private transport: Transporter, private from: string) {}
  async send(msg: OutboundMessage) {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject ?? '', text: msg.body });
  }
}

class LogDriver implements ChannelDriver {
  constructor(private channel: string) {}
  async send(msg: OutboundMessage) {
    console.info(`[${this.channel}] → ${msg.to}: ${msg.body.slice(0, 160)}`);
  }
}

const drivers: Partial<Record<string, ChannelDriver>> = {};

export function initTransports(config: Config) {
  drivers.email = new EmailDriver(
    nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false, ignoreTLS: config.NODE_ENV !== 'production' }),
    config.MAIL_FROM,
  );
  drivers.sms = new LogDriver('sms');
  drivers.whatsapp = new LogDriver('whatsapp');
  drivers.push = config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY ? new WebPushDriver(config) : new LogDriver('push');
}

/** Web push to every installed PWA of the recipient; dead subscriptions are pruned. */
class WebPushDriver implements ChannelDriver {
  constructor(config: Config) {
    webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
  }
  async send(msg: OutboundMessage) {
    const subs = await asSystem((tx) => tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, msg.tenantId), eq(pushSubscriptions.recipientType, msg.recipientType), eq(pushSubscriptions.recipientId, msg.recipientId))));
    const url = msg.recipientType === 'guest' ? '/stay' : '/admin';
    const payload = JSON.stringify({ title: msg.subject ?? 'Update', body: msg.body.slice(0, 240), url, tag: msg.relatedId ?? undefined });
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await asSystem((tx) => tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)));
      }
    }
  }
}

export function setDriver(channel: string, driver: ChannelDriver) {
  drivers[channel] = driver;
}

/** Drain the notification outbox. Safe to run concurrently thanks to SKIP LOCKED. */
export async function dispatchNotifications(batch = 50) {
  let sent = 0;
  await asSystem(async (tx) => {
    const rows = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.status, 'queued'))
      .orderBy(notifications.createdAt)
      .limit(batch)
      .for('update', { skipLocked: true });
    for (const n of rows) {
      const driver = drivers[n.channel];
      if (!driver || !n.toAddress) {
        await tx.update(notifications).set({ status: 'skipped', error: n.toAddress ? 'no driver' : 'no address' }).where(eq(notifications.id, n.id));
        continue;
      }
      try {
        await driver.send({ to: n.toAddress, subject: n.subject, body: n.body, tenantId: n.tenantId, recipientType: n.recipientType, recipientId: n.recipientId, relatedType: n.relatedType, relatedId: n.relatedId });
        await tx.update(notifications).set({ status: 'sent', sentAt: sql`now()` }).where(eq(notifications.id, n.id));
        sent++;
      } catch (e) {
        await tx.update(notifications).set({ status: 'failed', error: String((e as Error).message).slice(0, 500) }).where(eq(notifications.id, n.id));
      }
    }
  });
  return { sent };
}
