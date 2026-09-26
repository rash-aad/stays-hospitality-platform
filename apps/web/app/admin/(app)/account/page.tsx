'use client';

import { useMe } from '@/components/admin-context';
import { AccountSecurity } from '@/components/mfa';
import { PageHeader } from '@/components/ui';

export default function Account() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Your account" sub={`${me.user.name} · ${me.user.email}`} />
      <AccountSecurity />
    </>
  );
}
