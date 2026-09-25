import { GuestShell } from '@/components/stay/shell';
import { decodeHost, getSite } from '@/lib/server';

export const metadata = { title: 'Your stay', robots: { index: false } };

export default async function StayLayout({ children, params }: { children: React.ReactNode; params: Promise<{ host: string }> }) {
  const site = await getSite(decodeHost((await params).host));
  return <GuestShell name={site?.tenant.name ?? ''}>{children}</GuestShell>;
}
