import type { SectionType } from '@hp/contracts';

const IMG = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=2000&q=80';

/** Starting content for a newly added section — always valid against the section schema. */
export const SECTION_DEFAULTS: Record<SectionType, Record<string, unknown>> = {
  hero: { heading: 'A place to slow down', subheading: 'Tell guests, in one sentence, why they’ll love staying with you.', image: { url: IMG, alt: '' }, layout: 'full_bleed', overlay: 0.3, showBookingBar: true },
  intro: { eyebrow: 'Welcome', heading: 'About the house', body: 'Write a few warm lines about your property, your team and what makes a stay here different.', align: 'left', tone: 'default' },
  rooms: { heading: 'Rooms & suites', intro: 'Every room, with its own character.', layout: 'list' },
  offers: { heading: 'Stay offers', limit: 3 },
  booking_search: { heading: 'Find your dates', tone: 'muted' },
  restaurant: { heading: 'Dining', intro: 'Where to eat and drink during your stay.', showHours: true },
  restaurant_reservation: { heading: 'Reserve a table', intro: 'Guests and visitors are welcome.', tone: 'muted' },
  menu: { heading: 'The menu', showPrices: true, showDietary: true },
  experiences: { heading: 'Experiences', intro: 'Ways to spend your days here.', limit: 6 },
  amenities: { heading: 'In every room', items: [{ title: 'Fast Wi-Fi', detail: 'Everywhere on the property' }, { title: 'Air-conditioning', detail: 'And ceiling fans' }, { title: 'Filtered water', detail: 'No plastic bottles' }], columns: 3, tone: 'default' },
  gallery: { heading: 'Around the property', images: [{ url: IMG, alt: '' }], layout: 'mosaic' },
  image_text: { heading: 'A story worth telling', body: 'Use this for your history, your chef, your garden — anything with a photograph to match.', image: { url: IMG, alt: '' }, imageSide: 'right', tone: 'default' },
  testimonials: { heading: 'From our guests', items: [{ quote: 'We didn’t want to leave.', author: 'A happy guest', detail: 'Mumbai' }] },
  faq: { heading: 'Good to know', items: [{ q: 'What time is check-in?', a: 'From 2 pm. Ask us about arriving earlier.' }] },
  location: { heading: 'Getting here', body: 'How to reach us, and how long it takes.', directions: [{ from: 'Nearest airport', detail: '45 minutes by car' }], showMap: true },
  cta: { heading: 'Ready when you are', body: 'Book direct for our best rate.', primary: { label: 'Book your stay', href: '/book' }, tone: 'inverse' },
  contact_form: { heading: 'Write to us', intro: 'We reply within a few hours.', topics: ['Reservations', 'Events', 'General'] },
  rich_text: { blocks: [{ type: 'h2', text: 'A heading' }, { type: 'p', text: 'Write anything here.' }], width: 'narrow' },
  guest_services: { heading: 'Staying with us?', intro: 'Everything for your stay in one place.', cta: { label: 'Open your stay', href: '/stay' } },
};

export const newSectionId = (type: string) => `${type.replace(/_/g, '').slice(0, 10)}${Math.random().toString(36).slice(2, 8)}`;
