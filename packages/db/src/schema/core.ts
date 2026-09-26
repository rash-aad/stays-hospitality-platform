import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const idCol = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: idCol(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  currency: text('currency').notNull().default('INR'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  locale: text('locale').notNull().default('en-IN'),
  contactEmail: text('contact_email'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
});

export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.moduleKey] })],
);

export const domains = pgTable(
  'domains',
  {
    id: idCol(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    kind: text('kind', { enum: ['subdomain', 'custom'] }).notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex('domains_hostname_uq').on(sql`lower(${t.hostname})`), index('domains_tenant_idx').on(t.tenantId)],
);

export const users = pgTable(
  'users',
  {
    id: idCol(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    status: text('status', { enum: ['active', 'invited', 'disabled'] }).notNull().default('active'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /** TOTP secret, encrypted with SECRETS_MASTER_KEY. Set during enrolment; active once mfaEnabledAt is set. */
    mfaSecret: text('mfa_secret'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    /** SHA-256 hashes of unused one-time recovery codes. */
    mfaRecoveryHashes: text('mfa_recovery_hashes').array().notNull().default(sql`'{}'::text[]`),
    /** Shift PIN for quick sign-in on an enrolled staff device (argon2 hash). */
    pinHash: text('pin_hash'),
    pinFailed: integer('pin_failed').notNull().default(0),
    pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, boolean>>().notNull().default({}),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex('users_tenant_email_uq').on(
      sql`coalesce(${t.tenantId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.email})`,
    ),
  ],
);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
});

export const roles = pgTable(
  'roles',
  {
    id: idCol(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex('roles_tenant_key_uq').on(t.tenantId, t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull().references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);
