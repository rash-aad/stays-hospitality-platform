import { eventInquiries, properties } from '@hp/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { crud, isoDate } from '../../http/crud.js';
import { requireModule, resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { reference } from '../../lib/ids.js';

const body = z.object({
  propertyId: z.string().uuid(), reference: z.string().optional(), contactName: z.string().min(2).max(120), email: z.string().email(), phone: z.string().max(30).nullable().optional(),
  eventType: z.enum(['wedding', 'conference', 'birthday', 'corporate_offsite', 'other']), eventDate: isoDate.nullable().optional(), guestCount: z.number().int().min(1).max(5000).nullable().optional(),
  budget: z.number().int().min(0).nullable().optional(), message: z.string().max(3000).nullable().optional(), status: z.enum(['new', 'contacted', 'proposal_sent', 'won', 'lost']).default('new'),
  assignedUserId: z.string().uuid().nullable().optional(), notes: z.string().max(3000).nullable().optional(),
});

export const eventRoutes: Routes = async (app) => {
  crud(app, {
    path: '/admin/events', entity: 'event_inquiry', table: eventInquiries, permission: 'events.manage', tag: 'events', modules: ['events'], orderBy: eventInquiries.createdAt,
    body, validate: async (_tx, _t, b) => { if (!b.reference && b.contactName) b.reference = reference('EV'); },
  });

  /** Website enquiry form for weddings, conferences and celebrations. */
  app.post('/public/events/inquiry', {
    preHandler: [resolvePublicTenant, requireModule('events')],
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: { tags: ['events'], body: body.pick({ contactName: true, email: true, phone: true, eventType: true, eventDate: true, guestCount: true, message: true }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const r = await withTenant(t.id, async (tx) => {
      const [p] = await tx.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, t.id)).limit(1);
      const [row] = await tx.insert(eventInquiries).values({ ...req.body, tenantId: t.id, propertyId: p!.id, reference: reference('EV') }).returning();
      return row!;
    });
    return reply.status(201).send({ data: { reference: r.reference } });
  });
  void desc;
};
