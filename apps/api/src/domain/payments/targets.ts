import type { payments } from '@hp/db';
import type { Tx } from '../../infra/db.js';

type Payment = typeof payments.$inferSelect;
export type PaymentTargetHandler = {
  /** Payment fully captured (verified manual UPI or gateway success). */
  onCaptured(tx: Tx, payment: Payment): Promise<void>;
  /** Guest submitted a UTR: extend holds / notify. */
  onSubmitted?(tx: Tx, payment: Payment): Promise<void>;
  /** Manual payment rejected by staff (guest may resubmit). */
  onRejected?(tx: Tx, payment: Payment): Promise<void>;
  /** Refund recorded or processed. */
  onRefunded?(tx: Tx, payment: Payment, amount: number): Promise<void>;
};

const handlers = new Map<string, PaymentTargetHandler>();

/** Domains register what happens when their payments settle — keeps payments free of domain imports. */
export function registerPaymentTarget(type: Payment['targetType'], handler: PaymentTargetHandler) {
  handlers.set(type, handler);
}

export function targetHandler(type: string) {
  return handlers.get(type);
}
