import type { ModuleKey } from '@hp/contracts';
import {
  entityEvents, folioCharges, guests, menuCategories, menuItems, menuItemVariants, menus, orderItems, orders, orderTypes,
  restaurants, restaurantTables, taxes, ORDER_STATUSES, type OrderItemOption,
} from '@hp/db';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, forbidden, moduleDisabled, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { reference } from '../../lib/ids.js';
import { formatMoney } from '../../lib/money.js';
import { taxAmount, taxFor } from '../bookings/pricing.js';
import { requireInHouse, type StayContext } from '../guests/access.js';
import { notify } from '../notifications/notify.js';
import { enabledMethods, getSettings, startPayment, type Instructions } from '../payments/service.js';
import { registerPaymentTarget } from '../payments/targets.js';

type Order = typeof orders.$inferSelect;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type CartLine = { menuItemId: string; quantity: number; optionIds?: string[]; notes?: string | null };

/** Menu as the guest sees it: active items with variant/add-on groups and live availability. */
export async function loadMenu(tx: Tx, tenantId: string, restaurantId: string) {
  const ms = await tx.select().from(menus).where(and(eq(menus.tenantId, tenantId), eq(menus.restaurantId, restaurantId), eq(menus.active, true))).orderBy(menus.sort);
  if (!ms.length) return [];
  const cats = await tx.select().from(menuCategories).where(inArray(menuCategories.menuId, ms.map((m) => m.id))).orderBy(menuCategories.sort);
  const items = cats.length ? await tx.select().from(menuItems).where(and(inArray(menuItems.categoryId, cats.map((c) => c.id)), eq(menuItems.active, true))).orderBy(menuItems.sort) : [];
  const opts = items.length ? await tx.select().from(menuItemVariants).where(inArray(menuItemVariants.menuItemId, items.map((i) => i.id))).orderBy(menuItemVariants.sort) : [];
  return ms.map((m) => ({
    ...m,
    categories: cats.filter((c) => c.menuId === m.id).map((c) => ({
      ...c,
      items: items.filter((i) => i.categoryId === c.id).map((i) => ({ ...i, options: opts.filter((o) => o.menuItemId === i.id) })),
    })),
  }));
}

function inWindow(now: Date, tz: string, from: string | null, to: string | null) {
  if (!from || !to) return true;
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return from <= to ? hhmm >= from.slice(0, 5) && hhmm < to.slice(0, 5) : hhmm >= from.slice(0, 5) || hhmm < to.slice(0, 5);
}

/** Price a cart server-side. Client prices are never trusted. */
export async function priceCart(tx: Tx, tenant: TenantInfo, restaurantId: string, lines: CartLine[], at = new Date()) {
  if (!lines.length) throw badRequest('Your order is empty');
  if (lines.length > 50) throw badRequest('Too many items');
  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const items = await tx
    .select({ item: menuItems, menuFrom: menus.availableFrom, menuTo: menus.availableTo, menuActive: menus.active })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .innerJoin(menus, eq(menus.id, menuCategories.menuId))
    .where(and(inArray(menuItems.id, ids), eq(menuItems.restaurantId, restaurantId), eq(menuItems.tenantId, tenant.id)));
  const opts = await tx.select().from(menuItemVariants).where(inArray(menuItemVariants.menuItemId, ids));
  const foodTaxes = await tx.select().from(taxes).where(and(eq(taxes.tenantId, tenant.id), eq(taxes.active, true), eq(taxes.appliesTo, 'food')));
  const priced = lines.map((l) => {
    const row = items.find((i) => i.item.id === l.menuItemId);
    if (!row || !row.item.active || !row.menuActive) throw badRequest('An item in your order is no longer on the menu');
    const it = row.item;
    if (!it.available) throw conflict(`${it.name} has just sold out`, { menuItemId: it.id });
    if (!inWindow(at, tenant.timezone, row.menuFrom, row.menuTo)) throw conflict(`${it.name} is not being served right now`, { menuItemId: it.id });
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 20) throw badRequest('Quantity must be between 1 and 20');
    const itemOpts = opts.filter((o) => o.menuItemId === it.id);
    const chosen = (l.optionIds ?? []).map((id) => {
      const o = itemOpts.find((x) => x.id === id);
      if (!o || !o.available) throw badRequest(`An option for ${it.name} is not available`);
      return o;
    });
    // Exactly one choice per variant group (default if omitted); add-on groups respect max_select.
    const variantGroups = [...new Set(itemOpts.filter((o) => o.kind === 'variant').map((o) => o.groupName))];
    for (const g of variantGroups) {
      const picked = chosen.filter((c) => c.kind === 'variant' && c.groupName === g);
      if (picked.length > 1) throw badRequest(`Choose one ${g.toLowerCase()} for ${it.name}`);
      if (!picked.length) {
        const def = itemOpts.find((o) => o.kind === 'variant' && o.groupName === g && o.isDefault && o.available) ?? itemOpts.find((o) => o.kind === 'variant' && o.groupName === g && o.available);
        if (!def) throw badRequest(`Choose a ${g.toLowerCase()} for ${it.name}`);
        chosen.push(def);
      }
    }
    for (const g of new Set(chosen.filter((c) => c.kind === 'addon').map((c) => c.groupName))) {
      const inGroup = chosen.filter((c) => c.kind === 'addon' && c.groupName === g);
      const max = inGroup[0]?.maxSelect;
      if (max && inGroup.length > max) throw badRequest(`Choose at most ${max} ${g.toLowerCase()} for ${it.name}`);
    }
    const unit = it.price + chosen.reduce((s, c) => s + c.priceDelta, 0);
    const options: OrderItemOption[] = chosen.map((c) => ({ id: c.id, group: c.groupName, name: c.name, priceDelta: c.priceDelta }));
    return { menuItemId: it.id, name: it.name, options, quantity: l.quantity, unitPrice: unit, lineTotal: unit * l.quantity, notes: l.notes?.slice(0, 200) ?? null, prepMinutes: it.prepMinutes };
  });
  const subtotal = priced.reduce((s, p) => s + p.lineTotal, 0);
  let tax = 0;
  let inclusive = 0;
  for (const t of taxFor(foodTaxes, 'food', subtotal)) {
    const a = taxAmount(subtotal, t.rateBps, t.inclusive);
    tax += a;
    if (t.inclusive) inclusive += a;
  }
  return { lines: priced, subtotal, taxTotal: tax, total: subtotal + tax - inclusive, prepMinutes: Math.max(...priced.map((p) => p.prepMinutes)) };
}

export async function placeOrder(
  tx: Tx,
  tenant: TenantInfo,
  ctx: StayContext,
  input: {
    restaurantId: string; orderTypeId: string; lines: CartLine[]; paymentMode: Order['paymentMode'];
    area?: string | null; tableId?: string | null; customLocation?: string | null; scheduledFor?: Date | null; specialInstructions?: string | null;
  },
): Promise<{ order: Order; instructions: Instructions | null }> {
  const [r] = await tx.select().from(restaurants).where(and(eq(restaurants.id, input.restaurantId), eq(restaurants.tenantId, tenant.id), eq(restaurants.active, true)));
  if (!r || !r.acceptsOrders) throw notFound('Restaurant');
  const [type] = await tx.select().from(orderTypes).where(and(eq(orderTypes.id, input.orderTypeId), eq(orderTypes.restaurantId, r.id), eq(orderTypes.active, true)));
  if (!type) throw notFound('Order type');
  if (!tenant.modules.has(type.moduleKey as ModuleKey)) throw moduleDisabled(type.moduleKey);
  if (!ctx.verified) throw forbidden('Please verify your email before ordering');

  // Delivery location is derived server-side; a room number is only ever taken from the verified stay.
  let locationLabel: string;
  let roomId: string | null = null;
  let tableId: string | null = null;
  const stay = type.requiresStay || type.locationMode === 'room' ? requireInHouse(ctx) : ctx.stay;
  switch (type.locationMode) {
    case 'room':
      roomId = (stay as ReturnType<typeof requireInHouse>).roomId;
      locationLabel = `Room ${stay!.roomNumber}`;
      break;
    case 'area':
      if (!input.area || !type.areas.includes(input.area)) throw badRequest('Choose where we should bring your order', { areas: type.areas });
      locationLabel = input.area;
      break;
    case 'table': {
      const [t] = input.tableId ? await tx.select().from(restaurantTables).where(and(eq(restaurantTables.id, input.tableId), eq(restaurantTables.restaurantId, r.id))) : [];
      if (!t) throw badRequest('Choose your table');
      tableId = t.id;
      locationLabel = `Table ${t.label}`;
      break;
    }
    case 'pickup':
      locationLabel = `Pickup — ${r.name}`;
      break;
    default:
      if (!input.customLocation?.trim()) throw badRequest('Tell us where to bring your order');
      locationLabel = input.customLocation.trim().slice(0, 120);
  }

  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    if (!type.allowScheduling) throw badRequest('Scheduling is not available for this order type');
    if (input.scheduledFor.getTime() < Date.now() + 15 * 60_000) throw badRequest('Schedule at least 15 minutes ahead');
    if (input.scheduledFor.getTime() > Date.now() + 7 * 86_400_000) throw badRequest('Orders can be scheduled up to 7 days ahead');
    scheduledFor = input.scheduledFor;
  }
  const cart = await priceCart(tx, tenant, r.id, input.lines, scheduledFor ?? new Date());

  const settings = await getSettings(tx, tenant.id);
  const allowed = enabledMethods(tenant, settings, 'order', { inHouse: !!ctx.stay?.inHouse }).filter((m) => type.paymentModes.includes(m));
  if (!allowed.includes(input.paymentMode)) throw badRequest('This payment option is not available for this order', { allowed });
  if (input.paymentMode === 'room_charge') requireInHouse(ctx);

  const online = input.paymentMode === 'upi_manual' || input.paymentMode === 'upi_gateway';
  const [{ n: queue }] = (await tx.select({ n: count() }).from(orders).where(and(eq(orders.restaurantId, r.id), inArray(orders.status, ['new', 'accepted', 'preparing'])))) as [{ n: number }];
  const eta = new Date((scheduledFor ?? new Date()).getTime() + (cart.prepMinutes + Math.min(queue, 10) * 2 + (type.locationMode === 'room' ? 10 : 5)) * 60_000);
  const [order] = await tx.insert(orders).values({
    tenantId: tenant.id, restaurantId: r.id, orderTypeId: type.id, guestId: ctx.guest.id, stayId: stay?.id ?? null, bookingId: stay?.bookingId ?? null,
    reference: reference('OR'), status: online ? 'pending_payment' : 'new', locationKind: type.locationMode, locationLabel, roomId, tableId, scheduledFor,
    specialInstructions: input.specialInstructions?.slice(0, 500), currency: tenant.currency, subtotal: cart.subtotal, taxTotal: cart.taxTotal, total: cart.total,
    paymentMode: input.paymentMode, paymentStatus: input.paymentMode === 'room_charge' ? 'charged_to_room' : online ? 'awaiting_payment' : 'unpaid', estimatedReadyAt: eta,
  }).returning();
  await tx.insert(orderItems).values(cart.lines.map((l) => ({ tenantId: tenant.id, orderId: order!.id, menuItemId: l.menuItemId, name: l.name, options: l.options, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, notes: l.notes })));
  await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'order', entityId: order!.id, kind: 'created', toValue: order!.status, actorType: 'guest', actorId: ctx.guest.id, visibility: 'guest' });
  if (input.paymentMode === 'room_charge') {
    await tx.insert(folioCharges).values({ tenantId: tenant.id, bookingId: stay!.bookingId, sourceType: 'order', sourceId: order!.id, description: `${r.name} — order ${order!.reference}`, amount: cart.subtotal, taxAmount: cart.taxTotal });
  }
  let instructions: Instructions | null = null;
  if (online) {
    instructions = (await startPayment(tx, { tenant, settings, method: input.paymentMode as 'upi_manual', targetType: 'order', targetId: order!.id, bookingId: stay?.bookingId ?? null, guestId: ctx.guest.id, amount: cart.total, description: `Order ${order!.reference}` })).instructions;
  }
  return { order: order!, instructions };
}

const FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['new', 'cancelled'],
  new: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'completed'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

const GUEST_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'awaiting payment', new: 'received', accepted: 'accepted by the kitchen', preparing: 'being prepared',
  ready: 'ready', delivered: 'delivered', completed: 'completed', cancelled: 'cancelled',
};

export async function transitionOrder(
  tx: Tx,
  tenant: TenantInfo,
  orderId: string,
  to: OrderStatus,
  actor: { type: 'user' | 'guest' | 'system'; id: string | null },
  note?: string,
) {
  const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenant.id))).for('update');
  if (!o || (actor.type === 'guest' && o.guestId !== actor.id)) throw notFound('Order');
  if (!FLOW[o.status].includes(to)) throw conflict(`An order that is ${GUEST_LABEL[o.status]} cannot be moved to ${to}`);
  if (actor.type === 'guest') {
    if (to !== 'cancelled') throw forbidden();
    const [type] = await tx.select().from(orderTypes).where(eq(orderTypes.id, o.orderTypeId));
    const withinWindow = Date.now() - o.createdAt.getTime() <= (type?.cancelWindowMinutes ?? 5) * 60_000;
    if (!['pending_payment', 'new'].includes(o.status) || !withinWindow) throw conflict('The kitchen has started on this order — please call us to change it');
  }
  const patch: Partial<Order> = { status: to };
  if (to === 'cancelled') {
    patch.cancelledReason = note ?? null;
    await tx.update(folioCharges).set({ voidedAt: new Date() }).where(and(eq(folioCharges.sourceType, 'order'), eq(folioCharges.sourceId, o.id), isNull(folioCharges.voidedAt)));
    if (o.paymentStatus === 'charged_to_room') patch.paymentStatus = 'unpaid';
  }
  const [u] = await tx.update(orders).set(patch).where(eq(orders.id, o.id)).returning();
  await tx.insert(entityEvents).values({ tenantId: tenant.id, entityType: 'order', entityId: o.id, kind: 'status', fromValue: o.status, toValue: to, body: note, actorType: actor.type, actorId: actor.id, visibility: 'guest' });
  if (o.guestId && ['accepted', 'ready', 'delivered', 'cancelled'].includes(to)) {
    await notify(tx, { tenantId: tenant.id, recipient: { type: 'guest', id: o.guestId }, templateKey: 'order.status', channels: ['in_app', 'push'], vars: { reference: o.reference, status: GUEST_LABEL[to] }, related: { type: 'order', id: o.id } });
  }
  return u!;
}

registerPaymentTarget('order', {
  async onCaptured(tx, p) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, p.targetId)).for('update');
    if (!o) return;
    await tx.update(orders).set({ paymentStatus: 'paid', status: o.status === 'pending_payment' ? 'new' : o.status }).where(eq(orders.id, o.id));
    if (o.status === 'pending_payment') {
      await tx.insert(entityEvents).values({ tenantId: o.tenantId, entityType: 'order', entityId: o.id, kind: 'status', fromValue: 'pending_payment', toValue: 'new', body: `Payment ${p.reference} received`, actorType: 'system', visibility: 'guest' });
    }
  },
  async onSubmitted(tx, p) {
    await tx.update(orders).set({ paymentStatus: 'pending_verification' }).where(eq(orders.id, p.targetId));
  },
  async onRejected(tx, p) {
    await tx.update(orders).set({ paymentStatus: 'awaiting_payment' }).where(eq(orders.id, p.targetId));
  },
  async onRefunded(tx, p) {
    await tx.update(orders).set({ paymentStatus: 'refunded' }).where(and(eq(orders.id, p.targetId), sql`${p.refundedAmount} >= ${p.amount}`));
  },
});

