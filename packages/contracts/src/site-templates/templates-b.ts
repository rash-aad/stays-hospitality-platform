import { buildTemplate, img } from './factory';

const faq = [
  { q: 'What time are check-in and check-out?', a: 'Check-in from 2 pm, check-out by 11 am. We’ll always try to accommodate early arrivals.' },
  { q: 'How do I pay?', a: 'Pay by UPI when you book, or at the property on arrival.' },
  { q: 'Is there mobile coverage?', a: 'Coverage is patchy in places, but Wi-Fi is available in all common areas and most rooms.' },
  { q: 'Are meals included?', a: 'It depends on your rate — each rate shows exactly what is included before you book.' },
];

export const jungle = buildTemplate(
  {
    key: 'jungle', name: 'Jungle Lodge', description: 'Earthy, textured and wild at the edges.', suitedFor: 'Wildlife lodges, eco-retreats, treehouses',
    tokens: { fontDisplay: 'Fraunces', fontBody: 'Work Sans', bg: '#F4F1EA', surface: '#E6E0D3', ink: '#22261E', muted: '#646456', line: '#D4CDBC', accent: '#8A5A2B', accentInk: '#FFFFFF', inverseBg: '#22261E', inverseInk: '#EDE8DC', radius: '2', headingCase: 'none', headingWeight: '600', imageTreatment: 'muted', density: 'balanced' },
  },
  {
    heroEyebrow: 'On the edge of the tiger reserve', heroHeading: 'Where the forest sets the schedule', heroSub: 'Twelve mud-and-thatch cottages on a hundred acres of rewilded farmland, with naturalists on staff.',
    heroImage: img('1448375240586-882707db888b'),
    intro: { eyebrow: 'The lodge', heading: 'Low impact, high comfort', body: 'Solar power, rainwater harvesting and a kitchen garden feed the lodge. The beds are very comfortable and the showers very hot.' },
    story: { eyebrow: 'The forest', heading: 'Two safaris a day, every day', body: 'Our naturalists grew up in the villages around the park. They know the tracks, the calls and the patience it takes.', image: img('1441974231531-c6227db76b6e') },
    gallery: [img('1448375240586-882707db888b', 1200), img('1441974231531-c6227db76b6e', 1200), img('1504674900247-0877df9cc836', 1200), img('1445019980597-93fa8acb246c', 1200)],
    amenities: [{ title: 'Naturalist-led safaris', detail: 'Jeep and walking' }, { title: 'Outdoor showers', detail: 'Screened by bamboo' }, { title: 'Solar power', detail: 'With quiet backup' }, { title: 'Binoculars & field guides', detail: 'In every cottage' }, { title: 'Farm-to-table food', detail: 'From our garden' }, { title: 'Stargazing deck', detail: 'Almost no light pollution' }],
    roomsIntro: 'Cottages built by local craftsmen from mud, stone and thatch — cool in summer, warm in winter.',
    dining: { heading: 'Dinner around the fire', intro: 'Tribal and regional recipes cooked on wood, eaten together under the mahua tree.', image: img('1504674900247-0877df9cc836') },
    experiencesIntro: 'Morning and evening safaris, village walks, bird counts and nights on the machan.',
    testimonials: [{ quote: 'We saw two tigers and a sloth bear, but the naturalists were the real stars.', author: 'D. Mehta', detail: 'Ahmedabad' }],
    faq,
    location: { heading: 'Getting to the reserve', body: 'The nearest airport is three hours away by road. We arrange transfers and can meet overnight trains.', directions: [{ from: 'Nearest airport', detail: '3 hours by road' }, { from: 'Railhead', detail: '1 hour 20 minutes' }] },
    closing: { heading: 'The forest opens in October', body: 'Safari permits are limited — book early for the winter season.', image: img('1441974231531-c6227db76b6e') },
  },
);

export const backwaters = buildTemplate(
  {
    key: 'backwaters', name: 'Lakeside', description: 'Still water, soft greens and slow mornings.', suitedFor: 'Lake resorts, backwater retreats, houseboats',
    tokens: { fontDisplay: 'Libre Caslon Text', fontBody: 'Figtree', bg: '#F5F7F4', surface: '#E5ECE6', ink: '#17302A', muted: '#577067', line: '#D1DDD5', accent: '#2F6D5A', accentInk: '#FFFFFF', inverseBg: '#17302A', inverseInk: '#E9F0EB', radius: '4', headingCase: 'none', headingWeight: '400', imageTreatment: 'natural', density: 'airy' },
  },
  {
    heroEyebrow: 'Kumarakom', heroHeading: 'Everything moves at the speed of the water', heroSub: 'Lake-view villas, a heritage houseboat and paddy fields as far as you can see.',
    heroImage: img('1602216056096-3b40cc0c9944'),
    intro: { eyebrow: 'Welcome', heading: 'Stay on the lake, not just beside it', body: 'Every villa has its own jetty. Take the canoe out before breakfast, or just watch the kingfishers from the hammock.' },
    story: { eyebrow: 'The kettuvallam', heading: 'A night on the houseboat', body: 'Our restored rice barge sleeps four, with its own cook and boatman. Drift through the canals, moor for the night by a village temple.', image: img('1593693397690-362cb9666fc2') },
    gallery: [img('1602216056096-3b40cc0c9944', 1200), img('1593693397690-362cb9666fc2', 1200), img('1501785888041-af3ef285b470', 1200), img('1544161515-4ab6ce6db874', 1200)],
    amenities: [{ title: 'Private jetty', detail: 'With canoe' }, { title: 'Plunge pool', detail: 'In lake villas' }, { title: 'Ayurveda', detail: 'Resident doctor' }, { title: 'Bicycles', detail: 'For the village roads' }, { title: 'Mosquito nets & screens', detail: 'Discreetly done' }, { title: 'Sunset cruise', detail: 'Every evening' }],
    roomsIntro: 'Lake villas, garden cottages and one very special houseboat.',
    dining: { heading: 'Karimeen, toddy shop and kappa', intro: 'Pearl spot fried in banana leaf, duck roast and appam — the backwaters on a plate.', image: img('1504674900247-0877df9cc836') },
    experiencesIntro: 'Canoe rides at dawn, village cycling, Ayurvedic treatments and a night on the kettuvallam.',
    testimonials: [{ quote: 'The most restful week of my life.', author: 'H. Kapoor', detail: 'Delhi' }],
    faq,
    location: { heading: 'On Vembanad lake', body: 'Ninety minutes from Kochi airport by road, or arrive by boat from Alleppey.', directions: [{ from: 'Kochi airport', detail: '1 h 30 min by car' }, { from: 'Kottayam station', detail: '25 minutes' }] },
    closing: { heading: 'Slow down for a while', body: 'Stay four nights and your houseboat evening is on us.', image: img('1501785888041-af3ef285b470') },
  },
);

export const desert = buildTemplate(
  {
    key: 'desert', name: 'Desert Camp', description: 'Sand, sky and firelight, in warm ochres.', suitedFor: 'Desert camps, glamping, luxury tents',
    tokens: { fontDisplay: 'Playfair Display', fontBody: 'Manrope', bg: '#FBF6EE', surface: '#F2E4CF', ink: '#2A1D12', muted: '#7A6048', line: '#E6D2B4', accent: '#B5652A', accentInk: '#FFFFFF', inverseBg: '#2A1D12', inverseInk: '#F7EBDA', radius: '0', headingCase: 'uppercase', headingWeight: '500', imageTreatment: 'warm', density: 'airy' },
  },
  {
    heroEyebrow: 'The Thar, 40 km from Jaisalmer', heroHeading: 'Nothing for miles but stars', heroSub: 'Twenty canvas suites among the dunes, with en-suite baths, a campfire and a sky full of the Milky Way.',
    heroImage: img('1509316785289-025f5b846b35'),
    intro: { eyebrow: 'The camp', heading: 'Canvas walls, solid comforts', body: 'King beds, hot showers and heating on winter nights — all under canvas, all a short walk from the dunes.' },
    story: { eyebrow: 'The desert', heading: 'Sunrise on the dunes', body: 'Ride out by camel or jeep before dawn and watch the sand turn from blue to gold. Breakfast is waiting at the top.', image: img('1512918728675-ed5a9ecdebfd') },
    gallery: [img('1509316785289-025f5b846b35', 1200), img('1512918728675-ed5a9ecdebfd', 1200), img('1504674900247-0877df9cc836', 1200)],
    amenities: [{ title: 'En-suite bathrooms', detail: 'With rain showers' }, { title: 'Winter heating', detail: 'November to February' }, { title: 'Campfire every night', detail: 'With folk musicians' }, { title: 'Telescope', detail: 'For guided stargazing' }, { title: 'Camel & jeep safaris', detail: 'Arranged by the desk' }, { title: 'Solar lighting', detail: 'Dark-sky friendly' }],
    roomsIntro: 'Swiss tents and royal tents with private sit-outs facing the dunes.',
    dining: { heading: 'Dinner in the dunes', intro: 'Rajasthani thalis by the fire, and a private dinner on the dunes for special nights.', image: img('1504674900247-0877df9cc836') },
    experiencesIntro: 'Camel safaris, dune bashing, village visits and nights spent looking up.',
    testimonials: [{ quote: 'Unreal. The stars, the silence, the dal baati.', author: 'Rhea', detail: 'Hyderabad' }],
    faq: [...faq, { q: 'When is the camp open?', a: 'From October to March. The desert is too hot in summer.' }],
    location: { heading: 'Into the Thar', body: 'Forty minutes from Jaisalmer fort, the last stretch on a sand track. We meet you in town.', directions: [{ from: 'Jaisalmer airport', detail: '50 minutes' }, { from: 'Jaisalmer station', detail: '45 minutes' }] },
    closing: { heading: 'See the Milky Way', body: 'The best skies are in the new-moon weeks — ask us for dates.', image: img('1512918728675-ed5a9ecdebfd') },
  },
);

export const wellness = buildTemplate(
  {
    key: 'wellness', name: 'Wellness Retreat', description: 'Calm, pale and restorative — the quietest template.', suitedFor: 'Spa resorts, yoga and Ayurveda retreats',
    tokens: { fontDisplay: 'Newsreader', fontBody: 'Figtree', bg: '#F8F7F4', surface: '#EEECE6', ink: '#262A27', muted: '#6C706B', line: '#DEDCD4', accent: '#6B7F6A', accentInk: '#FFFFFF', inverseBg: '#2E3530', inverseInk: '#EEF0EB', radius: '4', headingCase: 'none', headingWeight: '300', imageTreatment: 'muted', density: 'airy' },
  },
  {
    heroEyebrow: 'Rishikesh', heroHeading: 'Return to yourself', heroSub: 'A retreat on the Ganga with daily yoga, Ayurvedic consultations and food that makes you feel well.',
    heroImage: img('1544161515-4ab6ce6db874'),
    intro: { eyebrow: 'The retreat', heading: 'Programmes, not packages', body: 'Every stay begins with a consultation. Our doctors and teachers build a daily rhythm around you — treatments, practice, rest and food.' },
    story: { eyebrow: 'The practice', heading: 'Morning yoga above the river', body: 'The shala faces east over the Ganga. Classes are small, teachers are resident, and silence is encouraged before breakfast.', image: img('1600334129128-685c5582fd35') },
    gallery: [img('1544161515-4ab6ce6db874', 1200), img('1600334129128-685c5582fd35', 1200), img('1540541338287-41700207dee6', 1200)],
    amenities: [{ title: 'Daily yoga & meditation', detail: 'Two sessions a day' }, { title: 'Ayurvedic doctor', detail: 'Consultation on arrival' }, { title: 'Sattvic kitchen', detail: 'Tailored to your dosha' }, { title: 'Hydrotherapy', detail: 'Steam, sauna and pools' }, { title: 'Digital detox', detail: 'Optional device check-in' }, { title: 'River walks', detail: 'Guided at dawn' }],
    roomsIntro: 'Simple, serene rooms with river or garden views — nothing to distract you.',
    dining: { heading: 'Food as medicine', intro: 'A vegetarian kitchen guided by Ayurveda — seasonal, local, and surprisingly indulgent.', image: img('1476224203421-9ac39bcb3327') },
    experiencesIntro: 'Treatments, workshops and river rituals, scheduled around your programme.',
    testimonials: [{ quote: 'I left lighter in every sense.', author: 'A. Banerjee', detail: 'Kolkata' }],
    faq,
    location: { heading: 'On the Ganga', body: 'Forty minutes from Dehradun airport, above the town and away from its bustle.', directions: [{ from: 'Dehradun airport', detail: '40 minutes' }, { from: 'Haridwar station', detail: '50 minutes' }] },
    closing: { heading: 'Begin with seven days', body: 'Our Reset programme is the right first step for most guests.', image: img('1600334129128-685c5582fd35') },
  },
);

export const business = buildTemplate(
  {
    key: 'business', name: 'Business Hotel', description: 'Clear, efficient and quietly polished.', suitedFor: 'Business and airport hotels, serviced apartments',
    tokens: { fontDisplay: 'Instrument Sans', fontBody: 'Instrument Sans', bg: '#FFFFFF', surface: '#F3F4F6', ink: '#111827', muted: '#4B5563', line: '#E5E7EB', accent: '#1D4ED8', accentInk: '#FFFFFF', inverseBg: '#0F172A', inverseInk: '#F1F5F9', radius: '4', headingCase: 'none', headingWeight: '600', imageTreatment: 'natural', density: 'compact' },
  },
  {
    heroEyebrow: 'Whitefield, Bengaluru', heroHeading: 'Sleep well. Work well. Leave on time.', heroSub: '160 rooms, eight meeting rooms and a 24-hour kitchen, minutes from the tech parks.',
    heroImage: img('1571896349842-33c89424de2d'), heroLayout: 'split',
    intro: { eyebrow: 'The hotel', heading: 'Everything where you need it', body: 'Express check-in, a desk and ergonomic chair in every room, and an airport shuttle that leaves when your flight needs it to.' },
    story: { eyebrow: 'Meetings', heading: 'Rooms for 6 to 200', body: 'Day-light meeting rooms with fast Wi-Fi, video conferencing and a coordinator who handles everything from coffee to the projector.', image: img('1497366216548-37526070297c') },
    gallery: [img('1571896349842-33c89424de2d', 1200), img('1590490360182-c33d57733427', 1200), img('1497366216548-37526070297c', 1200)],
    amenities: [{ title: 'Express check-in', detail: 'On your phone' }, { title: 'Work desk', detail: 'With ergonomic chair' }, { title: '24-hour kitchen', detail: 'In-room dining' }, { title: 'Airport shuttle', detail: 'Scheduled and on-demand' }, { title: 'Gym', detail: 'Open 24 hours' }, { title: 'Laundry', detail: 'Same-day' }],
    roomsIntro: 'Superior rooms, executive rooms with lounge access, and studio apartments for longer stays.',
    dining: { heading: 'All-day dining', intro: 'An international buffet at breakfast, a quick business lunch and a relaxed dinner.', image: img('1517248135467-4c7edcad34c4') },
    experiencesIntro: 'City tours for the free afternoon, and a spa to undo the flight.',
    testimonials: [{ quote: 'Reliable, quiet, and the shuttle is never late.', author: 'V. Iyer', detail: 'Corporate guest' }],
    faq,
    location: { heading: 'Minutes from the tech corridor', body: 'Ten minutes to ITPL, forty-five to the airport.', directions: [{ from: 'Kempegowda airport', detail: '45–70 minutes' }, { from: 'Whitefield metro', detail: '4 minutes' }] },
    closing: { heading: 'Corporate rates available', body: 'Ask about negotiated rates for your company.', image: img('1571896349842-33c89424de2d') },
  },
);
