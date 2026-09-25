import { notifications } from '@hp/db';
import { eq, sql } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../../config.js';
import { asSystem } from '../../infra/db.js';

export type OutboundMessage = { to: string; subject: string | null; body: string };
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
  drivers.push = new LogDriver('push');
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
        await driver.send({ to: n.toAddress, subject: n.subject, body: n.body });
        await tx.update(notifications).set({ status: 'sent', sentAt: sql`now()` }).where(eq(notifications.id, n.id));
        sent++;
      } catch (e) {
        await tx.update(notifications).set({ status: 'failed', error: String((e as Error).message).slice(0, 500) }).where(eq(notifications.id, n.id));
      }
    }
  });
  return { sent };
}
