import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { users } from './core.js';
import { guests } from './guests.js';
import { stays } from './bookings.js';
import { properties, rooms, type ImageRef } from './property.js';

export type RequestFormField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'datetime' | 'time' | 'select';
  required?: boolean;
  options?: string[];
};

/** Workflow = ordered statuses with allowed transitions. Terminal statuses end the SLA clock. */
export type RequestWorkflow = {
  statuses: { key: string; label: string; terminal?: boolean; guestLabel?: string }[];
  transitions: Record<string, string[]>;
};

export const serviceRequestTypes = pgTable(
  'service_request_types',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category', {
      enum: ['housekeeping', 'maintenance', 'concierge', 'room_service', 'front_desk', 'transport', 'spa', 'activities', 'dining'],
    }).notNull(),
    /** The tenant module that must be enabled for this request type to be usable. */
    moduleKey: text('module_key').notNull(),
    /** Optional downstream operational record created alongside the request. */
    routesTo: text('routes_to', { enum: ['none', 'housekeeping_task', 'maintenance_ticket'] }).notNull().default('none'),
    defaultPriority: text('default_priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
    slaMinutes: integer('sla_minutes').notNull().default(30),
    requiresStay: boolean('requires_stay').notNull().default(true),
    guestVisible: boolean('guest_visible').notNull().default(true),
    formSchema: jsonb('form_schema').$type<RequestFormField[]>().notNull().default([]),
    workflow: jsonb('workflow').$type<RequestWorkflow | null>(),
    defaultAssigneeRole: text('default_assignee_role'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('srt_tenant_key_uq').on(t.tenantId, t.key)],
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    typeId: uuid('type_id').notNull().references(() => serviceRequestTypes.id),
    guestId: uuid('guest_id').references(() => guests.id),
    stayId: uuid('stay_id').references(() => stays.id),
    roomId: uuid('room_id').references(() => rooms.id),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull(),
    status: text('status').notNull(),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    dueAt: ts('due_at'),
    customerNote: text('customer_note'),
    source: text('source', { enum: ['guest', 'staff'] }).notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('service_requests_ref_uq').on(t.tenantId, t.reference),
    index('service_requests_queue_idx').on(t.tenantId, t.status, t.dueAt),
    index('service_requests_stay_idx').on(t.stayId),
  ],
);

/** Append-only history for requests, orders, tickets, tasks and reservations. */
export const entityEvents = pgTable(
  'entity_events',
  {
    id: id(),
    tenantId: tenantId(),
    entityType: text('entity_type', {
      enum: ['service_request', 'order', 'maintenance_ticket', 'housekeeping_task', 'restaurant_reservation', 'booking', 'payment', 'experience_booking'],
    }).notNull(),
    entityId: uuid('entity_id').notNull(),
    kind: text('kind', { enum: ['created', 'status', 'assignment', 'note', 'priority', 'attachment', 'update'] }).notNull(),
    visibility: text('visibility', { enum: ['internal', 'guest'] }).notNull().default('internal'),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    body: text('body'),
    actorType: text('actor_type', { enum: ['user', 'guest', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('entity_events_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
);

export const housekeepingTasks = pgTable(
  'housekeeping_tasks',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    roomId: uuid('room_id').notNull().references(() => rooms.id),
    kind: text('kind', { enum: ['departure', 'stayover', 'deep_clean', 'turndown', 'guest_request', 'touch_up'] }).notNull(),
    status: text('status', { enum: ['pending', 'in_progress', 'done', 'inspected', 'failed_inspection', 'skipped'] })
      .notNull()
      .default('pending'),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
    scheduledFor: date('scheduled_for').notNull(),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    serviceRequestId: uuid('service_request_id').references(() => serviceRequests.id),
    notes: text('notes'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    inspectedByUserId: uuid('inspected_by_user_id').references(() => users.id),
    inspectedAt: ts('inspected_at'),
    inspectionNotes: text('inspection_notes'),
    createdAt: createdAt(),
  },
  (t) => [index('housekeeping_tasks_day_idx').on(t.tenantId, t.scheduledFor, t.status)],
);

export const lostAndFound = pgTable('lost_and_found', {
  id: id(),
  tenantId: tenantId(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomId: uuid('room_id').references(() => rooms.id),
  description: text('description').notNull(),
  locationFound: text('location_found'),
  foundAt: ts('found_at').notNull(),
  foundByUserId: uuid('found_by_user_id').references(() => users.id),
  status: text('status', { enum: ['stored', 'returned', 'claimed', 'disposed'] }).notNull().default('stored'),
  guestId: uuid('guest_id').references(() => guests.id),
  storageLocation: text('storage_location'),
  notes: text('notes'),
  resolvedAt: ts('resolved_at'),
  createdAt: createdAt(),
});

export const maintenanceTickets = pgTable(
  'maintenance_tickets',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    roomId: uuid('room_id').references(() => rooms.id),
    locationLabel: text('location_label').notNull(),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category', { enum: ['electrical', 'plumbing', 'hvac', 'furniture', 'appliance', 'structural', 'it', 'other'] }).notNull(),
    priority: text('priority', { enum: ['low', 'normal', 'high', 'urgent'] }).notNull().default('normal'),
    severity: text('severity', { enum: ['minor', 'major', 'critical'] }).notNull().default('minor'),
    status: text('status', { enum: ['open', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed'] }).notNull().default('open'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id),
    serviceRequestId: uuid('service_request_id').references(() => serviceRequests.id),
    reportedByType: text('reported_by_type', { enum: ['guest', 'staff'] }).notNull(),
    reportedById: uuid('reported_by_id'),
    blocksRoom: boolean('blocks_room').notNull().default(false),
    resolution: text('resolution'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('maintenance_ref_uq').on(t.tenantId, t.reference), index('maintenance_status_idx').on(t.tenantId, t.status)],
);

export const experiences = pgTable(
  'experiences',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    kind: text('kind', { enum: ['activity', 'tour', 'spa', 'transfer', 'dining', 'class'] }).notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    description: text('description'),
    images: jsonb('images').$type<ImageRef[]>().notNull().default([]),
    durationMinutes: integer('duration_minutes').notNull(),
    price: integer('price').notNull().default(0),
    pricePer: text('price_per', { enum: ['person', 'booking'] }).notNull().default('person'),
    maxParticipants: integer('max_participants').notNull().default(1),
    location: text('location'),
    requiresPayment: boolean('requires_payment').notNull().default(false),
    bookableByGuests: boolean('bookable_by_guests').notNull().default(true),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('experiences_slug_uq').on(t.tenantId, t.slug)],
);

export const experienceSlots = pgTable(
  'experience_slots',
  {
    id: id(),
    tenantId: tenantId(),
    experienceId: uuid('experience_id').notNull().references(() => experiences.id, { onDelete: 'cascade' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    capacity: integer('capacity').notNull(),
    booked: integer('booked').notNull().default(0),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  },
  (t) => [
    check('experience_slots_cap_ck', sql`${t.booked} >= 0 and ${t.booked} <= ${t.capacity}`),
    index('experience_slots_time_idx').on(t.experienceId, t.startsAt),
  ],
);

export const experienceBookings = pgTable(
  'experience_bookings',
  {
    id: id(),
    tenantId: tenantId(),
    experienceId: uuid('experience_id').notNull().references(() => experiences.id),
    slotId: uuid('slot_id').notNull().references(() => experienceSlots.id),
    guestId: uuid('guest_id').notNull().references(() => guests.id),
    stayId: uuid('stay_id').references(() => stays.id),
    reference: text('reference').notNull(),
    participants: integer('participants').notNull(),
    total: integer('total').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: ['pending_payment', 'confirmed', 'cancelled', 'completed', 'no_show'] }).notNull(),
    paymentMode: text('payment_mode', { enum: ['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property', 'free'] }).notNull(),
    paymentStatus: text('payment_status', { enum: ['unpaid', 'awaiting_payment', 'pending_verification', 'paid', 'charged_to_room', 'refunded', 'not_required'] }).notNull(),
    notes: text('notes'),
    reminderSentAt: ts('reminder_sent_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('experience_bookings_ref_uq').on(t.tenantId, t.reference), check('eb_participants_ck', sql`${t.participants} >= 1`)],
);

export const eventInquiries = pgTable('event_inquiries', {
  id: id(),
  tenantId: tenantId(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reference: text('reference').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  eventType: text('event_type', { enum: ['wedding', 'conference', 'birthday', 'corporate_offsite', 'other'] }).notNull(),
  eventDate: date('event_date'),
  guestCount: integer('guest_count'),
  budget: integer('budget'),
  message: text('message'),
  status: text('status', { enum: ['new', 'contacted', 'proposal_sent', 'won', 'lost'] }).notNull().default('new'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id),
  notes: text('notes'),
  createdAt: createdAt(),
});

/** Post-stay feedback. Ratings 1–5 per aspect plus a 0–10 likelihood to recommend. */
export const guestFeedback = pgTable(
  'guest_feedback',
  {
    id: id(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id').notNull(),
    guestId: uuid('guest_id').notNull().references(() => guests.id),
    overall: integer('overall').notNull(),
    recommend: integer('recommend'),
    aspects: jsonb('aspects').$type<Record<string, number>>().notNull().default({}),
    comment: text('comment'),
    publicConsent: boolean('public_consent').notNull().default(false),
    staffReply: text('staff_reply'),
    repliedByUserId: uuid('replied_by_user_id').references(() => users.id),
    repliedAt: ts('replied_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('guest_feedback_booking_uq').on(t.bookingId), check('guest_feedback_overall_ck', sql`${t.overall} between 1 and 5`), check('guest_feedback_nps_ck', sql`${t.recommend} is null or ${t.recommend} between 0 and 10`)],
);
