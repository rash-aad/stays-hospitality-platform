import { PlatformShell } from '@/components/platform-shell';

export const metadata = { title: 'Stays Platform' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
