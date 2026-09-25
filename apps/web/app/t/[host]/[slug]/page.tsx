import type { PageDoc } from '@hp/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageView } from '@/components/site/page-view';
import { decodeHost, getSite, getSiteData, publicGet } from '@/lib/server';

type Props = { params: Promise<{ host: string; slug: string }> };
type Page = { data: { slug: string; title: string; doc: PageDoc; seo: { title?: string; description?: string; ogImage?: string; noindex?: boolean } } };

async function load(host: string, slug: string) {
  return publicGet<Page>(host, `/public/pages/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const page = await load(decodeHost(host), slug);
  if (!page) return {};
  const seo = page.data.seo;
  return {
    title: slug === 'home' ? { absolute: seo.title ?? page.data.title } : seo.title ?? page.data.title,
    description: seo.description, robots: seo.noindex ? { index: false } : undefined,
    openGraph: seo.ogImage ? { images: [seo.ogImage] } : undefined,
  };
}

export default async function SitePage({ params }: Props) {
  const { host: raw, slug } = await params;
  const host = decodeHost(raw);
  const [site, page] = await Promise.all([getSite(host), load(host, slug)]);
  if (!site || !page) notFound();
  return <PageView doc={page.data.doc} data={await getSiteData(host, site)} />;
}
