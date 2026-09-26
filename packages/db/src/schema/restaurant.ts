import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, pgTable, smallint, text, time, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { users } from './core.js';
import { guests } from './guests.js';
import { bookings, stays } from './bookings.js';
import { properties, type ImageRef } from './property.js';

export type RestaurantSettings = {
  slotMinutes: number;
  defaultDurationMinutes: number;
  reservationWindowDays: number;
  minLeadMinutes: number;
  maxPartySize: number;
  maxCoversPerSlot: number | null;
  autoConfirm: boolean;
};

export const restaurants = pgTable(
  'restaurants',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: ['restaurant', 'cafe', 'bar', 'pool_bar', 'in_room_dining'] }).notNull().default('restaurant'),
    description: text('description'),
    cuisine: text('cuisine'),
    dietaryInfo: text('dietary_info'),
    location: text('location'),
    phone: text('phone'),
    email: text('email'),
    images: jsonb('images').$type<ImageRef[]>().notNull().default([]),
    acceptsReservations: boolean('accepts_reservations').notNull().default(true),
    acceptsOrders: boolean('accepts_orders').notNull().default(true),
    settings: jsonb('settings')
      .$type<RestaurantSettings>()
      .notNull()
      .default({
        slotMinutes: 30, defaultDurationMinutes: 90, reservationWindowDays: 60, minLeadMinutes: 60,
        maxPartySize: 10, maxCoversPerSlot: null, autoConfirm: true,
      }),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('restaurants_tenant_slug_uq').on(t.tenantId, t.slug)],
);

export const restaurantHours = pgTable(
  'restaurant_hours',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    service: text('service').notNull(),
    opens: time('opens').notNull(),
    closes: time('closes').notNull(),
  },
  (t) => [check('restaurant_hours_dow_ck', sql`${t.dayOfWeek} between 0 and 6`), index('restaurant_hours_r_idx').on(t.restaurantId)],
);

/** Special hours and blackout dates (closed = true). */
export const restaurantSpecialHours = pgTable('restaurant_special_hours', {
  id: id(),
  tenantId: tenantId(),
  restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  closed: boolean('closed').notNull().default(false),
  opens: time('opens'),
  closes: time('closes'),
  note: text('note'),
});

export const diningAreas = pgTable('dining_areas', {
  id: id(),
  tenantId: tenantId(),
  restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  sort: integer('sort').notNull().default(0),
});

export const restaurantTables = pgTable(
  'restaurant_tables',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    diningAreaId: uuid('dining_area_id').references(() => diningAreas.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    minCapacity: integer('min_capacity').notNull().default(1),
    capacity: integer('capacity').notNull(),
    status: text('status', { enum: ['available', 'occupied', 'out_of_service'] }).notNull().default('available'),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    uniqueIndex('restaurant_tables_label_uq').on(t.restaurantId, t.label),
    check('restaurant_tables_cap_ck', sql`${t.capacity} >= ${t.minCapacity} and ${t.minCapacity} >= 1`),
  ],
);

export const RESERVATION_STATUSES = ['waitlisted', 'requested', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'] as const;

/** Double-booking of a table is prevented by an exclusion constraint added in a custom migration. */
export const restaurantReservations = pgTable(
  'restaurant_reservations',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').references(() => guests.id),
    stayId: uuid('stay_id').references(() => stays.id),
    reference: text('reference').notNull(),
    guestName: text('guest_name').notNull(),
    guestEmail: text('guest_email'),
    guestPhone: text('guest_phone'),
    partySize: integer('party_size').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    tableId: uuid('table_id').references(() => restaurantTables.id, { onDelete: 'set null' }),
    areaPreferenceId: uuid('area_preference_id').references(() => diningAreas.id, { onDelete: 'set null' }),
    seatingPreference: text('seating_preference'),
    occasion: text('occasion'),
    status: text('status', { enum: RESERVATION_STATUSES }).notNull(),
    specialRequests: text('special_requests'),
    internalNotes: text('internal_notes'),
    source: text('source', { enum: ['website', 'portal', 'admin', 'phone', 'walk_in'] }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    reminderSentAt: ts('reminder_sent_at'),
    waitlistNotifiedAt: ts('waitlist_notified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('restaurant_reservations_ref_uq').on(t.tenantId, t.reference),
    index('restaurant_reservations_time_idx').on(t.restaurantId, t.startsAt),
    check('restaurant_reservations_time_ck', sql`${t.endsAt} > ${t.startsAt}`),
    check('restaurant_reservations_party_ck', sql`${t.partySize} >= 1`),
  ],
);

export const menus = pgTable('menus', {
  id: id(),
  tenantId: tenantId(),
  restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  availableFrom: time('available_from'),
  availableTo: time('available_to'),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const menuCategories = pgTable('menu_categories', {
  id: id(),
  tenantId: tenantId(),
  menuId: uuid('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  sort: integer('sort').notNull().default(0),
});

export const menuItems = pgTable(
  'menu_items',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => menuCategories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(),
    image: jsonb('image').$type<ImageRef | null>(),
    dietary: text('dietary').array().notNull().default(sql`'{}'::text[]`),
    allergens: text('allergens').array().notNull().default(sql`'{}'::text[]`),
    spiceLevel: smallint('spice_level'),
    prepMinutes: integer('prep_minutes').notNull().default(15),
    available: boolean('available').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('menu_items_category_idx').on(t.categoryId), check('menu_items_price_ck', sql`${t.price} >= 0`)],
);

/** Variants (pick one within group) and add-ons (pick many within group). */
export const menuItemVariants = pgTable('menu_item_variants', {
  id: id(),
  tenantId: tenantId(),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['variant', 'addon'] }).notNull(),
  groupName: text('group_name').notNull(),
  name: text('name').notNull(),
  priceDelta: integer('price_delta').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  maxSelect: integer('max_select'),
  available: boolean('available').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const orderTypes = pgTable(
  'order_types',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** room: deliver to the guest's verified room; area: pick from listed areas; table; pickup; custom text. */
    locationMode: text('location_mode', { enum: ['room', 'area', 'table', 'pickup', 'custom'] }).notNull(),
    areas: text('areas').array().notNull().default(sql`'{}'::text[]`),
    requiresStay: boolean('requires_stay').notNull().default(false),
    paymentModes: text('payment_modes').array().notNull().default(sql`'{room_charge}'::text[]`),
    allowScheduling: boolean('allow_scheduling').notNull().default(false),
    cancelWindowMinutes: integer('cancel_window_minutes').notNull().default(5),
    moduleKey: text('module_key').notNull().default('restaurant.ordering'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [uniqueIndex('order_types_key_uq').on(t.restaurantId, t.key)],
);

export const ORDER_STATUSES = ['pending_payment', 'new', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'] as const;

export const orders = pgTable(
  'orders',
  {
    id: id(),
    tenantId: tenantId(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id),
    orderTypeId: uuid('order_type_id').notNull().references(() => orderTypes.id),
    guestId: uuid('guest_id').references(() => guests.id),
    stayId: uuid('stay_id').references(() => stays.id),
    bookingId: uuid('booking_id').references(() => bookings.id),
    reference: text('reference').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    priority: text('priority', { enum: ['normal', 'high', 'rush'] }).notNull().default('normal'),
    locationKind: text('location_kind', { enum: ['room', 'area', 'table', 'pickup', 'custom'] }).notNull(),
    locationLabel: text('location_label').notNull(),
    roomId: uuid('room_id'),
    tableId: uuid('table_id'),
    scheduledFor: ts('scheduled_for'),
    specialInstructions: text('special_instructions'),
    kitchenNotes: text('kitchen_notes'),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    taxTotal: integer('tax_total').notNull(),
    total: integer('total').notNull(),
    paymentMode: text('payment_mode', { enum: ['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property'] }).notNull(),
    paymentStatus: text('payment_status', { enum: ['unpaid', 'awaiting_payment', 'pending_verification', 'paid', 'charged_to_room', 'refunded'] })
      .notNull(),
    estimatedReadyAt: ts('estimated_ready_at'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    cancelledReason: text('cancelled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_tenant_ref_uq').on(t.tenantId, t.reference),
    index('orders_queue_idx').on(t.restaurantId, t.status, t.createdAt),
    index('orders_guest_idx').on(t.guestId),
  ],
);

export type OrderItemOption = { id: string; group: string; name: string; priceDelta: number };

export const orderItems = pgTable('order_items', {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  options: jsonb('options').$type<OrderItemOption[]>().notNull().default([]),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
  lineTotal: integer('line_total').notNull(),
  notes: text('notes'),
});
