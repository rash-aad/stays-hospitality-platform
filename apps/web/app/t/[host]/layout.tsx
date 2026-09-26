import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { fontHref, themeVars } from '@/components/site/theme';
import { decodeHost, getSite, siteLive } from '@/lib/server';

type Props = { children: React.ReactNode; params: Promise<{ host: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await getSite(decodeHost((await params).host));
  if (!site) return {};
  const seo = site.settings?.seoDefaults ?? {};
  return {
    title: { default: seo.title ?? site.tenant.name, template: `%s — ${site.tenant.name}` },
    description: seo.description ?? site.property?.tagline ?? undefined,
    manifest: '/manifest.webmanifest',
    icons: site.theme?.faviconUrl ? [{ url: site.theme.faviconUrl }] : [{ url: '/icons/icon.svg' }],
    appleWebApp: { capable: true, title: site.tenant.name, statusBarStyle: 'default' },
    openGraph: { siteName: site.tenant.name, images: seo.ogImage ? [seo.ogImage] : site.property?.images[0] ? [site.property.images[0].url] : [] },
    alternates: site.primaryHost ? { canonical: `https://${site.primaryHost}` } : undefined,
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const site = await getSite(decodeHost((await params).host));
  return { themeColor: site?.theme?.tokens.bg ?? '#faf8f5' };
}

export default async function TenantLayout({ children, params }: Props) {
  const host = decodeHost((await params).host);
  const [site, live] = await Promise.all([getSite(host), siteLive(host)]);
  if (!site || !live) notFound();
  const tokens = site.theme?.tokens;
  const href = fontHref(tokens);
  return (
    <div className="site min-h-dvh" style={themeVars(tokens)}>
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      {children}
    </div>
  );
}
