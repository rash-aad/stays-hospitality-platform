import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts } from './_common.js';
import { tenants, users } from './core.js';
import { guests } from './guests.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    /** 'ok' once a second factor (TOTP, recovery code or enrolled device + PIN) was presented; 'pending' = enrolment required. */
    mfa: text('mfa', { enum: ['ok', 'pending'] }),
    /** Set for sessions opened with a PIN on an enrolled shared device. */
    deviceId: uuid('device_id'),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId), index('refresh_tokens_user_idx').on(t.userId)],
);

/** A shared tablet or phone (front desk, housekeeping) enrolled by a manager so staff can sign in with a PIN. */
export const staffDevices = pgTable(
  'staff_devices',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('staff_devices_tenant_idx').on(t.tenantId)],
);

/** One-time tokens: email verification, password reset, guest magic links. */
export const authTokens = pgTable('auth_tokens', {
  id: id(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['email_verify', 'password_reset', 'guest_access', 'staff_invite'] }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});
