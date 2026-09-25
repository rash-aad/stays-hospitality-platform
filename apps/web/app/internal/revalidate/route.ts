import { revalidateTag } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

/** Called by the API after a publish (or by tooling after a reseed) so tenant sites update immediately. */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET ?? '';
  const given = req.headers.get('x-revalidate-secret') ?? '';
  const ok = secret.length > 0 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return new Response('Forbidden', { status: 403 });
  const { hosts } = (await req.json().catch(() => ({}))) as { hosts?: string[] };
  for (const h of hosts ?? []) revalidateTag(`site:${h.toLowerCase()}`, { expire: 0 });
  return Response.json({ revalidated: hosts?.length ?? 0 });
}
