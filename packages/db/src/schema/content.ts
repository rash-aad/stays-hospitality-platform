import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, ts, updatedAt } from './_common.js';
import { tenants, users } from './core.js';
import { properties } from './property.js';

/** Stored page document (validated by @hp/contracts pageDocSchema). */
export type StoredPageDoc = { sections: Array<{ id: string; type: string; props: Record<string, unknown> }> };
export type PageSeo = { title?: string; description?: string; ogImage?: string; noindex?: boolean };

export const files = pgTable('files', {
  id: id(),
  tenantId: tenantId(),
  storageKey: text('storage_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  purpose: text('purpose', { enum: ['media', 'payment_proof', 'maintenance', 'other'] }).notNull(),
  uploadedByType: text('uploaded_by_type', { enum: ['user', 'guest'] }).notNull(),
  uploadedById: uuid('uploaded_by_id').notNull(),
  createdAt: createdAt(),
});

export const mediaAssets = pgTable('media_assets', {
  id: id(),
  tenantId: tenantId(),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  alt: text('alt').notNull().default(''),
  width: integer('width'),
  height: integer('height'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
});

export const themes = pgTable('themes', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  templateKey: text('template_key').notNull(),
  tokens: jsonb('tokens').$type<Record<string, string>>().notNull().default({}),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  updatedAt: updatedAt(),
});

export type NavLink = { label: string; href: string };
export const siteSettings = pgTable('site_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  navigation: jsonb('navigation').$type<NavLink[]>().notNull().default([]),
  navCta: jsonb('nav_cta').$type<NavLink | null>(),
  footer: jsonb('footer')
    .$type<{ columns: { title: string; links: NavLink[] }[]; note: string; social: NavLink[] }>()
    .notNull()
    .default({ columns: [], note: '', social: [] }),
  seoDefaults: jsonb('seo_defaults').$type<PageSeo>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const pages = pgTable(
  'pages',
  {
    id: id(),
    tenantId: tenantId(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    draftDoc: jsonb('draft_doc').$type<StoredPageDoc>().notNull(),
    draftSeo: jsonb('draft_seo').$type<PageSeo>().notNull().default({}),
    draftRevision: integer('draft_revision').notNull().default(1),
    publishedVersionId: uuid('published_version_id'),
    hasUnpublishedChanges: boolean('has_unpublished_changes').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('pages_tenant_slug_uq').on(t.tenantId, t.slug)],
);

export const pageVersions = pgTable(
  'page_versions',
  {
    id: id(),
    tenantId: tenantId(),
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    doc: jsonb('doc').$type<StoredPageDoc>().notNull(),
    seo: jsonb('seo').$type<PageSeo>().notNull().default({}),
    kind: text('kind', { enum: ['publish', 'snapshot', 'template', 'rollback'] }).notNull(),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('page_versions_uq').on(t.pageId, t.version)],
);

export const guidePages = pgTable(
  'guide_pages',
  {
    id: id(),
    tenantId: tenantId(),
    propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
    category: text('category', {
      enum: ['about', 'dining', 'facilities', 'wifi', 'house_rules', 'emergency', 'nearby', 'transport', 'contact', 'faq', 'custom'],
    }).notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    /** Restricted rich-text blocks: [{type:'p'|'h'|'list'|'kv', ...}] — never raw HTML. */
    body: jsonb('body').$type<Array<Record<string, unknown>>>().notNull().default([]),
    published: boolean('published').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('guide_pages_slug_uq').on(t.tenantId, t.slug)],
);

export const announcements = pgTable('announcements', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  published: boolean('published').notNull().default(true),
  createdAt: createdAt(),
});

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    channel: text('channel', { enum: ['email', 'sms', 'whatsapp', 'push'] }).notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('notification_templates_uq').on(t.tenantId, t.key, t.channel)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    channel: text('channel', { enum: ['email', 'sms', 'whatsapp', 'push', 'in_app'] }).notNull(),
    recipientType: text('recipient_type', { enum: ['guest', 'user'] }).notNull(),
    recipientId: uuid('recipient_id').notNull(),
    toAddress: text('to_address'),
    templateKey: text('template_key').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status', { enum: ['queued', 'sent', 'failed', 'skipped'] }).notNull().default('queued'),
    error: text('error'),
    relatedType: text('related_type'),
    relatedId: uuid('related_id'),
    readAt: ts('read_at'),
    sentAt: ts('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_recipient_idx').on(t.tenantId, t.recipientType, t.recipientId, t.createdAt)],
);

export const guestMessages = pgTable(
  'guest_messages',
  {
    id: id(),
    tenantId: tenantId(),
    guestId: uuid('guest_id').notNull(),
    stayId: uuid('stay_id'),
    senderType: text('sender_type', { enum: ['guest', 'staff'] }).notNull(),
    senderUserId: uuid('sender_user_id').references(() => users.id),
    body: text('body').notNull(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('guest_messages_thread_idx').on(t.tenantId, t.guestId, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorType: text('actor_type', { enum: ['user', 'guest', 'system', 'platform'] }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    ip: text('ip'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['channel_manager', 'pos', 'sms', 'whatsapp', 'analytics', 'webhook'] }).notNull(),
    provider: text('provider').notNull(),
    configEnc: text('config_enc'),
    publicConfig: jsonb('public_config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['active', 'disabled', 'error'] }).notNull().default('active'),
    lastSyncAt: ts('last_sync_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('integrations_uq').on(t.tenantId, t.kind, t.provider)],
);

/** Web-push subscriptions for installed PWAs (guest portal and staff app). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    tenantId: tenantId(),
    recipientType: text('recipient_type', { enum: ['guest', 'user'] }).notNull(),
    recipientId: uuid('recipient_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_recipient_idx').on(t.tenantId, t.recipientType, t.recipientId)],
);
