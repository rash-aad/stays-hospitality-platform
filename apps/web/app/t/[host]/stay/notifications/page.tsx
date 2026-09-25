'use client';

import { useEffect } from 'react';
import { dayTime, Title } from '@/components/stay/bits';
import { guestApi } from '@/lib/api';
import { useGuest } from '@/lib/hooks';
import { useStay } from '@/components/stay/shell';

export default function Notifications() {
  const { reload } = useStay();
  const { data } = useGuest<{ data: { id: string; subject: string | null; body: string; readAt: string | null; createdAt: string }[] }>('/portal/notifications');
  useEffect(() => { if (data) guestApi('/portal/notifications/read', { method: 'POST' }).then(reload); }, [data, reload]);
  return (
    <>
      <Title back="/stay">Updates</Title>
      {data?.data.length === 0 && <p className="t-muted">Nothing yet.</p>}
      {data?.data.map((n) => <div key={n.id} className="border-b t-line py-4"><p className={n.readAt ? '' : 'font-medium'}>{n.subject}</p><p className="mt-1 text-sm whitespace-pre-line t-muted">{n.body}</p><p className="mt-1 text-xs t-muted">{dayTime(n.createdAt)}</p></div>)}
    </>
  );
}
