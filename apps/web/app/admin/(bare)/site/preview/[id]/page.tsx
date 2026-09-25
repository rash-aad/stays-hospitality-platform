'use client';

import type { PageDoc } from '@hp/contracts';
import { useParams } from 'next/navigation';
import { useSiteData } from '@/components/builder/site-data';
import { PageView } from '@/components/site/page-view';
import { fontHref, themeVars } from '@/components/site/theme';
import { useStaff } from '@/lib/hooks';

/** Full-page preview of the unpublished draft, with the real site header and footer. */
export default function Preview() {
  const { id } = useParams<{ id: string }>();
  const data = useSiteData();
  const { data: page } = useStaff<{ data: { draftDoc: PageDoc; title: string } }>(`/admin/pages/${id}`);
  if (!data || !page) return <p className="p-10 text-[13px] text-muted">Loading preview…</p>;
  const href = fontHref(data.site.theme?.tokens);
  return (
    <div className="site min-h-dvh" style={themeVars(data.site.theme?.tokens)}>
      {href && <link rel="stylesheet" href={href} />}
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-sm bg-[#1b1a17] px-3 py-1.5 font-sans text-xs text-white">Draft preview — not yet live</div>
      <PageView doc={page.data.draftDoc} data={data} />
    </div>
  );
}
