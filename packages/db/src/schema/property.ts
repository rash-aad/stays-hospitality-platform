import { sql } from 'drizzle-orm';
import {
  boolean, check, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, time, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';

export type ImageRef = { url: string; alt: string };

export const properties = pgTable(
  'properties',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    tagline: text('tagline'),
    description: text('description'),
    addressLine: text('address_line'),
    city: text('city'),
    region: text('region'),
    country: text('country').notNull().default('IN'),
    postalCode: text('postal_code'),
    phone: text('phone'),
    email: text('email'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    checkInTime: time('check_in_time').notNull().default('14:00'),
    checkOutTime: time('check_out_time').notNull().default('11:00'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    starRating: integer('star_rating'),
    images: jsonb('images').$type<ImageRef[]>().notNull().default([]),
    amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('properties_tenant_slug_uq').on(t.tenantId, t.slug)],
);

export const roomTypes = pgTable(
  'room_types',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    baseOccupancy: integer('base_occupancy').notNull().default(2),
    maxOccupancy: integer('max_occupancy').notNull().default(2),
    maxAdults: integer('max_adults').notNull().default(2),
    maxChildren: integer('max_children').notNull().default(0),
    bedConfig: text('bed_config'),
    sizeSqm: integer('size_sqm'),
    view: text('view'),
    amenities: text('amenities').array().notNull().default(sql`'{}'::text[]`),
    images: jsonb('images').$type<ImageRef[]>().notNull().default([]),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('room_types_property_slug_uq').on(t.propertyId, t.slug),
    check('room_types_occ_ck', sql`${t.maxOccupancy} >= ${t.baseOccupancy} and ${t.baseOccupancy} >= 1`),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id, { onDelete: 'restrict' }),
    number: text('number').notNull(),
    floor: text('floor'),
    status: text('status', { enum: ['active', 'out_of_service'] }).notNull().default('active'),
    housekeepingStatus: text('housekeeping_status', { enum: ['clean', 'dirty', 'inspected', 'out_of_service'] })
      .notNull()
      .default('clean'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('rooms_property_number_uq').on(t.propertyId, t.number), index('rooms_type_idx').on(t.roomTypeId)],
);

export type CancellationPolicy = { freeUntilHours: number; penaltyPercent: number; label: string };

export const ratePlans = pgTable(
  'rate_plans',
  {
    id: id(),
    tenantId: tenantId(),
    roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    mealPlan: text('meal_plan', { enum: ['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'] })
      .notNull()
      .default('room_only'),
    basePrice: integer('base_price').notNull(),
    extraAdultPrice: integer('extra_adult_price').notNull().default(0),
    extraChildPrice: integer('extra_child_price').notNull().default(0),
    weekendPrice: integer('weekend_price'),
    refundable: boolean('refundable').notNull().default(true),
    cancellationPolicy: jsonb('cancellation_policy')
      .$type<CancellationPolicy>()
      .notNull()
      .default({ freeUntilHours: 48, penaltyPercent: 100, label: 'Free cancellation until 48 hours before arrival' }),
    minStay: integer('min_stay').notNull().default(1),
    maxStay: integer('max_stay').notNull().default(30),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('rate_plans_type_code_uq').on(t.roomTypeId, t.code),
    check('rate_plans_price_ck', sql`${t.basePrice} >= 0`),
    check('rate_plans_stay_ck', sql`${t.minStay} >= 1 and ${t.maxStay} >= ${t.minStay}`),
  ],
);

/** Seasonal price overrides for a rate plan. Latest-starting matching season wins. */
export const rateSeasons = pgTable(
  'rate_seasons',
  {
    id: id(),
    tenantId: tenantId(),
    ratePlanId: uuid('rate_plan_id').notNull().references(() => ratePlans.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    price: integer('price').notNull(),
    minStay: integer('min_stay'),
  },
  (t) => [check('rate_seasons_range_ck', sql`${t.endDate} >= ${t.startDate}`), index('rate_seasons_plan_idx').on(t.ratePlanId)],
);

/** Nightly inventory ledger per room type. `booked` is mutated only inside row-locked transactions. */
export const availability = pgTable(
  'availability',
  {
    tenantId: tenantId(),
    roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    total: integer('total').notNull(),
    booked: integer('booked').notNull().default(0),
    closed: boolean('closed').notNull().default(false),
    closedToArrival: boolean('closed_to_arrival').notNull().default(false),
    minStay: integer('min_stay'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.roomTypeId, t.date] }),
    check('availability_booked_ck', sql`${t.booked} >= 0 and ${t.booked} <= ${t.total}`),
    index('availability_tenant_date_idx').on(t.tenantId, t.date),
  ],
);

export const taxes = pgTable('taxes', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  appliesTo: text('applies_to', { enum: ['room', 'food', 'service', 'experience'] }).notNull(),
  rateBps: integer('rate_bps').notNull(),
  /** Per-unit price band (minor units) the rate applies to, e.g. Indian hotel GST slabs by nightly tariff. */
  minAmount: integer('min_amount'),
  maxAmount: integer('max_amount'),
  inclusive: boolean('inclusive').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    description: text('description'),
    discountType: text('discount_type', { enum: ['percent', 'fixed'] }).notNull(),
    value: integer('value').notNull(),
    minNights: integer('min_nights').notNull().default(1),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    maxRedemptions: integer('max_redemptions'),
    redemptions: integer('redemptions').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('coupons_tenant_code_uq').on(t.tenantId, sql`upper(${t.code})`),
    check('coupons_redemptions_ck', sql`${t.maxRedemptions} is null or ${t.redemptions} <= ${t.maxRedemptions}`),
  ],
);

export const promotions = pgTable('promotions', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  summary: text('summary'),
  body: text('body'),
  image: jsonb('image').$type<ImageRef | null>(),
  couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  showInPortal: boolean('show_in_portal').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
});

export const addOns = pgTable('add_ons', {
  id: id(),
  tenantId: tenantId(),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull(),
  per: text('per', { enum: ['stay', 'night', 'guest', 'guest_night'] }).notNull().default('stay'),
  active: boolean('active').notNull().default(true),
});
