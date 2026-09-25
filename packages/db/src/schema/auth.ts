import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts } from './_common.js';
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
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
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
