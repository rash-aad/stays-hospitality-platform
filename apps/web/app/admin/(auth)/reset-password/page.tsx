import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function Page() {
  return <Suspense><SetPasswordForm endpoint="/api/v1/auth/password/reset" title="Choose a new password" done="Password updated. Taking you to sign in…" /></Suspense>;
}
