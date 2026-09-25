import { mockGateway } from './mock.js';
import { razorpay } from './razorpay.js';
import type { UpiGateway } from './types.js';

export const GATEWAYS: Record<'razorpay' | 'mock', UpiGateway> = { razorpay, mock: mockGateway };
export type { UpiGateway };
