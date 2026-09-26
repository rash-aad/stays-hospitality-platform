import { PlatformShell } from '@/components/platform-shell';

export const metadata = { title: 'bookEZ Console' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
