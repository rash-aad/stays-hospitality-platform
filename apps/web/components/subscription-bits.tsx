'use client';

import { cx } from './ui';

export type SubState = 'trial' | 'active' | 'due' | 'overdue' | 'lapsed' | 'suspended' | 'comp' | 'cancelled';
const TONE: Record<SubState, string> = { trial: 'chip-accent', active: 'chip-ok', due: 'chip-warn', overdue: 'chip-bad', lapsed: 'chip-bad', suspended: 'chip-bad', comp: 'chip-neutral', cancelled: 'chip-neutral' };
const LABEL: Record<SubState, string> = { trial: 'Free trial', active: 'Active', due: 'Renewal due', overdue: 'Overdue', lapsed: 'Overdue', suspended: 'Suspended', comp: 'Complimentary', cancelled: 'Cancelled' };

export function SubStatus({ state }: { state: SubState }) {
  return <span className={cx('chip', TONE[state])} data-testid="sub-state">{LABEL[state]}</span>;
}

export const rupees = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));
export const inr = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
