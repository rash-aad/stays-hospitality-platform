import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts } from './_common.js';

export const guests = pgTable(
  'guests',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    phone: text('phone'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    country: text('country'),
    passwordHash: text('password_hash'),
    emailVerifiedAt: ts('email_verified_at'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, boolean>>().notNull().default({}),
    /** Set when personal data was erased on request (DPDP); financial records keep the pseudonymised row. */
    anonymizedAt: ts('anonymized_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('guests_tenant_email_uq').on(t.tenantId, sql`lower(${t.email})`),
    index('guests_tenant_name_idx').on(t.tenantId, t.lastName),
  ],
);
