import { hmacHex, safeEqualHex } from './hmac.js';
import type { GatewayCredentials, GatewayEvent, UpiGateway } from './types.js';

const API = 'https://api.razorpay.com/v1';

async function call<T>(creds: GatewayCredentials, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.secret}`).toString('base64')}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new Error(`Razorpay ${path} failed: ${body.error?.description ?? res.status}`);
  return body;
}

/** Razorpay UPI (intent / collect / QR via Standard Checkout restricted to UPI). */
export const razorpay: UpiGateway = {
  name: 'razorpay',
  async createOrder(creds, input) {
    const order = await call<{ id: string }>(creds, '/orders', {
      method: 'POST',
      body: JSON.stringify({ amount: input.amount, currency: input.currency, receipt: input.receipt, notes: input.notes, payment_capture: 1 }),
    });
    return {
      orderId: order.id,
      checkout: { provider: 'razorpay', key: creds.keyId, orderId: order.id, amount: input.amount, currency: input.currency, method: 'upi' },
    };
  },
  verifyWebhook(creds, rawBody, signature) {
    if (!signature) return false;
    return safeEqualHex(hmacHex(creds.webhookSecret, rawBody), signature);
  },
  parseWebhook(body) {
    const b = body as { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
    const p = b.payload?.payment?.entity;
    if (!p || typeof p.order_id !== 'string' || typeof p.id !== 'string') return null;
    const status: GatewayEvent['status'] = b.event === 'payment.captured' ? 'captured' : b.event === 'payment.failed' ? 'failed' : 'pending';
    return { orderId: p.order_id, paymentId: p.id, status, payerVpa: typeof p.vpa === 'string' ? p.vpa : undefined, amount: typeof p.amount === 'number' ? p.amount : undefined };
  },
  verifyCheckout(creds, { orderId, paymentId, signature }) {
    return safeEqualHex(hmacHex(creds.secret, `${orderId}|${paymentId}`), signature);
  },
  async fetchOrder(creds, orderId) {
    const r = await call<{ items: { id: string; status: string; vpa?: string; amount: number }[] }>(creds, `/orders/${orderId}/payments`);
    const captured = r.items.find((i) => i.status === 'captured');
    if (captured) return { orderId, paymentId: captured.id, status: 'captured', payerVpa: captured.vpa, amount: captured.amount };
    const failed = r.items.find((i) => i.status === 'failed');
    return failed ? { orderId, paymentId: failed.id, status: 'failed' } : null;
  },
  async refund(creds, { paymentId, amount }) {
    const r = await call<{ id: string }>(creds, `/payments/${paymentId}/refund`, { method: 'POST', body: JSON.stringify({ amount }) });
    return { refundId: r.id };
  },
};
