import { AdminShell } from '@/components/admin-shell';

export const metadata = { title: 'Website editor' };
export default function Bare({ children }: { children: React.ReactNode }) {
  return <AdminShell bare>{children}</AdminShell>;
}
