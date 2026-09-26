'use client';

import { AccountSecurity } from '@/components/mfa';
import { PageHeader } from '@/components/ui';

export default function PlatformAccount() {
  return (
    <>
      <PageHeader title="Your account" sub="Two-step sign-in and where you’re signed in." />
      <AccountSecurity />
    </>
  );
}
