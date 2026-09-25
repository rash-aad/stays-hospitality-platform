import { files, mediaAssets } from '@hp/db';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { badRequest, forbidden, notFound, unauthorized } from '../../http/errors.js';
import { requireStaff, resolvePublicTenant, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'application/pdf': { ext: 'pdf', magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
};

export const fileRoutes: Routes = async (app, { config }) => {
  const root = resolve(config.UPLOAD_DIR);

  /**
   * Upload (staff or signed-in guest). Type is checked against magic bytes, not the client's claim;
   * files are stored outside the web root under a random name and served with nosniff.
   */
  app.post('/files', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['files'], querystring: z.object({ purpose: z.enum(['media', 'payment_proof', 'maintenance', 'other']).default('other') }) },
  }, async (req, reply) => {
    const a = req.actor;
    if (a.type !== 'staff' && a.type !== 'guest') throw unauthorized();
    if (req.query.purpose === 'media' && (a.type !== 'staff' || !a.permissions.has('content.manage'))) throw forbidden();
    const t = tenantOf(req);
    const part = await req.file();
    if (!part) throw badRequest('No file received');
    const buf = await part.toBuffer();
    if (part.file.truncated) throw badRequest('File is larger than 8 MB');
    const type = Object.entries(TYPES).find(([, v]) => v.magic(buf));
    if (!type) throw badRequest('Only JPEG, PNG, WebP images and PDF files are allowed');
    if (req.query.purpose === 'media' && type[0] === 'application/pdf') throw badRequest('Media must be an image');
    const key = `${t.id}/${randomUUID()}.${type[1].ext}`;
    await mkdir(join(root, t.id), { recursive: true });
    await writeFile(join(root, key), buf, { mode: 0o640 });
    const row = await withTenant(t.id, async (tx) => {
      const [f] = await tx.insert(files).values({
        tenantId: t.id, storageKey: key, originalName: part.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120), mime: type[0], size: buf.length,
        purpose: req.query.purpose, uploadedByType: a.type === 'staff' ? 'user' : 'guest', uploadedById: a.type === 'staff' ? a.userId : a.guestId,
      }).returning();
      if (req.query.purpose === 'media') {
        await tx.insert(mediaAssets).values({ tenantId: t.id, fileId: f!.id, url: `/api/v1/public/media/${f!.id}`, alt: '' });
      }
      return f!;
    });
    return reply.status(201).send({ data: { id: row.id, name: row.originalName, mime: row.mime, size: row.size, url: `/api/v1/files/${row.id}` } });
  });

  async function stream(reply: import('fastify').FastifyReply, f: typeof files.$inferSelect, cache: string) {
    const path = join(root, f.storageKey);
    if (!path.startsWith(root)) throw notFound('File');
    await stat(path).catch(() => { throw notFound('File'); });
    return reply
      .header('content-type', f.mime)
      .header('content-disposition', `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${f.originalName.replace(/"/g, '')}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', cache)
      .send(createReadStream(path));
  }

  /** Private files: staff of the tenant, or the guest who uploaded them. */
  app.get('/files/:id', { schema: { tags: ['files'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const a = req.actor;
    if (a.type !== 'staff' && a.type !== 'guest') throw unauthorized();
    const t = tenantOf(req);
    const [f] = await withTenant(t.id, (tx) => tx.select().from(files).where(and(eq(files.id, req.params.id), eq(files.tenantId, t.id))));
    if (!f) throw notFound('File');
    if (a.type === 'guest' && f.uploadedById !== a.guestId) throw notFound('File');
    return stream(reply, f, 'private, max-age=300');
  });

  /** Website media is public by nature. */
  app.get('/public/media/:id', { schema: { tags: ['files'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const { asSystem } = await import('../../infra/db.js');
    const [f] = await asSystem((tx) => tx.select().from(files).where(and(eq(files.id, req.params.id), eq(files.purpose, 'media'))));
    if (!f) throw notFound('File');
    return stream(reply, f, 'public, max-age=31536000, immutable');
  });

  // ----- Media library -----
  app.get('/admin/media', { preHandler: requireStaff('content.manage'), schema: { tags: ['files'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({ data: await tx.select().from(mediaAssets).where(eq(mediaAssets.tenantId, t.id)).orderBy(desc(mediaAssets.createdAt)).limit(500) }));
  });
  app.post('/admin/media', {
    preHandler: requireStaff('content.manage'),
    schema: { tags: ['files'], body: z.object({ url: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Use an https:// URL'), alt: z.string().max(200).default(''), tags: z.array(z.string().max(30)).max(10).default([]) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const [m] = await withTenant(t.id, (tx) => tx.insert(mediaAssets).values({ tenantId: t.id, ...req.body }).returning());
    return reply.status(201).send({ data: m });
  });
  app.patch('/admin/media/:id', { preHandler: requireStaff('content.manage'), schema: { tags: ['files'], params: z.object({ id: z.string().uuid() }), body: z.object({ alt: z.string().max(200).optional(), tags: z.array(z.string().max(30)).max(10).optional() }) } }, async (req) => {
    const t = tenantOf(req);
    const [m] = await withTenant(t.id, (tx) => tx.update(mediaAssets).set(req.body).where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.tenantId, t.id))).returning());
    if (!m) throw notFound('Media');
    return { data: m };
  });
  app.delete('/admin/media/:id', { preHandler: requireStaff('content.manage'), schema: { tags: ['files'], params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, (tx) => tx.delete(mediaAssets).where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.tenantId, t.id))));
    return reply.status(204).send();
  });

  void resolvePublicTenant;
};
