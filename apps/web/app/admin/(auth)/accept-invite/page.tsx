import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function Page() {
  return <Suspense><SetPasswordForm endpoint="/api/v1/auth/invite/accept" title="Welcome — set your password" done="You’re all set. Taking you to sign in…" /></Suspense>;
}
