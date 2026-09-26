import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export default function PlatformLogin() {
  return <Suspense><LoginForm surface="platform" /></Suspense>;
}
