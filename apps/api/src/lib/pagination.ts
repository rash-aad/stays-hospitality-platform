import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(50).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;

export function pageMeta(q: PageQuery, total: number) {
  return { page: q.page, pageSize: q.pageSize, total, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}
export const offset = (q: PageQuery) => (q.page - 1) * q.pageSize;
