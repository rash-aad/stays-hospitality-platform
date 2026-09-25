import { z } from 'zod';

/**
 * Website page documents. The page is structured data validated against this schema — never raw
 * HTML/JS. Every string is rendered as text; links and images are restricted to safe schemes.
 */
const text = (max: number) => z.string().max(max).transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
export const safeHref = z
  .string()
  .max(500)
  .refine((h) => /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(h.trim()), 'Links must start with https://, /, #, mailto: or tel:');
export const safeImage = z.string().max(1000).refine((u) => /^(https:\/\/|\/api\/v1\/public\/media\/)/.test(u), 'Images must be https:// or uploaded media');

export const image = z.object({ url: safeImage, alt: text(200).default('') });
export const cta = z.object({ label: text(40), href: safeHref });

const richBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: text(4000) }),
  z.object({ type: z.literal('h2'), text: text(200) }),
  z.object({ type: z.literal('h3'), text: text(200) }),
  z.object({ type: z.literal('quote'), text: text(1000), cite: text(120).optional() }),
  z.object({ type: z.literal('list'), items: z.array(text(500)).max(30) }),
]);

const align = z.enum(['left', 'center']).default('left');
const tone = z.enum(['default', 'muted', 'inverse', 'accent']).default('default');

export const SECTION_SCHEMAS = {
  hero: z.object({
    eyebrow: text(80).optional(), heading: text(160), subheading: text(400).optional(), image: image.optional(),
    layout: z.enum(['full_bleed', 'split', 'minimal']).default('full_bleed'), overlay: z.number().min(0).max(0.8).default(0.35),
    primaryCta: cta.optional(), secondaryCta: cta.optional(), showBookingBar: z.boolean().default(true),
  }),
  intro: z.object({ eyebrow: text(80).optional(), heading: text(200), body: text(2000), signature: text(120).optional(), align, tone }),
  rooms: z.object({ heading: text(160), intro: text(600).optional(), layout: z.enum(['list', 'grid']).default('list'), roomTypeIds: z.array(z.string().uuid()).max(20).optional(), cta: cta.optional() }),
  offers: z.object({ heading: text(160), intro: text(600).optional(), limit: z.number().int().min(1).max(12).default(3) }),
  booking_search: z.object({ heading: text(160).optional(), note: text(300).optional(), tone }),
  restaurant: z.object({ heading: text(160), intro: text(800).optional(), restaurantIds: z.array(z.string().uuid()).max(10).optional(), showHours: z.boolean().default(true), image: image.optional() }),
  restaurant_reservation: z.object({ heading: text(160), intro: text(600).optional(), restaurantId: z.string().uuid().optional(), tone }),
  menu: z.object({ heading: text(160), restaurantId: z.string().uuid().optional(), showPrices: z.boolean().default(true), showDietary: z.boolean().default(true) }),
  experiences: z.object({ heading: text(160), intro: text(600).optional(), kinds: z.array(z.enum(['activity', 'tour', 'spa', 'transfer', 'dining', 'class'])).optional(), limit: z.number().int().min(1).max(24).default(6) }),
  amenities: z.object({ heading: text(160), items: z.array(z.object({ title: text(80), detail: text(200).optional() })).max(24), columns: z.number().int().min(2).max(4).default(3), tone }),
  gallery: z.object({ heading: text(160).optional(), images: z.array(image).max(30), layout: z.enum(['mosaic', 'strip', 'grid']).default('mosaic') }),
  image_text: z.object({ eyebrow: text(80).optional(), heading: text(200), body: text(3000), image, imageSide: z.enum(['left', 'right']).default('right'), cta: cta.optional(), tone }),
  testimonials: z.object({ heading: text(160).optional(), items: z.array(z.object({ quote: text(600), author: text(80), detail: text(80).optional() })).max(12) }),
  faq: z.object({ heading: text(160), items: z.array(z.object({ q: text(200), a: text(2000) })).max(40) }),
  location: z.object({ heading: text(160), body: text(1500).optional(), address: text(300).optional(), directions: z.array(z.object({ from: text(80), detail: text(300) })).max(10).default([]), showMap: z.boolean().default(true) }),
  cta: z.object({ heading: text(200), body: text(600).optional(), primary: cta, secondary: cta.optional(), image: image.optional(), tone: z.enum(['default', 'muted', 'inverse', 'accent']).default('inverse') }),
  contact_form: z.object({ heading: text(160), intro: text(600).optional(), topics: z.array(text(60)).max(10).default(['General', 'Reservations', 'Events']) }),
  rich_text: z.object({ blocks: z.array(richBlock).max(100), width: z.enum(['narrow', 'wide']).default('narrow') }),
  guest_services: z.object({ heading: text(160), intro: text(600).optional(), cta: cta.optional() }),
} as const;

export type SectionType = keyof typeof SECTION_SCHEMAS;
export const SECTION_TYPES = Object.keys(SECTION_SCHEMAS) as SectionType[];

/** Modules a section depends on; the renderer hides it and the editor flags it when disabled. */
export const SECTION_MODULES: Partial<Record<SectionType, string[]>> = {
  rooms: ['room_booking'], booking_search: ['room_booking'], offers: ['offers'],
  restaurant: ['restaurant'], restaurant_reservation: ['restaurant.reservations'], menu: ['restaurant'],
  experiences: ['experiences'], guest_services: ['guest_portal'],
};

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: 'Hero', intro: 'Property introduction', rooms: 'Rooms', offers: 'Offers', booking_search: 'Booking search', restaurant: 'Restaurant',
  restaurant_reservation: 'Restaurant reservation', menu: 'Menu', experiences: 'Experiences', amenities: 'Amenities', gallery: 'Gallery',
  image_text: 'Image + text', testimonials: 'Testimonials', faq: 'FAQ', location: 'Location & map', cta: 'Call to action', contact_form: 'Contact form',
  rich_text: 'Rich text', guest_services: 'Guest services',
};

const sectionId = z.string().regex(/^[a-zA-Z0-9_-]{4,40}$/);
export const sectionSchema = z.discriminatedUnion(
  'type',
  SECTION_TYPES.map((type) => z.object({ id: sectionId, type: z.literal(type), hidden: z.boolean().optional(), props: SECTION_SCHEMAS[type] })) as unknown as [
    z.ZodObject<{ id: typeof sectionId; type: z.ZodLiteral<SectionType>; props: z.ZodTypeAny }>,
    ...z.ZodObject<{ id: typeof sectionId; type: z.ZodLiteral<SectionType>; props: z.ZodTypeAny }>[],
  ],
);

export const pageDocSchema = z.object({ sections: z.array(sectionSchema).max(60) }).superRefine((doc, ctx) => {
  const ids = new Set<string>();
  doc.sections.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sections', i, 'id'], message: 'Duplicate section id' });
    ids.add(s.id);
  });
});

export type PageSection = { id: string; type: SectionType; hidden?: boolean; props: Record<string, unknown> };
export type PageDoc = { sections: PageSection[] };

export const seoSchema = z.object({
  title: text(70).optional(), description: text(170).optional(), ogImage: safeImage.optional(), noindex: z.boolean().optional(),
});

export const themeTokensSchema = z.object({
  fontDisplay: z.string().max(60), fontBody: z.string().max(60),
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/), surface: z.string().regex(/^#[0-9a-fA-F]{6}$/), ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  muted: z.string().regex(/^#[0-9a-fA-F]{6}$/), line: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentInk: z.string().regex(/^#[0-9a-fA-F]{6}$/), inverseBg: z.string().regex(/^#[0-9a-fA-F]{6}$/), inverseInk: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  radius: z.enum(['0', '2', '4', '8']), headingCase: z.enum(['none', 'uppercase']), headingWeight: z.enum(['300', '400', '500', '600', '700']),
  imageTreatment: z.enum(['natural', 'warm', 'muted', 'mono']), density: z.enum(['airy', 'balanced', 'compact']),
});
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

/** Parse + normalise. Throws a ZodError with paths the editor can highlight. */
export function parsePageDoc(input: unknown): PageDoc {
  return pageDocSchema.parse(input) as PageDoc;
}
