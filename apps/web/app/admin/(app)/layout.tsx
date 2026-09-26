import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin-shell';

export const metadata: Metadata = { title: 'bookEZ Admin', manifest: '/admin.webmanifest' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
