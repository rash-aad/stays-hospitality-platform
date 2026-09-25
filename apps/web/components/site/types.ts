import type { PageDoc, ThemeTokens } from '@hp/contracts';

export type SiteInfo = {
  tenant: { slug: string; name: string; currency: string; timezone: string; modules: string[] };
  theme: { templateKey: string; tokens: Partial<ThemeTokens>; logoUrl: string | null; faviconUrl: string | null } | null;
  settings: { navigation: { label: string; href: string }[]; navCta: { label: string; href: string } | null; footer: { columns: { title: string; links: { label: string; href: string }[] }[]; note: string; social: { label: string; href: string }[] }; seoDefaults: { title?: string; description?: string; ogImage?: string } } | null;
  pages: { slug: string; title: string }[];
  primaryHost: string | null;
  property: { name: string; tagline: string | null; phone: string | null; email: string | null; addressLine: string | null; city: string | null; region: string | null; country: string; postalCode: string | null; latitude: number | null; longitude: number | null; checkInTime: string; checkOutTime: string; starRating: number | null; images: { url: string; alt: string }[]; amenities: string[] } | null;
};
export type RoomTypeCard = { id: string; name: string; slug: string; description: string | null; images: { url: string; alt: string }[]; amenities: string[]; bedConfig: string | null; sizeSqm: number | null; view: string | null; maxOccupancy: number; fromPrice: number | null };
export type RestaurantCard = { id: string; name: string; slug: string; kind: string; description: string | null; cuisine: string | null; dietaryInfo: string | null; location: string | null; phone: string | null; images: { url: string; alt: string }[]; acceptsReservations: boolean; maxPartySize: number; hours: { dayOfWeek: number; service: string; opens: string; closes: string }[]; areas: { id: string; name: string }[] };
export type ExperienceCard = { id: string; kind: string; name: string; slug: string; summary: string | null; images: { url: string; alt: string }[]; durationMinutes: number; price: number; pricePer: string; location: string | null };
export type OfferCard = { id: string; title: string; summary: string | null; image: { url: string; alt: string } | null; endsAt: string | null };
export type MenuData = { id: string; name: string; categories: { id: string; name: string; items: { id: string; name: string; description: string | null; price: number; dietary: string[]; allergens: string[]; spiceLevel: number | null; available: boolean; image: { url: string; alt: string } | null }[] }[] }[];

export type SiteData = {
  site: SiteInfo;
  roomTypes: RoomTypeCard[];
  restaurants: RestaurantCard[];
  experiences: ExperienceCard[];
  offers: OfferCard[];
  menus: Record<string, MenuData>;
};
export type { PageDoc };
