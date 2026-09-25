import { buildTemplate, img } from './factory';

const commonFaq = [
  { q: 'What time are check-in and check-out?', a: 'Check-in is from 2 pm and check-out is until 11 am. Ask us about an early arrival or late departure — we say yes whenever the house allows.' },
  { q: 'Is breakfast included?', a: 'Breakfast is included on our Bed & Breakfast rates. On room-only rates you can add it at the table.' },
  { q: 'How do I pay?', a: 'Pay by UPI when you book, or at the property. You will receive a confirmation as soon as payment is verified.' },
  { q: 'Do you allow children and extra beds?', a: 'Children are very welcome. Extra beds are available in most rooms for a small nightly charge.' },
  { q: 'Is there parking?', a: 'Yes, secure parking is complimentary for staying guests.' },
];

export const beach = buildTemplate(
  {
    key: 'beach', name: 'Coastal', description: 'Sun-bleached sand, sea-glass blues and unhurried days by the water.', suitedFor: 'Beach resorts, surf stays, island villas',
    tokens: { fontDisplay: 'Fraunces', fontBody: 'Instrument Sans', bg: '#FBF8F3', surface: '#F2ECE2', ink: '#1C2A2E', muted: '#5F6B6C', line: '#E2D9CB', accent: '#1F6F78', accentInk: '#FFFFFF', inverseBg: '#16353A', inverseInk: '#F3EEE6', radius: '2', headingCase: 'none', headingWeight: '400', imageTreatment: 'warm', density: 'airy' },
  },
  {
    heroEyebrow: 'On the Malabar coast', heroHeading: 'Wake to the tide. Stay for the light.', heroSub: 'Thirty-two rooms set among coconut palms, a short walk through the dunes to a quiet beach.',
    heroImage: img('1507525428034-b723cf961d3e'),
    intro: { eyebrow: 'Welcome', heading: 'A house by the sea, run like a home', body: 'We opened our doors to a handful of friends in 2011. The rooms have multiplied since, but the rhythm hasn’t: slow breakfasts on the verandah, the afternoon swim, fish from the morning boats on the grill at sunset.', signature: 'The Menon family' },
    story: { eyebrow: 'The setting', heading: 'Between the backwater and the Arabian Sea', body: 'Our stretch of beach is shared with the fishing village next door. Walk south at dawn and you’ll see the boats come in; walk north and you won’t see anyone at all.', image: img('1519046904884-53103b34b206') },
    gallery: [img('1540541338287-41700207dee6', 1200), img('1582719478250-c89cae4dc85b', 1200), img('1414235077428-338989a2e8c0', 1200), img('1544161515-4ab6ce6db874', 1200), img('1520250497591-112f2f40a3f4', 1200)],
    amenities: [
      { title: 'Sea-facing verandahs', detail: 'Most rooms open straight onto the garden' }, { title: 'Outdoor rain showers', detail: 'In all garden villas' },
      { title: 'Fast Wi-Fi', detail: 'Fibre throughout, even on the beach deck' }, { title: 'Air-conditioning & ceiling fans', detail: 'Your choice, every night' },
      { title: 'Filtered water on tap', detail: 'No plastic bottles in the rooms' }, { title: 'Ayurvedic toiletries', detail: 'Made in Kerala' },
    ],
    roomsIntro: 'Garden rooms, pool villas and two beach cottages — each with its own verandah and the sound of the sea at night.',
    dining: { heading: 'Eat by the water', intro: 'Coastal Kerala cooking from the morning catch, served on the sand at dinner and under the tamarind tree at lunch.', image: img('1414235077428-338989a2e8c0') },
    experiencesIntro: 'Sunrise kayaking in the backwater, a cooking class with our chef, Ayurveda at the spa — or nothing at all.',
    testimonials: [
      { quote: 'The kind of place you plan the next trip to before you have left.', author: 'Ananya S.', detail: 'Bengaluru' },
      { quote: 'Our children still talk about the crab curry and the boat ride at dawn.', author: 'The Fernandes family', detail: 'Mumbai' },
    ],
    faq: commonFaq,
    location: { heading: 'Finding us', body: 'We are 40 minutes from Kochi airport and 15 minutes from the old town. We are happy to arrange your transfer.', directions: [{ from: 'Cochin International Airport', detail: '42 km · about 50 minutes by car' }, { from: 'Ernakulam Junction', detail: '28 km · about 40 minutes' }] },
    closing: { heading: 'The sea is waiting', body: 'Book direct for our best rate, a welcome drink on arrival and late check-out when we can.', image: img('1520250497591-112f2f40a3f4') },
  },
);

export const luxury = buildTemplate(
  {
    key: 'luxury', name: 'Grand Luxury', description: 'Quiet opulence — deep tones, fine serif type and generous space.', suitedFor: 'Five-star hotels, palaces, flagship resorts',
    tokens: { fontDisplay: 'Cormorant Garamond', fontBody: 'Inter Tight', bg: '#FAF8F5', surface: '#F1EDE6', ink: '#16130F', muted: '#6B645A', line: '#DDD5C8', accent: '#8A6A3B', accentInk: '#FFFFFF', inverseBg: '#16130F', inverseInk: '#EFE8DC', radius: '0', headingCase: 'none', headingWeight: '400', imageTreatment: 'natural', density: 'airy' },
  },
  {
    heroEyebrow: 'Since 1932', heroHeading: 'An address that needs no introduction', heroSub: 'Eighty-four rooms and suites, three restaurants and a spa, in the heart of the city.',
    heroImage: img('1542314831-068cd1dbfeeb'),
    intro: { eyebrow: 'The house', heading: 'Service remembered, not performed', body: 'Our butlers learn how you take your tea on the first morning. By the second, it is waiting for you. It is a small thing, and it is everything.', signature: 'General Manager' },
    story: { eyebrow: 'Heritage', heading: 'Ninety years on the same corner', body: 'The building has hosted maharajas, poets and two royal weddings. The marble has been polished by three generations of the same family of craftsmen.', image: img('1584132967334-10e028bd69f7') },
    gallery: [img('1578683010236-d716f9a3f461', 1200), img('1590490360182-c33d57733427', 1200), img('1517248135467-4c7edcad34c4', 1200), img('1600334129128-685c5582fd35', 1200), img('1566073771259-6a8506099945', 1200)],
    amenities: [
      { title: 'Butler service', detail: 'For every suite, around the clock' }, { title: 'Egyptian cotton', detail: 'Turned down each evening' },
      { title: 'Marble bathrooms', detail: 'With deep soaking tubs' }, { title: 'In-room dining', detail: 'The full menu, 24 hours' },
      { title: 'Chauffeur on request', detail: 'Airport and city' }, { title: 'Pressing & laundry', detail: 'Returned the same day' },
    ],
    roomsIntro: 'From our Heritage Rooms overlooking the courtyard to the Presidential Suite with its private terrace.',
    dining: { heading: 'Three restaurants, one kitchen brigade', intro: 'Modern Indian at Saffron, an all-day brasserie, and the Library Bar for a quiet martini.', image: img('1517248135467-4c7edcad34c4') },
    experiencesIntro: 'Private heritage walks, the spa’s signature ritual, and dinner on the rooftop under the stars.',
    testimonials: [{ quote: 'Impeccable, and never stiff. They made us feel like regulars on our first night.', author: 'R. Khanna', detail: 'London' }, { quote: 'The finest hotel breakfast in India. I will not be taking questions.', author: 'Food writer', detail: 'Delhi' }],
    faq: commonFaq,
    location: { heading: 'In the old quarter', body: 'Ten minutes from the business district, walking distance from the museum and the gardens.', directions: [{ from: 'International airport', detail: '35 minutes by hotel car' }, { from: 'Central station', detail: '8 minutes' }] },
    closing: { heading: 'Reserve your suite', body: 'Book direct for complimentary breakfast, airport transfer and our best available rate.', image: img('1566073771259-6a8506099945') },
  },
);

export const hill = buildTemplate(
  {
    key: 'hill_station', name: 'Hill Station', description: 'Mist, pine and woodsmoke — cosy, grounded and green.', suitedFor: 'Mountain lodges, tea estates, hill retreats',
    tokens: { fontDisplay: 'Newsreader', fontBody: 'Karla', bg: '#F6F5F0', surface: '#E9EAE1', ink: '#1E2A22', muted: '#5E6A60', line: '#D6D8CC', accent: '#3E6B4E', accentInk: '#FFFFFF', inverseBg: '#1E2A22', inverseInk: '#EEF0E6', radius: '2', headingCase: 'none', headingWeight: '500', imageTreatment: 'muted', density: 'balanced' },
  },
  {
    heroEyebrow: '2,100 metres above the sea', heroHeading: 'Above the clouds, below the deodars', heroSub: 'A stone lodge on a working tea estate, with fireplaces in every room and walks from the front door.',
    heroImage: img('1506905925346-21bda4d32df4'),
    intro: { eyebrow: 'The lodge', heading: 'Built for long evenings by the fire', body: 'The planter’s bungalow dates from 1896. We kept the teak floors and the view, and added proper heating, hot water that never runs out, and a library you could lose a week in.' },
    story: { eyebrow: 'The estate', heading: 'Eighty acres of tea and forest', body: 'Walk the estate with our manager at plucking time, taste the season’s first flush in the factory, and come back to hot chocolate on the lawn.', image: img('1464822759023-fed622ff2c3b') },
    gallery: [img('1448375240586-882707db888b', 1200), img('1441974231531-c6227db76b6e', 1200), img('1445019980597-93fa8acb246c', 1200), img('1506905925346-21bda4d32df4', 1200)],
    amenities: [
      { title: 'Wood-burning fireplaces', detail: 'Laid and lit for you each evening' }, { title: 'Heated bathroom floors', detail: 'Worth the drive alone' },
      { title: 'Hot water bottles', detail: 'Tucked in at turndown' }, { title: 'Walking gear', detail: 'Boots, sticks and rain jackets to borrow' },
      { title: 'Estate tea', detail: 'A tin in every room' }, { title: 'Board games & library', detail: 'In the drawing room' },
    ],
    roomsIntro: 'Eleven rooms in the bungalow and four cottages down the hill — all with fireplaces and valley views.',
    dining: { heading: 'Hearty food, estate-grown', intro: 'Hill-country cooking with vegetables from our garden, trout from the stream, and a proper roast on Sundays.', image: img('1504674900247-0877df9cc836') },
    experiencesIntro: 'Guided ridge walks, birding at dawn, tea tasting in the factory and bonfires under very clear skies.',
    testimonials: [{ quote: 'We came for the view and stayed for the fireplace and the scones.', author: 'Priya & Arjun', detail: 'Chennai' }, { quote: 'The quietest place I have slept in years.', author: 'M. D’Souza', detail: 'Goa' }],
    faq: [...commonFaq, { q: 'How cold does it get?', a: 'Nights drop to 4–8 °C from December to February. Rooms are heated and we lend warm layers.' }],
    location: { heading: 'The last few kilometres', body: 'The road climbs through tea gardens for the final hour. It’s narrow but paved; our drivers know it well.', directions: [{ from: 'Nearest airport', detail: '3 hours by road' }, { from: 'Hill railway station', detail: '25 minutes' }] },
    closing: { heading: 'Come up for air', body: 'Stay three nights, pay for two, through the monsoon months.', image: img('1441974231531-c6227db76b6e') },
  },
);

export const heritage = buildTemplate(
  {
    key: 'heritage', name: 'Heritage Palace', description: 'Rich jewel tones, carved detail and a sense of ceremony.', suitedFor: 'Havelis, forts, palace hotels',
    tokens: { fontDisplay: 'Marcellus', fontBody: 'Lora', bg: '#FAF6EF', surface: '#F1E7D6', ink: '#2B1A14', muted: '#71584A', line: '#E3D3BA', accent: '#9C3D25', accentInk: '#FFFFFF', inverseBg: '#3A1C14', inverseInk: '#F6E9D6', radius: '0', headingCase: 'uppercase', headingWeight: '400', imageTreatment: 'warm', density: 'balanced' },
  },
  {
    heroEyebrow: 'A 17th-century haveli', heroHeading: 'Live as the court once did', heroSub: 'Twenty-four rooms around three courtyards, restored by the family that has lived here for eleven generations.',
    heroImage: img('1477587458883-47145ed94245'),
    intro: { eyebrow: 'The family home', heading: 'Still lived in. Still loved.', body: 'The Thakur and his family live in the east wing. You will meet them at the evening aarti, and probably again over a very long dinner.', signature: 'Thakur Vikram Singh' },
    story: { eyebrow: 'Restoration', heading: 'Lime plaster, frescoes and patience', body: 'It took nine years and a hundred craftsmen to bring the painted ceilings back. Every room is different, and every room tells a story.', image: img('1548013146-72479768bada') },
    gallery: [img('1477587458883-47145ed94245', 1200), img('1548013146-72479768bada', 1200), img('1578683010236-d716f9a3f461', 1200), img('1517248135467-4c7edcad34c4', 1200)],
    amenities: [
      { title: 'Hand-painted interiors', detail: 'No two rooms alike' }, { title: 'Courtyard pool', detail: 'Lit by lanterns at night' },
      { title: 'Family recipes', detail: 'Cooked in the old kitchen' }, { title: 'Cultural evenings', detail: 'Folk music on the terrace' },
      { title: 'Vintage car rides', detail: 'Into the old city' }, { title: 'Air-conditioning', detail: 'Discreetly installed' },
    ],
    roomsIntro: 'Heritage rooms, royal suites and the Maharani’s chambers with their mirrored ceiling.',
    dining: { heading: 'The royal kitchen', intro: 'Laal maas, ker sangri and the family’s guarded recipes, served in the durbar hall or on the rooftop.', image: img('1504674900247-0877df9cc836') },
    experiencesIntro: 'Walks through the bazaar, block printing with local artisans, a sunset camel ride and dinner on the ramparts.',
    testimonials: [{ quote: 'We felt like guests of the family, not of a hotel.', author: 'Claire & Tom', detail: 'Edinburgh' }, { quote: 'The dinner on the rooftop was the best evening of our honeymoon.', author: 'Neha & Kabir', detail: 'Pune' }],
    faq: commonFaq,
    location: { heading: 'Inside the walled city', body: 'Cars stop at the old gate; our porters bring your luggage the last two hundred metres through the lanes.', directions: [{ from: 'Airport', detail: '45 minutes' }, { from: 'Railway station', detail: '20 minutes' }] },
    closing: { heading: 'Be a guest of the house', body: 'Book direct to join the family for dinner on your first night.', image: img('1548013146-72479768bada') },
  },
);

export const urban = buildTemplate(
  {
    key: 'urban_boutique', name: 'Urban Boutique', description: 'Sharp, confident and design-led for the city stay.', suitedFor: 'City boutique hotels, design hotels',
    tokens: { fontDisplay: 'DM Serif Display', fontBody: 'Inter Tight', bg: '#F7F7F5', surface: '#ECECE8', ink: '#111111', muted: '#5C5C58', line: '#D9D9D4', accent: '#C2410C', accentInk: '#FFFFFF', inverseBg: '#111111', inverseInk: '#F2F2EE', radius: '0', headingCase: 'none', headingWeight: '400', imageTreatment: 'natural', density: 'compact' },
  },
  {
    heroEyebrow: 'Bandra West', heroHeading: 'Forty rooms. One very good bar.', heroSub: 'A boutique hotel in a converted printworks, five minutes from the sea face and everything else.',
    heroImage: img('1455587734955-081b22074882'), heroLayout: 'split',
    intro: { eyebrow: 'The hotel', heading: 'Made for people who travel a lot', body: 'Beds you will want to take home, showers with real pressure, a desk you can actually work at, and a team that knows the city’s best tables.' },
    story: { eyebrow: 'The neighbourhood', heading: 'Street art, sea air and late dinners', body: 'Our concierge keeps a hand-drawn map of the neighbourhood’s best cafés, galleries and night spots — updated every month.', image: img('1449824913935-59a10b8d2000') },
    gallery: [img('1455587734955-081b22074882', 1200), img('1590490360182-c33d57733427', 1200), img('1517248135467-4c7edcad34c4', 1200), img('1618773928121-c32242e63f39', 1200)],
    amenities: [
      { title: 'Blackout everything', detail: 'Curtains, blinds, silence' }, { title: '1 Gbps Wi-Fi', detail: 'And a proper desk' },
      { title: 'Rooftop gym', detail: 'Open 24 hours' }, { title: 'Late check-out', detail: 'Until 2 pm when we can' },
      { title: 'Local coffee', detail: 'Pour-over kit in every room' }, { title: 'EV charging', detail: 'In the basement' },
    ],
    roomsIntro: 'Studios, corner rooms with two walls of windows, and a loft suite with a terrace over the lane.',
    dining: { heading: 'Printworks Kitchen & Bar', intro: 'Small plates, natural wine and a cocktail list built on Indian spirits — open till 1 am.', image: img('1517248135467-4c7edcad34c4') },
    experiencesIntro: 'Gallery walks, a street-food trail with a local chef, and sunset on the sea face.',
    testimonials: [{ quote: 'Finally, a business hotel that doesn’t feel like one.', author: 'S. Rao', detail: 'Frequent guest' }, { quote: 'The bar alone is worth the booking.', author: 'Travel + Leisure India', detail: '' }],
    faq: commonFaq,
    location: { heading: 'In the middle of it', body: 'Twenty-five minutes from the airport outside rush hour, five minutes’ walk from the promenade.', directions: [{ from: 'Mumbai airport (T2)', detail: '25–50 minutes depending on traffic' }, { from: 'Bandra station', detail: '7 minutes by car' }] },
    closing: { heading: 'In town next week?', body: 'Book direct for free breakfast and the best rate we offer anywhere.', image: img('1449824913935-59a10b8d2000') },
  },
);
