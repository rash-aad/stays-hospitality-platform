export type GatewayCredentials = { keyId: string; secret: string; webhookSecret: string };

export type GatewayOrder = {
  orderId: string;
  /** Data the browser needs to open the gateway's UPI checkout. */
  checkout: Record<string, unknown>;
};

export type GatewayEvent = {
  orderId: string;
  paymentId: string;
  status: 'captured' | 'failed' | 'pending';
  payerVpa?: string;
  amount?: number;
};

export interface UpiGateway {
  readonly name: 'razorpay' | 'mock';
  createOrder(creds: GatewayCredentials, input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  verifyWebhook(creds: GatewayCredentials, rawBody: string, signature: string | undefined): boolean;
  parseWebhook(body: unknown): GatewayEvent | null;
  /** Verify the signature the checkout returns to the browser on success. */
  verifyCheckout(creds: GatewayCredentials, input: { orderId: string; paymentId: string; signature: string }): boolean;
  fetchOrder(creds: GatewayCredentials, orderId: string): Promise<GatewayEvent | null>;
  refund(creds: GatewayCredentials, input: { paymentId: string; amount: number }): Promise<{ refundId: string }>;
}
