import type { PageDoc, PageSection, ThemeTokens } from '../page-schema';

export const img = (id: string, w = 2000) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export type TemplateContent = {
  heroEyebrow: string;
  heroHeading: string;
  heroSub: string;
  heroImage: string;
  heroLayout?: 'full_bleed' | 'split' | 'minimal';
  intro: { eyebrow: string; heading: string; body: string; signature?: string };
  story: { eyebrow: string; heading: string; body: string; image: string };
  gallery: string[];
  amenities: { title: string; detail: string }[];
  roomsIntro: string;
  dining: { heading: string; intro: string; image: string };
  experiencesIntro: string;
  testimonials: { quote: string; author: string; detail: string }[];
  faq: { q: string; a: string }[];
  location: { heading: string; body: string; directions: { from: string; detail: string }[] };
  closing: { heading: string; body: string; image: string };
};

export type SiteTemplate = {
  key: string;
  name: string;
  description: string;
  suitedFor: string;
  previewImage: string;
  tokens: ThemeTokens;
  pages: { slug: string; title: string; seo: { title: string; description: string }; doc: PageDoc }[];
  navigation: { label: string; href: string }[];
};

let n = 0;
const sid = (type: string) => `${type.replace(/_/g, '')}${(n++).toString(36).padStart(4, '0')}`;
const s = (type: PageSection['type'], props: Record<string, unknown>): PageSection => ({ id: sid(type), type, props });

export function buildTemplate(meta: Omit<SiteTemplate, 'pages' | 'navigation' | 'previewImage'>, c: TemplateContent): SiteTemplate {
  n = 0;
  const alt = (what: string) => `${meta.name} — ${what}`;
  const home: PageDoc = {
    sections: [
      s('hero', { eyebrow: c.heroEyebrow, heading: c.heroHeading, subheading: c.heroSub, image: { url: c.heroImage, alt: alt('arrival') }, layout: c.heroLayout ?? 'full_bleed', overlay: 0.3, primaryCta: { label: 'Check availability', href: '/book' }, showBookingBar: true }),
      s('intro', { eyebrow: c.intro.eyebrow, heading: c.intro.heading, body: c.intro.body, signature: c.intro.signature, align: 'left', tone: 'default' }),
      s('rooms', { heading: 'Rooms & suites', intro: c.roomsIntro, layout: 'list', cta: { label: 'All rooms', href: '/rooms' } }),
      s('image_text', { eyebrow: c.story.eyebrow, heading: c.story.heading, body: c.story.body, image: { url: c.story.image, alt: alt('the setting') }, imageSide: 'left', tone: 'muted' }),
      s('restaurant', { heading: c.dining.heading, intro: c.dining.intro, showHours: true, image: { url: c.dining.image, alt: alt('dining') } }),
      s('experiences', { heading: 'Days here', intro: c.experiencesIntro, limit: 3 }),
      s('offers', { heading: 'Stay offers', limit: 3 }),
      s('testimonials', { heading: 'From our guests', items: c.testimonials }),
      s('cta', { heading: c.closing.heading, body: c.closing.body, primary: { label: 'Book your stay', href: '/book' }, secondary: { label: 'Contact us', href: '/contact' }, image: { url: c.closing.image, alt: alt('evening') }, tone: 'inverse' }),
    ],
  };
  const rooms: PageDoc = {
    sections: [
      s('hero', { heading: 'Rooms & suites', subheading: c.roomsIntro, layout: 'minimal', overlay: 0, showBookingBar: false }),
      s('booking_search', { heading: 'Find your dates', tone: 'muted' }),
      s('rooms', { heading: 'Choose your room', layout: 'list' }),
      s('amenities', { heading: 'In every room', items: c.amenities.slice(0, 6), columns: 3, tone: 'default' }),
      s('faq', { heading: 'Before you book', items: c.faq.slice(0, 4) }),
    ],
  };
  const dining: PageDoc = {
    sections: [
      s('hero', { heading: c.dining.heading, subheading: c.dining.intro, image: { url: c.dining.image, alt: alt('dining room') }, layout: 'split', overlay: 0, showBookingBar: false }),
      s('restaurant', { heading: 'Where to eat', showHours: true }),
      s('menu', { heading: 'The menu', showPrices: true, showDietary: true }),
      s('restaurant_reservation', { heading: 'Reserve a table', intro: 'Hotel guests and visitors are both welcome. Tell us about allergies or celebrations when you book.', tone: 'muted' }),
    ],
  };
  const experiences: PageDoc = {
    sections: [
      s('hero', { heading: 'Experiences', subheading: c.experiencesIntro, image: { url: c.story.image, alt: alt('surroundings') }, layout: 'full_bleed', overlay: 0.35, showBookingBar: false }),
      s('experiences', { heading: 'Book an experience', limit: 12 }),
      s('gallery', { heading: 'Around the property', images: c.gallery.map((url, i) => ({ url, alt: alt(`view ${i + 1}`) })), layout: 'mosaic' }),
      s('guest_services', { heading: 'Staying with us?', intro: 'Your guest portal has everything in one place — dining, requests, transfers and your bill.', cta: { label: 'Open your stay', href: '/stay' } }),
    ],
  };
  const contact: PageDoc = {
    sections: [
      s('hero', { heading: 'Getting here & contact', layout: 'minimal', overlay: 0, showBookingBar: false }),
      s('location', { heading: c.location.heading, body: c.location.body, directions: c.location.directions, showMap: true }),
      s('contact_form', { heading: 'Write to us', intro: 'We reply within a few hours, every day.', topics: ['Reservations', 'Dining', 'Events & weddings', 'General'] }),
      s('faq', { heading: 'Good to know', items: c.faq }),
    ],
  };
  return {
    ...meta,
    previewImage: c.heroImage.replace('w=2000', 'w=900'),
    navigation: [
      { label: 'Rooms', href: '/rooms' }, { label: 'Dining', href: '/dining' }, { label: 'Experiences', href: '/experiences' }, { label: 'Contact', href: '/contact' },
    ],
    pages: [
      { slug: 'home', title: 'Home', seo: { title: meta.name, description: c.heroSub.slice(0, 160) }, doc: home },
      { slug: 'rooms', title: 'Rooms', seo: { title: 'Rooms & suites', description: c.roomsIntro.slice(0, 160) }, doc: rooms },
      { slug: 'dining', title: 'Dining', seo: { title: c.dining.heading, description: c.dining.intro.slice(0, 160) }, doc: dining },
      { slug: 'experiences', title: 'Experiences', seo: { title: 'Experiences', description: c.experiencesIntro.slice(0, 160) }, doc: experiences },
      { slug: 'contact', title: 'Contact', seo: { title: 'Getting here', description: c.location.body.slice(0, 160) }, doc: contact },
    ],
  };
}
