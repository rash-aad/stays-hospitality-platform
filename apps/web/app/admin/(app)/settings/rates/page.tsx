'use client';

import { useState } from 'react';
import { Resource, moneyCol, type FieldDef } from '@/components/resource';
import { PageHeader, Status, Tabs } from '@/components/ui';
import { date, human } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type RP = { id: string; roomTypeId: string; name: string; code: string; mealPlan: string; basePrice: number; weekendPrice: number | null; refundable: boolean; minStay: number; active: boolean; cancellationPolicy: { label: string } };
type Season = { id: string; ratePlanId: string; name: string; startDate: string; endDate: string; price: number; minStay: number | null };
type Tax = { id: string; name: string; appliesTo: string; rateBps: number; minAmount: number | null; maxAmount: number | null; inclusive: boolean; active: boolean };
type Coupon = { id: string; code: string; description: string | null; discountType: string; value: number; minNights: number; validFrom: string | null; validTo: string | null; maxRedemptions: number | null; redemptions: number; active: boolean };
type Promo = { id: string; title: string; summary: string | null; active: boolean; showInPortal: boolean; startsAt: string | null; endsAt: string | null };
type AddOn = { id: string; name: string; price: number; per: string; active: boolean };

export default function Rates() {
  const [tab, setTab] = useState<'plans' | 'seasons' | 'taxes' | 'addons' | 'coupons' | 'promos'>('plans');
  const { data: types } = useStaff<{ data: { id: string; name: string }[] }>('/admin/room-types');
  const { data: plans } = useStaff<{ data: RP[] }>('/admin/rate-plans');
  const { data: props } = useStaff<{ data: { id: string }[] }>('/admin/properties');
  const { data: coupons } = useStaff<{ data: Coupon[] }>('/admin/coupons');
  const rtName = (id: string) => types?.data.find((t) => t.id === id)?.name ?? '';
  const planFields: FieldDef[] = [
    { key: 'roomTypeId', label: 'Room type', type: 'select', required: true, options: (types?.data ?? []).map((t) => ({ value: t.id, label: t.name })) },
    { key: 'name', label: 'Rate name', required: true }, { key: 'code', label: 'Code', required: true, hint: 'e.g. BB, RO, ADV' },
    { key: 'mealPlan', label: 'Meals', type: 'select', defaultValue: 'room_only', options: ['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'].map((v) => ({ value: v, label: human(v) })) },
    { key: 'basePrice', label: 'Nightly price (₹)', type: 'money', required: true }, { key: 'weekendPrice', label: 'Fri & Sat price (₹)', type: 'money', nullable: true },
    { key: 'extraAdultPrice', label: 'Extra adult (₹/night)', type: 'money', defaultValue: 0 }, { key: 'extraChildPrice', label: 'Extra child (₹/night)', type: 'money', defaultValue: 0 },
    { key: 'minStay', label: 'Minimum nights', type: 'number', defaultValue: 1 }, { key: 'maxStay', label: 'Maximum nights', type: 'number', defaultValue: 30 },
    { key: 'refundable', label: 'Refundable', type: 'bool', defaultValue: true, hint: 'Refundable rate' },
    { key: 'active', label: 'On sale', type: 'bool', defaultValue: true, hint: 'Show this rate to guests' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ];
  return (
    <>
      <PageHeader title="Rates, taxes & offers" sub="Prices are per room per night, before tax. Seasons override the rate on their dates.">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'plans', label: 'Rate plans' }, { value: 'seasons', label: 'Seasons' }, { value: 'taxes', label: 'Taxes' }, { value: 'addons', label: 'Add-ons' }, { value: 'coupons', label: 'Promo codes' }, { value: 'promos', label: 'Offers' }]} />
      </PageHeader>
      {tab === 'plans' && <Resource<RP> endpoint="/admin/rate-plans" noun="Rate plan" fields={planFields} sort={(a, b) => rtName(a.roomTypeId).localeCompare(rtName(b.roomTypeId)) || a.basePrice - b.basePrice}
        columns={[{ label: 'Room type', render: (r) => rtName(r.roomTypeId) }, { label: 'Rate', render: (r) => <span className="font-medium">{r.name} <span className="font-mono text-xs text-muted">{r.code}</span></span> }, { label: 'Meals', render: (r) => human(r.mealPlan) }, { label: 'Nightly', align: 'right', render: (r) => moneyCol(r.basePrice) }, { label: 'Weekend', align: 'right', render: (r) => (r.weekendPrice ? moneyCol(r.weekendPrice) : '—') }, { label: 'Policy', render: (r) => <span className="text-xs text-muted">{r.cancellationPolicy.label}</span> }, { label: 'On sale', render: (r) => (r.active ? 'Yes' : 'No') }]} />}
      {tab === 'seasons' && <Resource<Season> endpoint="/admin/rate-seasons" noun="Season" sort={(a, b) => a.startDate.localeCompare(b.startDate)}
        fields={[{ key: 'ratePlanId', label: 'Rate plan', type: 'select', required: true, wide: true, options: (plans?.data ?? []).map((p) => ({ value: p.id, label: `${rtName(p.roomTypeId)} — ${p.name}` })) }, { key: 'name', label: 'Season name', required: true }, { key: 'price', label: 'Nightly price (₹)', type: 'money', required: true }, { key: 'startDate', label: 'From', type: 'date', required: true }, { key: 'endDate', label: 'To', type: 'date', required: true }, { key: 'minStay', label: 'Minimum nights', type: 'number', nullable: true }]}
        columns={[{ label: 'Season', render: (r) => <span className="font-medium">{r.name}</span> }, { label: 'Rate', render: (r) => { const p = plans?.data.find((x) => x.id === r.ratePlanId); return p ? `${rtName(p.roomTypeId)} — ${p.name}` : ''; } }, { label: 'Dates', render: (r) => `${date(r.startDate, 'short')} – ${date(r.endDate)}` }, { label: 'Price', align: 'right', render: (r) => moneyCol(r.price) }, { label: 'Min nights', render: (r) => r.minStay ?? '—' }]} />}
      {tab === 'taxes' && <Resource<Tax> endpoint="/admin/taxes" noun="Tax"
        fields={[{ key: 'name', label: 'Name', required: true, hint: 'GST 12%' }, { key: 'appliesTo', label: 'Applies to', type: 'select', required: true, options: ['room', 'food', 'service', 'experience'].map((v) => ({ value: v, label: human(v) })) }, { key: 'rateBps', label: 'Rate (%)', type: 'percent_bps', required: true }, { key: 'inclusive', label: 'Included in price', type: 'bool', hint: 'Prices already include this tax' }, { key: 'minAmount', label: 'Applies from (₹/unit)', type: 'money', nullable: true, hint: 'For GST slabs by tariff' }, { key: 'maxAmount', label: 'Applies up to (₹/unit)', type: 'money', nullable: true }, { key: 'active', label: 'Active', type: 'bool', defaultValue: true }]}
        columns={[{ label: 'Tax', render: (r) => <span className="font-medium">{r.name}</span> }, { label: 'On', render: (r) => human(r.appliesTo) }, { label: 'Rate', align: 'right', render: (r) => `${r.rateBps / 100}%` }, { label: 'Tariff band', render: (r) => (r.minAmount || r.maxAmount ? `${r.minAmount ? moneyCol(r.minAmount) : '₹0'} – ${r.maxAmount ? moneyCol(r.maxAmount) : 'and above'}` : 'All') }, { label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') }]} />}
      {tab === 'addons' && props && <Resource<AddOn> endpoint="/admin/add-ons" noun="Add-on" extra={{ propertyId: props.data[0]?.id }}
        fields={[{ key: 'name', label: 'Name', required: true }, { key: 'price', label: 'Price (₹)', type: 'money', required: true }, { key: 'per', label: 'Charged per', type: 'select', defaultValue: 'stay', options: [{ value: 'stay', label: 'Stay' }, { value: 'night', label: 'Night' }, { value: 'guest', label: 'Guest' }, { value: 'guest_night', label: 'Guest per night' }] }, { key: 'active', label: 'Offered', type: 'bool', defaultValue: true }, { key: 'description', label: 'Description', type: 'textarea' }]}
        columns={[{ label: 'Add-on', render: (r) => <span className="font-medium">{r.name}</span> }, { label: 'Price', align: 'right', render: (r) => moneyCol(r.price) }, { label: 'Per', render: (r) => human(r.per) }, { label: 'Offered', render: (r) => (r.active ? 'Yes' : 'No') }]} />}
      {tab === 'coupons' && <Resource<Coupon> endpoint="/admin/coupons" noun="Promo code"
        fields={[{ key: 'code', label: 'Code', required: true }, { key: 'discountType', label: 'Type', type: 'select', required: true, options: [{ value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount (₹)' }] }, { key: 'value', label: 'Discount', type: 'number', required: true, typeFor: (v) => (v.discountType === 'fixed' ? 'money' : 'number'), hint: 'Percent, or rupees for fixed' }, { key: 'minNights', label: 'Minimum nights', type: 'number', defaultValue: 1 }, { key: 'validFrom', label: 'Valid from', type: 'date', nullable: true }, { key: 'validTo', label: 'Valid until', type: 'date', nullable: true }, { key: 'maxRedemptions', label: 'Max uses', type: 'number', nullable: true }, { key: 'active', label: 'Active', type: 'bool', defaultValue: true }, { key: 'description', label: 'Description', type: 'textarea' }]}
        columns={[{ label: 'Code', render: (r) => <span className="font-mono font-medium">{r.code}</span> }, { label: 'Discount', render: (r) => (r.discountType === 'percent' ? `${r.value}%` : moneyCol(r.value)) }, { label: 'Min nights', render: (r) => r.minNights }, { label: 'Used', align: 'right', render: (r) => `${r.redemptions}${r.maxRedemptions ? ` / ${r.maxRedemptions}` : ''}` }, { label: 'Valid', render: (r) => (r.validTo ? `until ${date(r.validTo)}` : 'Always') }, { label: 'Active', render: (r) => <Status value={r.active ? 'active' : 'disabled'} /> }]} />}
      {tab === 'promos' && <Resource<Promo> endpoint="/admin/promotions" noun="Offer"
        fields={[{ key: 'title', label: 'Title', required: true, wide: true }, { key: 'summary', label: 'Summary', type: 'textarea' }, { key: 'image', label: 'Image URL', type: 'image', wide: true, nullable: true }, { key: 'couponId', label: 'Linked promo code', type: 'select', nullable: true, options: (coupons?.data ?? []).map((c) => ({ value: c.id, label: c.code })) }, { key: 'startsAt', label: 'Starts', type: 'datetime', nullable: true }, { key: 'endsAt', label: 'Ends', type: 'datetime', nullable: true }, { key: 'showInPortal', label: 'Show in guest portal', type: 'bool', defaultValue: true }, { key: 'active', label: 'Published', type: 'bool', defaultValue: true }]}
        columns={[{ label: 'Offer', render: (r) => <><p className="font-medium">{r.title}</p><p className="max-w-md truncate text-xs text-muted">{r.summary}</p></> }, { label: 'Runs', render: (r) => (r.endsAt ? `until ${date(r.endsAt)}` : 'Ongoing') }, { label: 'Portal', render: (r) => (r.showInPortal ? 'Yes' : 'No') }, { label: 'Published', render: (r) => (r.active ? 'Yes' : 'No') }]} />}
    </>
  );
}
