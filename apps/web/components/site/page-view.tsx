import type { PageDoc } from '@hp/contracts';
import { SiteFooter, SiteHeader } from './chrome';
import { PageBody } from './sections';
import type { SiteData } from './types';

export function PageView({ doc, data }: { doc: PageDoc; data: SiteData }) {
  const first = doc.sections.find((s) => !s.hidden);
  const overlay = first?.type === 'hero' && (first.props as { layout?: string }).layout !== 'minimal' && (first.props as { layout?: string }).layout !== 'split';
  return (
    <>
      <SiteHeader site={data.site} overlay={overlay} />
      <main className={overlay ? '' : 'pt-16'}><PageBody sections={doc.sections} d={data} /></main>
      <SiteFooter site={data.site} />
    </>
  );
}
