import { randomUUID } from 'node:crypto';
import { hmacHex, safeEqualHex } from './hmac.js';
import type { GatewayEvent, UpiGateway } from './types.js';

/** In-memory gateway for development and tests; mirrors Razorpay's signature scheme. */
const orders = new Map<string, { amount: number; paid?: GatewayEvent }>();

export const mockGateway: UpiGateway & { simulatePayment(orderId: string, webhookSecret: string, success?: boolean): { body: string; signature: string; event: GatewayEvent } } = {
  name: 'mock',
  async createOrder(_creds, input) {
    const orderId = `order_mock_${randomUUID().slice(0, 12)}`;
    orders.set(orderId, { amount: input.amount });
    return { orderId, checkout: { provider: 'mock', orderId, amount: input.amount, currency: input.currency, method: 'upi' } };
  },
  verifyWebhook(creds, rawBody, signature) {
    return !!signature && safeEqualHex(hmacHex(creds.webhookSecret, rawBody), signature);
  },
  parseWebhook(body) {
    const b = body as { event?: string; orderId?: string; paymentId?: string; vpa?: string; amount?: number };
    if (!b.orderId || !b.paymentId) return null;
    return { orderId: b.orderId, paymentId: b.paymentId, status: b.event === 'payment.captured' ? 'captured' : 'failed', payerVpa: b.vpa, amount: b.amount };
  },
  verifyCheckout(creds, { orderId, paymentId, signature }) {
    return safeEqualHex(hmacHex(creds.secret, `${orderId}|${paymentId}`), signature);
  },
  async fetchOrder(_creds, orderId) {
    return orders.get(orderId)?.paid ?? null;
  },
  async refund() {
    return { refundId: `rfnd_mock_${randomUUID().slice(0, 12)}` };
  },
  simulatePayment(orderId, webhookSecret, success = true) {
    const o = orders.get(orderId);
    const event: GatewayEvent = { orderId, paymentId: `pay_mock_${randomUUID().slice(0, 12)}`, status: success ? 'captured' : 'failed', payerVpa: 'guest@okaxis', amount: o?.amount };
    if (o && success) o.paid = event;
    const body = JSON.stringify({ event: success ? 'payment.captured' : 'payment.failed', ...event, vpa: event.payerVpa });
    return { body, signature: hmacHex(webhookSecret, body), event };
  },
};

