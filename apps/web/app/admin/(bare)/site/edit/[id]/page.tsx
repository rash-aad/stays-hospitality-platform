'use client';

import { useParams } from 'next/navigation';
import { PageEditor } from '@/components/builder/editor';

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  return <PageEditor pageId={id} />;
}
