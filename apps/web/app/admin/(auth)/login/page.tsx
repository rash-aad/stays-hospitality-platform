import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export default function Login() {
  return <Suspense><LoginForm surface="admin" /></Suspense>;
}
