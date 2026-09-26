/**
 * Demo seed: two realistic tenants and a platform admin. Runs through the real domain services so
 * every record is consistent (inventory ledger, folios, invoices, events).
 *
 *   Platform admin      admin@bookez.in            Bookez!Admin2026
 *   Seabreeze (resort)  owner@seabreeze.example      Seabreeze!2026   → http://seabreeze.localhost:3000
 *   Printworks (city)   owner@printworks.example     Printworks!2026  → http://printworks.localhost:3000
 *   Every other staff account uses the password     Staff!2026
 */
import type { ModuleKey } from '@hp/contracts';
import * as s from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { hashPassword } from './domain/auth/service.js';
import { initTokens } from './domain/auth/tokens.js';
import { checkIn, checkOut, createBooking } from './domain/bookings/service.js';
import { applyTemplate, publishPage } from './domain/content/site-service.js';
import { createRequest } from './domain/requests/service.js';
import { resolveStayContext } from './domain/guests/access.js';
import { placeOrder, transitionOrder } from './domain/orders/service.js';
import { createReservation } from './domain/restaurant/reservations.js';
import { provisionTenant } from './domain/tenants/provision.js';
import { invalidateTenant, loadTenant } from './domain/tenants/tenant-cache.js';
import { asSystem, closeDb, initDb, type Tx } from './infra/db.js';
import { closeRedis, initRedis, redis } from './infra/redis.js';
import { addDays, todayIn, zonedTime } from './lib/dates.js';
import { encryptSecret } from './lib/crypto.js';
import { setRuntimeConfig } from './runtime.js';
import './domain/experiences/service.js';

const u = (id: string, w = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;
const cfg = loadConfig({ ...process.env, APP_DATABASE_URL: process.env.DATABASE_URL });
setRuntimeConfig(cfg);
initDb(process.env.DATABASE_URL!, 5);
initRedis(cfg.REDIS_URL);
initTokens(cfg.JWT_SECRET);
await redis().flushdb();

const staffPw = await hashPassword('Staff!2026');
const TODAY = todayIn('Asia/Kolkata');

async function staff(tx: Tx, tenantId: string, roleIds: Record<string, string>, people: [string, string, string][]) {
  const out: Record<string, string> = {};
  for (const [name, email, role] of people) {
    const [usr] = await tx.insert(s.users).values({ tenantId, name, email, passwordHash: staffPw, status: 'active', emailVerifiedAt: new Date() }).returning();
    await tx.insert(s.userRoles).values({ tenantId, userId: usr!.id, roleId: roleIds[role]! });
    out[role] = usr!.id;
  }
  return out;
}

const REQUEST_TYPES = (hk: boolean) => [
  ...(hk ? [
    { key: 'room_cleaning', name: 'Clean my room', category: 'housekeeping', moduleKey: 'housekeeping', routesTo: 'housekeeping_task', slaMinutes: 60, formSchema: [{ key: 'when', label: 'When suits you?', type: 'select', options: ['Now', 'In an hour', 'While we are at lunch', 'This evening'], required: true }] },
    { key: 'towels', name: 'Extra towels', category: 'housekeeping', moduleKey: 'housekeeping', routesTo: 'housekeeping_task', slaMinutes: 20, formSchema: [{ key: 'count', label: 'How many?', type: 'number' }] },
    { key: 'pillows', name: 'Extra pillows', category: 'housekeeping', moduleKey: 'housekeeping', routesTo: 'housekeeping_task', slaMinutes: 20, formSchema: [{ key: 'type', label: 'Type', type: 'select', options: ['Soft', 'Firm', 'Hypoallergenic'] }] },
    { key: 'water', name: 'Water & minibar top-up', category: 'housekeeping', moduleKey: 'housekeeping', routesTo: 'housekeeping_task', slaMinutes: 20, formSchema: [] },
    { key: 'laundry', name: 'Laundry pickup', category: 'housekeeping', moduleKey: 'housekeeping', slaMinutes: 45, formSchema: [{ key: 'service', label: 'Service', type: 'select', options: ['Wash & fold', 'Wash & press', 'Dry clean', 'Express (same day)'], required: true }] },
  ] : []),
  { key: 'maintenance', name: 'Something needs fixing', category: 'maintenance', moduleKey: 'maintenance', routesTo: 'maintenance_ticket', defaultPriority: 'high', slaMinutes: 30, formSchema: [{ key: 'category', label: 'What kind of problem?', type: 'select', options: ['hvac', 'electrical', 'plumbing', 'appliance', 'furniture', 'it', 'other'], required: true }] },
  { key: 'wake_up', name: 'Wake-up call', category: 'front_desk', moduleKey: 'concierge', slaMinutes: 5, formSchema: [{ key: 'time', label: 'Wake me at', type: 'datetime', required: true }] },
  { key: 'late_checkout', name: 'Late check-out', category: 'front_desk', moduleKey: 'concierge', slaMinutes: 120, formSchema: [{ key: 'until', label: 'Until', type: 'select', options: ['12:00', '13:00', '14:00', '16:00'], required: true }] },
  { key: 'early_checkin', name: 'Early check-in', category: 'front_desk', moduleKey: 'concierge', requiresStay: false, slaMinutes: 240, formSchema: [{ key: 'arrival', label: 'Expected arrival', type: 'datetime', required: true }] },
  { key: 'luggage', name: 'Luggage assistance', category: 'front_desk', moduleKey: 'concierge', slaMinutes: 10, formSchema: [] },
  { key: 'airport_transfer', name: 'Airport transfer', category: 'transport', moduleKey: 'transport', requiresStay: false, slaMinutes: 180, formSchema: [{ key: 'direction', label: 'Direction', type: 'select', options: ['Airport → hotel', 'Hotel → airport'], required: true }, { key: 'flight', label: 'Flight number', type: 'text', required: true }, { key: 'pickup', label: 'Pickup time', type: 'datetime', required: true }, { key: 'passengers', label: 'Passengers', type: 'number' }] },
  { key: 'concierge', name: 'Ask the concierge', category: 'concierge', moduleKey: 'concierge', requiresStay: false, slaMinutes: 60, formSchema: [] },
] as const;

// ================================================================== Seabreeze
async function seedSeabreeze() {
  const modules: ModuleKey[] = ['room_booking', 'payments', 'offers', 'restaurant', 'restaurant.reservations', 'restaurant.ordering', 'room_service', 'guest_portal', 'housekeeping', 'maintenance', 'concierge', 'experiences', 'spa', 'transport', 'events', 'notifications', 'website_builder', 'reports', 'integrations'];
  const ctx = await asSystem(async (tx) => {
    const { tenant, roleIds } = await provisionTenant(tx, {
      name: 'Seabreeze Cherai', slug: 'seabreeze', rootDomain: cfg.PLATFORM_ROOT_DOMAIN, modules, templateKey: 'beach', contactEmail: 'stay@seabreeze.example',
      owner: { name: 'Anjali Menon', email: 'owner@seabreeze.example', passwordHash: await hashPassword('Seabreeze!2026') },
    });
    const T = tenant.id;
    const people = await staff(tx, T, roleIds, [
      ['Joseph Varghese', 'frontdesk@seabreeze.example', 'front_desk'], ['Chef Suresh Nair', 'kitchen@seabreeze.example', 'kitchen'],
      ['Lakshmi Pillai', 'housekeeping@seabreeze.example', 'housekeeping'], ['Biju Thomas', 'maintenance@seabreeze.example', 'maintenance'],
      ['Rhea D’Cruz', 'concierge@seabreeze.example', 'concierge'], ['Arun Kumar', 'restaurant@seabreeze.example', 'restaurant_manager'],
      ['Meera Krishnan', 'gm@seabreeze.example', 'manager'],
    ]);
    const [prop] = await tx.insert(s.properties).values({
      tenantId: T, name: 'Seabreeze Cherai', slug: 'main', tagline: 'A beach house on the Malabar coast', description: 'Thirty-two rooms among coconut palms between the Cherai backwater and the Arabian Sea.',
      addressLine: 'Beach Road, Cherai', city: 'Kochi', region: 'Kerala', country: 'IN', postalCode: '683514', phone: '+91 484 248 1100', email: 'stay@seabreeze.example',
      timezone: 'Asia/Kolkata', checkInTime: '14:00', checkOutTime: '11:00', latitude: 10.1416, longitude: 76.1782, starRating: 4,
      images: [{ url: u('1507525428034-b723cf961d3e'), alt: 'Cherai beach at dawn' }, { url: u('1540541338287-41700207dee6'), alt: 'The pool among the palms' }],
      amenities: ['Beachfront', 'Outdoor pool', 'Ayurveda spa', 'Free Wi-Fi', 'Airport transfers', 'Kids welcome', 'Free parking'],
    }).returning();
    const P = prop!.id;
    const types = [
      { name: 'Garden Room', slug: 'garden-room', description: 'Ground-floor rooms opening onto the frangipani garden, with a verandah and daybed. A four-minute walk to the sand.', base: 2, max: 3, adults: 3, kids: 1, bed: 'King or twin', size: 32, view: 'Garden', rooms: 8, price: 650000, weekend: 750000, img: ['1582719478250-c89cae4dc85b', '1590490360182-c33d57733427'] },
      { name: 'Pool Villa', slug: 'pool-villa', description: 'A private villa with its own plunge pool, outdoor rain shower and a bedroom that opens entirely to the garden.', base: 2, max: 4, adults: 3, kids: 2, bed: 'King', size: 58, view: 'Private pool', rooms: 4, price: 1450000, weekend: 1650000, img: ['1540541338287-41700207dee6', '1578683010236-d716f9a3f461'] },
      { name: 'Beach Cottage', slug: 'beach-cottage', description: 'Two thatched cottages on the dune, the closest you can sleep to the sea. Wake to the fishing boats coming in.', base: 2, max: 3, adults: 2, kids: 1, bed: 'King', size: 45, view: 'Sea', rooms: 2, price: 1850000, weekend: 2100000, img: ['1520250497591-112f2f40a3f4', '1618773928121-c32242e63f39'] },
    ];
    const rt: Record<string, { id: string; plans: Record<string, string> }> = {};
    let roomNo = 101;
    for (const [i, x] of types.entries()) {
      const [r] = await tx.insert(s.roomTypes).values({ tenantId: T, propertyId: P, name: x.name, slug: x.slug, description: x.description, baseOccupancy: x.base, maxOccupancy: x.max, maxAdults: x.adults, maxChildren: x.kids, bedConfig: x.bed, sizeSqm: x.size, view: x.view, sort: i, amenities: ['Air-conditioning', 'Ceiling fan', 'Rain shower', 'Verandah', 'Tea & coffee', 'Safe', 'Wi-Fi'], images: x.img.map((id) => ({ url: u(id), alt: x.name })) }).returning();
      const plans: Record<string, string> = {};
      const [ro] = await tx.insert(s.ratePlans).values({ tenantId: T, roomTypeId: r!.id, name: 'Room only', code: 'RO', basePrice: x.price, weekendPrice: x.weekend, extraAdultPrice: 180000, extraChildPrice: 90000, cancellationPolicy: { freeUntilHours: 72, penaltyPercent: 100, label: 'Free cancellation until 3 days before arrival' } }).returning();
      const [bb] = await tx.insert(s.ratePlans).values({ tenantId: T, roomTypeId: r!.id, name: 'Bed & breakfast', code: 'BB', mealPlan: 'breakfast', basePrice: x.price + 90000, weekendPrice: x.weekend + 90000, extraAdultPrice: 250000, extraChildPrice: 120000, cancellationPolicy: { freeUntilHours: 72, penaltyPercent: 100, label: 'Free cancellation until 3 days before arrival' } }).returning();
      const [nr] = await tx.insert(s.ratePlans).values({ tenantId: T, roomTypeId: r!.id, name: 'Advance saver (non-refundable)', code: 'ADV', mealPlan: 'breakfast', basePrice: Math.round((x.price + 90000) * 0.85), refundable: false, minStay: 2, cancellationPolicy: { freeUntilHours: 0, penaltyPercent: 100, label: 'Non-refundable' } }).returning();
      plans.RO = ro!.id; plans.BB = bb!.id; plans.ADV = nr!.id;
      const year = new Date().getFullYear();
      for (const pid of [ro!.id, bb!.id]) {
        await tx.insert(s.rateSeasons).values({ tenantId: T, ratePlanId: pid, name: 'Christmas & New Year', startDate: `${year}-12-20`, endDate: `${year + 1}-01-05`, price: Math.round((pid === bb!.id ? x.price + 90000 : x.price) * 1.45), minStay: 3 });
        await tx.insert(s.rateSeasons).values({ tenantId: T, ratePlanId: pid, name: 'Monsoon', startDate: `${year + 1}-06-01`, endDate: `${year + 1}-08-31`, price: Math.round((pid === bb!.id ? x.price + 90000 : x.price) * 0.7) });
      }
      for (let k = 0; k < x.rooms; k++) {
        const num = String(roomNo++);
        await tx.insert(s.rooms).values({ tenantId: T, propertyId: P, roomTypeId: r!.id, number: num, floor: num[0] });
      }
      rt[x.slug] = { id: r!.id, plans };
    }
    await tx.insert(s.taxes).values([
      { tenantId: T, name: 'GST 12%', appliesTo: 'room', rateBps: 1200, maxAmount: 750000 },
      { tenantId: T, name: 'GST 18%', appliesTo: 'room', rateBps: 1800, minAmount: 750001 },
      { tenantId: T, name: 'GST 5%', appliesTo: 'food', rateBps: 500 },
      { tenantId: T, name: 'GST 18%', appliesTo: 'service', rateBps: 1800 },
      { tenantId: T, name: 'GST 18%', appliesTo: 'experience', rateBps: 1800 },
    ]);
    await tx.insert(s.addOns).values([
      { tenantId: T, propertyId: P, name: 'Airport pickup (Kochi)', description: 'Sedan, up to 3 guests with luggage', price: 250000, per: 'stay' },
      { tenantId: T, propertyId: P, name: 'Candlelit beach dinner', description: 'Four courses on the dune for two', price: 650000, per: 'stay' },
      { tenantId: T, propertyId: P, name: 'Ayurveda welcome massage', description: '60-minute abhyanga per guest', price: 280000, per: 'guest' },
    ]);
    const [c1] = await tx.insert(s.coupons).values({ tenantId: T, code: 'MONSOON25', description: '25% off monsoon stays of 3+ nights', discountType: 'percent', value: 25, minNights: 3 }).returning();
    await tx.insert(s.coupons).values({ tenantId: T, code: 'WELCOMEBACK', description: '₹2,000 off for returning guests', discountType: 'fixed', value: 200000, minNights: 2, maxRedemptions: 200 });
    await tx.insert(s.promotions).values([
      { tenantId: T, title: 'Monsoon on the coast', summary: 'Stay three nights or more between June and August and save 25%. Use code MONSOON25.', image: { url: u('1519046904884-53103b34b206'), alt: 'Monsoon sea' }, couponId: c1!.id, sort: 0 },
      { tenantId: T, title: 'Fourth night on us', summary: 'Book four nights on Bed & Breakfast and pay for three, all year round.', image: { url: u('1540541338287-41700207dee6'), alt: 'Pool' }, sort: 1 },
      { tenantId: T, title: 'Honeymoon at the beach cottage', summary: 'Beach cottage, candlelit dinner on the dune and a couples’ Ayurveda ritual.', image: { url: u('1520250497591-112f2f40a3f4'), alt: 'Beach cottage' }, sort: 2 },
    ]);
    await tx.update(s.paymentSettings).set({
      methodsEnabled: ['upi_manual', 'upi_gateway', 'room_charge', 'pay_at_property'], upiVpa: 'seabreezecherai@okhdfcbank', upiPayeeName: 'Seabreeze Cherai',
      gatewayProvider: 'mock', gatewayKeyId: 'rzp_test_seabreeze', gatewaySecretEnc: encryptSecret('mock_gateway_secret', cfg.SECRETS_MASTER_KEY), gatewayWebhookSecretEnc: encryptSecret('mock_webhook_secret', cfg.SECRETS_MASTER_KEY),
    }).where(eq(s.paymentSettings.tenantId, T));

    // ---- Dining
    const settings = { slotMinutes: 30, defaultDurationMinutes: 90, reservationWindowDays: 60, minLeadMinutes: 60, maxPartySize: 10, maxCoversPerSlot: 24, autoConfirm: true };
    const [tam] = await tx.insert(s.restaurants).values({ tenantId: T, propertyId: P, name: 'Tamarind', slug: 'tamarind', kind: 'restaurant', cuisine: 'Coastal Kerala', description: 'Our all-day restaurant under the old tamarind tree — appam and stew at breakfast, fish curry meals at lunch, and the grill at night.', dietaryInfo: 'Vegetarian, vegan and Jain options on every menu. Tell us about allergies when you order.', location: 'Garden pavilion', phone: '+91 484 248 1101', images: [{ url: u('1414235077428-338989a2e8c0'), alt: 'Tamarind dining' }], settings, sort: 0 }).returning();
    const [net] = await tx.insert(s.restaurants).values({ tenantId: T, propertyId: P, name: 'The Net', slug: 'the-net', kind: 'bar', cuisine: 'Beach grill & bar', description: 'Sunset drinks and the day’s catch grilled on coconut husk, on the sand.', location: 'On the beach', images: [{ url: u('1517248135467-4c7edcad34c4'), alt: 'The Net at night' }], acceptsOrders: false, settings: { ...settings, maxPartySize: 8 }, sort: 1 }).returning();
    for (let d = 0; d < 7; d++) {
      await tx.insert(s.restaurantHours).values([
        { tenantId: T, restaurantId: tam!.id, dayOfWeek: d, service: 'Breakfast', opens: '07:00', closes: '10:30' },
        { tenantId: T, restaurantId: tam!.id, dayOfWeek: d, service: 'Lunch', opens: '12:30', closes: '15:00' },
        { tenantId: T, restaurantId: tam!.id, dayOfWeek: d, service: 'Dinner', opens: '19:00', closes: '22:30' },
        { tenantId: T, restaurantId: net!.id, dayOfWeek: d, service: 'Sunset & dinner', opens: '17:30', closes: '23:00' },
      ]);
    }
    const [garden] = await tx.insert(s.diningAreas).values({ tenantId: T, restaurantId: tam!.id, name: 'Garden pavilion', sort: 0 }).returning();
    const [verandah] = await tx.insert(s.diningAreas).values({ tenantId: T, restaurantId: tam!.id, name: 'Verandah', sort: 1 }).returning();
    const [sand] = await tx.insert(s.diningAreas).values({ tenantId: T, restaurantId: net!.id, name: 'On the sand', sort: 0 }).returning();
    const tables: [string, string, number, number][] = [['G1', garden!.id, 1, 2], ['G2', garden!.id, 1, 2], ['G3', garden!.id, 2, 4], ['G4', garden!.id, 2, 4], ['G5', garden!.id, 4, 6], ['V1', verandah!.id, 1, 2], ['V2', verandah!.id, 2, 4], ['V3', verandah!.id, 4, 8]];
    for (const [i, [label, area, min, cap]] of tables.entries()) await tx.insert(s.restaurantTables).values({ tenantId: T, restaurantId: tam!.id, diningAreaId: area, label, minCapacity: min, capacity: cap, sort: i });
    for (const [i, label] of ['S1', 'S2', 'S3', 'S4'].entries()) await tx.insert(s.restaurantTables).values({ tenantId: T, restaurantId: net!.id, diningAreaId: sand!.id, label, minCapacity: 1, capacity: i < 2 ? 2 : 4, sort: i });

    const [menu] = await tx.insert(s.menus).values({ tenantId: T, restaurantId: tam!.id, name: 'All-day menu', description: 'Served 07:00 – 22:30; in-room dining around the clock.' }).returning();
    const cats: Record<string, string> = {};
    for (const [i, name] of ['Breakfast', 'Small plates', 'From the sea', 'From the garden', 'Rice & breads', 'Desserts', 'Drinks'].entries()) {
      const [c] = await tx.insert(s.menuCategories).values({ tenantId: T, menuId: menu!.id, name, sort: i }).returning();
      cats[name] = c!.id;
    }
    const items: { cat: string; name: string; desc: string; price: number; diet: string[]; allergens?: string[]; spice?: number; prep?: number; img?: string; variants?: [string, string, number, boolean?][]; addons?: [string, string, number][] }[] = [
      { cat: 'Breakfast', name: 'Appam with vegetable stew', desc: 'Lacy rice hoppers, coconut-milk stew with carrot, beans and potato.', price: 42000, diet: ['veg', 'vegan'], prep: 15, addons: [['Extras', 'Extra appam', 6000], ['Extras', 'Egg roast', 12000]] },
      { cat: 'Breakfast', name: 'Puttu and kadala curry', desc: 'Steamed rice and coconut cylinders with black chickpea curry.', price: 38000, diet: ['veg', 'vegan'], spice: 2, prep: 15 },
      { cat: 'Breakfast', name: 'Masala omelette & toast', desc: 'Three eggs, onion, green chilli and coriander, sourdough toast.', price: 36000, diet: ['egg'], allergens: ['eggs', 'gluten'], prep: 10, variants: [['Eggs', 'Whole eggs', 0, true], ['Eggs', 'Egg whites', 5000]] },
      { cat: 'Small plates', name: 'Kallumakkaya fry', desc: 'Crisp-fried Malabar mussels with shallots and curry leaf.', price: 58000, diet: ['non_veg'], allergens: ['molluscs'], spice: 2, prep: 18 },
      { cat: 'Small plates', name: 'Banana flower cutlets', desc: 'With tamarind and date chutney.', price: 38000, diet: ['veg'], allergens: ['gluten'], prep: 15 },
      { cat: 'From the sea', name: 'Meen pollichathu', desc: 'Pearl spot marinated in red masala, wrapped in banana leaf and roasted.', price: 98000, diet: ['non_veg'], allergens: ['fish'], spice: 2, prep: 25, img: '1504674900247-0877df9cc836' },
      { cat: 'From the sea', name: 'Alleppey prawn curry', desc: 'Tiger prawns in raw-mango and coconut curry.', price: 110000, diet: ['non_veg'], allergens: ['crustaceans'], spice: 1, prep: 22, variants: [['Portion', 'Regular', 0, true], ['Portion', 'Large (to share)', 50000]], addons: [['Sides', 'Kerala matta rice', 12000], ['Sides', 'Two appams', 10000], ['Sides', 'Malabar parotta', 9000]] },
      { cat: 'From the sea', name: 'Catch of the day, grilled', desc: 'Ask your server what came in on this morning’s boats. Priced by the portion.', price: 125000, diet: ['non_veg'], allergens: ['fish'], prep: 25 },
      { cat: 'From the garden', name: 'Avial', desc: 'Seven vegetables in coconut and curd, finished with coconut oil and curry leaf.', price: 48000, diet: ['veg', 'gluten_free'], allergens: ['milk'], prep: 15 },
      { cat: 'From the garden', name: 'Kerala sadya (lunch)', desc: 'The festive vegetarian meal on a banana leaf — fourteen dishes, rice and payasam.', price: 90000, diet: ['veg', 'gluten_free'], allergens: ['milk'], prep: 20 },
      { cat: 'Rice & breads', name: 'Kerala matta rice', desc: 'Red parboiled rice.', price: 18000, diet: ['veg', 'vegan', 'gluten_free'], prep: 5 },
      { cat: 'Rice & breads', name: 'Malabar parotta', desc: 'Flaky layered flatbread, two pieces.', price: 16000, diet: ['veg'], allergens: ['gluten'], prep: 8 },
      { cat: 'Desserts', name: 'Ada pradhaman', desc: 'Rice flakes, jaggery and coconut milk, warm.', price: 32000, diet: ['veg', 'vegan'], prep: 5 },
      { cat: 'Desserts', name: 'Tender coconut soufflé', desc: 'Light, cold and not too sweet.', price: 36000, diet: ['veg'], allergens: ['milk', 'eggs'], prep: 5 },
      { cat: 'Drinks', name: 'Fresh lime soda', desc: '', price: 16000, diet: ['veg', 'vegan'], prep: 3, variants: [['Style', 'Sweet', 0, true], ['Style', 'Salted', 0], ['Style', 'Mixed', 0]] },
      { cat: 'Drinks', name: 'Tender coconut', desc: 'Cut to order.', price: 14000, diet: ['veg', 'vegan'], prep: 3 },
      { cat: 'Drinks', name: 'Filter coffee', desc: 'Strong, with hot milk and a little sugar.', price: 12000, diet: ['veg'], allergens: ['milk'], prep: 5 },
    ];
    const menuItemIds: Record<string, string> = {};
    for (const [i, it] of items.entries()) {
      const [m] = await tx.insert(s.menuItems).values({ tenantId: T, restaurantId: tam!.id, categoryId: cats[it.cat]!, name: it.name, description: it.desc || null, price: it.price, dietary: it.diet, allergens: it.allergens ?? [], spiceLevel: it.spice ?? null, prepMinutes: it.prep ?? 15, sort: i, image: it.img ? { url: u(it.img, 800), alt: it.name } : null }).returning();
      menuItemIds[it.name] = m!.id;
      for (const [j, [g, n, d, def]] of (it.variants ?? []).entries()) await tx.insert(s.menuItemVariants).values({ tenantId: T, menuItemId: m!.id, kind: 'variant', groupName: g, name: n, priceDelta: d, isDefault: !!def, sort: j });
      for (const [j, [g, n, d]] of (it.addons ?? []).entries()) await tx.insert(s.menuItemVariants).values({ tenantId: T, menuItemId: m!.id, kind: 'addon', groupName: g, name: n, priceDelta: d, sort: j });
    }
    const [inRoom] = await tx.insert(s.orderTypes).values({ tenantId: T, restaurantId: tam!.id, key: 'in_room', name: 'In-room dining', description: 'Delivered to your room, day and night.', locationMode: 'room', requiresStay: true, paymentModes: ['room_charge', 'upi_manual', 'upi_gateway'], allowScheduling: true, moduleKey: 'room_service', sort: 0 }).returning();
    await tx.insert(s.orderTypes).values({ tenantId: T, restaurantId: tam!.id, key: 'poolside', name: 'Poolside & beach', description: 'We’ll bring it to your lounger.', locationMode: 'area', areas: ['Pool deck', 'Beach loungers', 'Cabana 1', 'Cabana 2'], paymentModes: ['room_charge', 'upi_manual'], sort: 1 });
    await tx.insert(s.orderTypes).values({ tenantId: T, restaurantId: tam!.id, key: 'takeaway', name: 'Takeaway', description: 'Ready to collect from the Tamarind counter.', locationMode: 'pickup', paymentModes: ['upi_manual', 'upi_gateway', 'pay_at_property', 'room_charge'], allowScheduling: true, sort: 2 });

    // ---- Service requests, experiences, guide
    for (const [i, r] of REQUEST_TYPES(true).entries()) await tx.insert(s.serviceRequestTypes).values({ tenantId: T, ...(r as object), sort: i } as never);
    const exps = [
      { kind: 'activity', name: 'Sunrise kayak on the backwater', slug: 'sunrise-kayak', summary: 'Paddle through the mangroves as the village wakes up.', durationMinutes: 120, price: 180000, maxParticipants: 4, location: 'Meet at the jetty', img: '1501785888041-af3ef285b470', times: ['06:15'], cap: 8 },
      { kind: 'class', name: 'Kerala kitchen with Chef Suresh', slug: 'cooking-class', summary: 'Market visit, three dishes, and lunch you cooked yourself.', durationMinutes: 180, price: 350000, maxParticipants: 4, location: 'Tamarind kitchen', img: '1476224203421-9ac39bcb3327', times: ['10:00'], cap: 6 },
      { kind: 'spa', name: 'Abhyanga — Ayurvedic massage', slug: 'abhyanga', summary: 'Sixty minutes of warm herbal oil, two therapists in rhythm.', durationMinutes: 60, price: 420000, maxParticipants: 1, location: 'The spa', img: '1544161515-4ab6ce6db874', times: ['10:00', '11:30', '15:00', '16:30', '18:00'], cap: 2 },
      { kind: 'spa', name: 'Shirodhara', slug: 'shirodhara', summary: 'A steady stream of warm oil on the forehead. Deeply calming.', durationMinutes: 75, price: 520000, maxParticipants: 1, location: 'The spa', img: '1600334129128-685c5582fd35', times: ['11:00', '17:00'], cap: 1 },
      { kind: 'tour', name: 'Fort Kochi heritage walk', slug: 'fort-kochi', summary: 'Chinese fishing nets, the Dutch palace and Jew Town, with a local historian.', durationMinutes: 240, price: 250000, maxParticipants: 6, location: 'Pickup from reception', img: '1602216056096-3b40cc0c9944', times: ['09:00'], cap: 10 },
    ];
    for (const [i, e] of exps.entries()) {
      const [row] = await tx.insert(s.experiences).values({ tenantId: T, propertyId: P, kind: e.kind as 'activity', name: e.name, slug: e.slug, summary: e.summary, durationMinutes: e.durationMinutes, price: e.price, maxParticipants: e.maxParticipants, location: e.location, images: [{ url: u(e.img, 1200), alt: e.name }], sort: i }).returning();
      for (let d = 1; d <= 21; d++) {
        const date = addDays(TODAY, d);
        for (const time of e.times) {
          const start = zonedTime(date, time, 'Asia/Kolkata');
          await tx.insert(s.experienceSlots).values({ tenantId: T, experienceId: row!.id, startsAt: start, endsAt: new Date(start.getTime() + e.durationMinutes * 60_000), capacity: e.cap });
        }
      }
    }
    const guide: [string, string, string, string, Record<string, unknown>[]][] = [
      ['wifi', 'wifi', 'Wi-Fi', 'Fibre throughout the property.', [{ type: 'kv', rows: [{ k: 'Network', v: 'Seabreeze-Guest' }, { k: 'Password', v: 'saltwater2026' }] }, { type: 'p', text: 'Signal is strongest in the rooms and the Tamarind pavilion. The beach deck has its own access point.' }]],
      ['dining', 'breakfast', 'Breakfast & dining hours', 'When and where to eat.', [{ type: 'kv', rows: [{ k: 'Breakfast', v: '7:00 – 10:30, Tamarind' }, { k: 'Lunch', v: '12:30 – 15:00, Tamarind' }, { k: 'Dinner', v: '19:00 – 22:30, Tamarind' }, { k: 'The Net (bar)', v: '17:30 – 23:00' }, { k: 'In-room dining', v: '24 hours' }] }]],
      ['facilities', 'pool', 'Pool & beach', 'Towels, hours and safety.', [{ type: 'kv', rows: [{ k: 'Pool', v: '6:30 – 20:00' }, { k: 'Beach towels', v: 'At the pool hut' }] }, { type: 'callout', tone: 'warning', text: 'The sea has strong currents in the monsoon (June–September). Please swim only where the lifeguard flag is up.' }]],
      ['facilities', 'spa', 'The spa', 'Ayurveda with a resident doctor.', [{ type: 'p', text: 'Open 9:00 – 20:00. Book treatments in the Experiences section of this app or at reception. A consultation with Dr. Sreekumar is complimentary with any programme.' }]],
      ['house_rules', 'house-rules', 'House rules', 'A few things we ask.', [{ type: 'list', items: ['Quiet hours are 22:30 – 7:00.', 'Smoking is permitted only in the garden smoking area.', 'Please don’t feed the resident cats — they are very well fed.', 'Visitors are welcome at the restaurants; please register them at reception.'] }]],
      ['emergency', 'emergency', 'Emergency', 'Numbers to call.', [{ type: 'callout', tone: 'emergency', text: 'For any emergency, dial 9 from your room phone — reception is staffed 24 hours.' }, { type: 'kv', rows: [{ k: 'Reception (24h)', v: '+91 484 248 1100' }, { k: 'Ambulance', v: '108' }, { k: 'Nearest hospital', v: 'Sree Narayana Hospital, 6 km' }, { k: 'Police', v: '112' }] }]],
      ['nearby', 'nearby', 'Nearby', 'Worth the short trip.', [{ type: 'list', items: ['Cherai beach — right here, 3 km of it.', 'Pallipuram Fort — the oldest European fort in India, 4 km.', 'Kottappuram market — spices and fish, 12 km.', 'Fort Kochi — 45 minutes by road or ferry.'] }]],
      ['transport', 'transport', 'Getting around', 'Taxis, ferries and bicycles.', [{ type: 'p', text: 'Bicycles are free to borrow from the pool hut. Reception can book taxis, the Vypeen ferry timings are on the notice board, and our car is available for airport runs.' }]],
      ['faq', 'faq', 'Questions guests ask', '', [{ type: 'h', text: 'Can I check out late?' }, { type: 'p', text: 'Request it in the app — we say yes whenever the next guest’s arrival allows.' }, { type: 'h', text: 'Is the water safe to drink?' }, { type: 'p', text: 'Yes — every tap runs through our filtration plant. Glass bottles are refilled daily.' }]],
    ];
    for (const [i, [category, slug, title, summary, body]] of guide.entries()) await tx.insert(s.guidePages).values({ tenantId: T, propertyId: P, category: category as 'wifi', slug, title, summary, body, sort: i });
    await tx.insert(s.announcements).values([
      { tenantId: T, title: 'Full moon dinner on the beach', body: 'Friday from 19:30 at The Net — grilled seafood, live music and the moon over the sea. Reserve in Dining.' },
      { tenantId: T, title: 'Pool maintenance', body: 'The pool will be closed 8:00 – 10:00 tomorrow for cleaning. The sea is, as ever, open.', endsAt: new Date(Date.now() + 2 * 86400_000) },
    ]);

    // ---- Website: apply the coastal template and publish
    await applyTemplate(tx, T, 'beach', people.manager!, { replaceContent: true });
    const ps = await tx.select().from(s.pages).where(eq(s.pages.tenantId, T));
    for (const p of ps) await publishPage(tx, T, p.id, people.manager!, 'Launch');
    await tx.update(s.siteSettings).set({
      navCta: { label: 'Book', href: '/book' },
      footer: { columns: [{ title: 'Stay', links: [{ label: 'Rooms', href: '/rooms' }, { label: 'Offers', href: '/#offers' }, { label: 'Your stay', href: '/stay' }] }, { title: 'Eat & do', links: [{ label: 'Dining', href: '/dining' }, { label: 'Experiences', href: '/experiences' }] }, { title: 'Contact', links: [{ label: '+91 484 248 1100', href: 'tel:+914842481100' }, { label: 'stay@seabreeze.example', href: 'mailto:stay@seabreeze.example' }] }], note: 'Seabreeze Cherai · Beach Road, Cherai, Kochi 683514 · GSTIN 32ABCDE1234F1Z5', social: [{ label: 'Instagram', href: 'https://instagram.com' }] },
      seoDefaults: { title: 'Seabreeze Cherai — beach resort near Kochi', description: 'Thirty-two rooms among the palms on Cherai beach, forty minutes from Kochi airport.' },
    }).where(eq(s.siteSettings.tenantId, T));
    return { T, P, rt, people, tam: tam!, net: net!, inRoom: inRoom!, menuItemIds };
  });

  // ---- Guests, bookings, stays, orders, requests (through the real services)
  const tenant = (await loadTenant(ctx.T))!;
  const guestsList = [
    ['Priya', 'Raghavan', 'priya.raghavan@example.com', '+91 98450 11223', 'IN'], ['Arjun', 'Mehta', 'arjun.mehta@example.com', '+91 98200 44556', 'IN'],
    ['Sarah', 'Whitfield', 'sarah.w@example.co.uk', '+44 7700 900123', 'GB'], ['Farhan', 'Qureshi', 'farhan.q@example.com', '+91 99000 77881', 'IN'],
    ['Nisha', 'Varma', 'nisha.varma@example.com', '+91 98470 33445', 'IN'], ['Lukas', 'Becker', 'lukas.becker@example.de', '+49 1512 3456789', 'DE'],
    ['Kavya', 'Reddy', 'kavya.reddy@example.com', '+91 98490 66778', 'IN'], ['Daniel', 'Joseph', 'daniel.joseph@example.com', '+91 94470 99001', 'IN'],
    ['Aisha', 'Khan', 'aisha.khan@example.com', '+91 98111 22334', 'IN'], ['Rohan', 'Kapoor', 'rohan.kapoor@example.com', '+91 98101 55667', 'IN'],
  ] as const;
  const plans = [['garden-room', 'BB'], ['pool-villa', 'BB'], ['garden-room', 'RO'], ['beach-cottage', 'BB'], ['garden-room', 'BB'], ['pool-villa', 'RO'], ['garden-room', 'BB'], ['garden-room', 'RO'], ['pool-villa', 'BB'], ['garden-room', 'BB']] as const;
  const bookingsMade: { id: string; guestEmail: string }[] = [];
  const stays: [number, number, 'past' | 'inhouse' | 'future'][] = [[-9, -6, 'past'], [-5, -2, 'past'], [-4, -1, 'past'], [-2, 2, 'inhouse'], [-1, 3, 'inhouse'], [0, 3, 'inhouse'], [0, 2, 'inhouse'], [3, 6, 'future'], [7, 10, 'future'], [14, 18, 'future']];
  for (const [i, g] of guestsList.entries()) {
    const [off1, off2, kind] = stays[i]!;
    const [slug, code] = plans[i]!;
    await asSystem(async (tx) => {
      const { booking } = await createBooking(tx, tenant, {
        roomTypeId: ctx.rt[slug]!.id, ratePlanId: ctx.rt[slug]!.plans[code]!, checkIn: addDays(TODAY, off1), checkOut: addDays(TODAY, off2), adults: 2, children: i % 4 === 0 ? 1 : 0,
        guest: { firstName: g[0], lastName: g[1], email: g[2], phone: g[3], country: g[4] }, paymentMethod: 'pay_at_property', source: i % 3 === 0 ? 'phone' : 'admin', createdByUserId: ctx.people.front_desk!,
        specialRequests: i === 3 ? 'Celebrating our anniversary — a quiet room please.' : i === 5 ? 'Arriving late, around 11 pm.' : null,
      });
      await tx.update(s.guests).set({ emailVerifiedAt: new Date() }).where(eq(s.guests.id, booking.guestId));
      if (kind !== 'future') await checkIn(tx, tenant, booking.id);
      if (kind === 'past') await checkOut(tx, tenant, booking.id);
      if (kind === 'past' || i === 3) {
        await tx.insert(s.payments).values({ tenantId: ctx.T, guestId: booking.guestId, targetType: 'booking', targetId: booking.id, bookingId: booking.id, method: 'pay_at_property', status: 'captured', amount: booking.total, currency: 'INR', reference: `PAY-SEED${i}`, verifiedByUserId: ctx.people.front_desk!, verifiedAt: new Date() });
        await tx.update(s.bookings).set({ amountPaid: booking.total, paymentStatus: 'paid' }).where(eq(s.bookings.id, booking.id));
      }
      bookingsMade.push({ id: booking.id, guestEmail: g[2] });
    });
  }
  // A direct web booking waiting for UPI verification — shows the manual approval flow.
  await asSystem(async (tx) => {
    const { booking } = await createBooking(tx, tenant, { roomTypeId: ctx.rt['beach-cottage']!.id, ratePlanId: ctx.rt['beach-cottage']!.plans.BB!, checkIn: addDays(TODAY, 21), checkOut: addDays(TODAY, 24), adults: 2, children: 0, guest: { firstName: 'Ishaan', lastName: 'Bose', email: 'ishaan.bose@example.com', phone: '+91 98300 12345' }, paymentMethod: 'upi_manual', source: 'direct' });
    const [p] = await tx.select().from(s.payments).where(eq(s.payments.targetId, booking.id));
    const { submitUtr } = await import('./domain/payments/service.js');
    await submitUtr(tx, { tenant, paymentId: p!.id, guestId: null, utr: '418273645091', payerVpa: 'ishaan.bose@okicici' });
  });

  // In-house activity: orders, requests, a reservation.
  const inHouse = await asSystem((tx) => tx.select({ g: s.guests }).from(s.stays).innerJoin(s.guests, eq(s.guests.id, s.stays.guestId)).where(and(eq(s.stays.tenantId, ctx.T), eq(s.stays.status, 'in_house'))));
  const types = await asSystem((tx) => tx.select().from(s.serviceRequestTypes).where(eq(s.serviceRequestTypes.tenantId, ctx.T)));
  const typeId = (k: string) => types.find((x) => x.key === k)!.id;
  await asSystem(async (tx) => {
    const g0 = await resolveStayContext(tx, ctx.T, inHouse[0]!.g.id);
    const g1 = await resolveStayContext(tx, ctx.T, inHouse[1]!.g.id);
    const g2 = await resolveStayContext(tx, ctx.T, inHouse[2]!.g.id);
    const o1 = await placeOrder(tx, tenant, g0, { restaurantId: ctx.tam.id, orderTypeId: ctx.inRoom.id, paymentMode: 'room_charge', lines: [{ menuItemId: ctx.menuItemIds['Alleppey prawn curry']!, quantity: 1 }, { menuItemId: ctx.menuItemIds['Malabar parotta']!, quantity: 2 }, { menuItemId: ctx.menuItemIds['Fresh lime soda']!, quantity: 2 }], specialInstructions: 'Less spicy please' });
    await transitionOrder(tx, tenant, o1.order.id, 'accepted', { type: 'user', id: ctx.people.kitchen! });
    await transitionOrder(tx, tenant, o1.order.id, 'preparing', { type: 'user', id: ctx.people.kitchen! });
    await placeOrder(tx, tenant, g1, { restaurantId: ctx.tam.id, orderTypeId: ctx.inRoom.id, paymentMode: 'room_charge', lines: [{ menuItemId: ctx.menuItemIds['Filter coffee']!, quantity: 2 }, { menuItemId: ctx.menuItemIds['Appam with vegetable stew']!, quantity: 1 }] });
    await createRequest(tx, tenant, { typeId: typeId('towels'), guest: g0, description: 'Two extra bath towels and a beach towel', details: { count: 3 } });
    await createRequest(tx, tenant, { typeId: typeId('maintenance'), guest: g1, description: 'The bathroom tap is dripping constantly', details: { category: 'plumbing' } });
    await createRequest(tx, tenant, { typeId: typeId('late_checkout'), guest: g2, description: 'Our flight is at 6 pm', details: { until: '14:00' } });
    await createRequest(tx, tenant, { typeId: typeId('airport_transfer'), guest: g2, details: { direction: 'Hotel → airport', flight: '6E 6173', pickup: zonedTime(addDays(TODAY, 2), '14:30', 'Asia/Kolkata').toISOString(), passengers: 2 } });
    await createReservation(tx, tenant, { restaurantId: ctx.net.id, startsAt: zonedTime(TODAY, '19:30', 'Asia/Kolkata'), partySize: 2, guestName: `${g0.guest.firstName} ${g0.guest.lastName}`, guestEmail: g0.guest.email, guestId: g0.guest.id, stayId: g0.stay?.id, occasion: 'Anniversary', source: 'portal', createdByUserId: ctx.people.front_desk! });
    await createReservation(tx, tenant, { restaurantId: ctx.tam.id, startsAt: zonedTime(TODAY, '20:00', 'Asia/Kolkata'), partySize: 4, guestName: 'Thomas family', guestPhone: '+91 94460 12121', source: 'phone', createdByUserId: ctx.people.front_desk! });
    await tx.insert(s.guestMessages).values({ tenantId: ctx.T, guestId: g1.guest.id, stayId: g1.stay?.id, senderType: 'guest', body: 'Hi! Is it possible to arrange a birthday cake for tomorrow evening? It’s my wife’s birthday.' });
    await tx.insert(s.eventInquiries).values({ tenantId: ctx.T, propertyId: ctx.P, reference: 'EV-8K2M4Q', contactName: 'Ritu Sharma', email: 'ritu.sharma@example.com', phone: '+91 98111 90909', eventType: 'wedding', eventDate: addDays(TODAY, 120), guestCount: 140, budget: 3500000_00 / 100, message: 'Looking for a beach wedding in February with a mehendi the evening before.' });
  });
  console.log('✓ Seabreeze Cherai (resort with dining) — http://seabreeze.localhost:3000');
  return ctx.T;
}

// ================================================================== Printworks (no restaurant module)
async function seedPrintworks() {
  const modules: ModuleKey[] = ['room_booking', 'payments', 'offers', 'guest_portal', 'housekeeping', 'maintenance', 'concierge', 'transport', 'notifications', 'website_builder', 'reports'];
  await asSystem(async (tx) => {
    const { tenant, roleIds } = await provisionTenant(tx, {
      name: 'The Printworks', slug: 'printworks', rootDomain: cfg.PLATFORM_ROOT_DOMAIN, modules, templateKey: 'urban_boutique', contactEmail: 'hello@printworks.example',
      owner: { name: 'Kabir Desai', email: 'owner@printworks.example', passwordHash: await hashPassword('Printworks!2026') },
    });
    const T = tenant.id;
    const people = await staff(tx, T, roleIds, [['Sana Shaikh', 'frontdesk@printworks.example', 'front_desk'], ['Ramesh Yadav', 'housekeeping@printworks.example', 'housekeeping']]);
    const [prop] = await tx.insert(s.properties).values({ tenantId: T, name: 'The Printworks', slug: 'main', tagline: 'Forty rooms in a Bandra printworks', addressLine: '14 Chapel Road, Bandra West', city: 'Mumbai', region: 'Maharashtra', country: 'IN', postalCode: '400050', phone: '+91 22 2640 7700', email: 'hello@printworks.example', timezone: 'Asia/Kolkata', checkInTime: '14:00', checkOutTime: '12:00', latitude: 19.0544, longitude: 72.8277, images: [{ url: u('1455587734955-081b22074882'), alt: 'The Printworks' }], amenities: ['Rooftop gym', '24h front desk', 'Fast Wi-Fi', 'EV charging'] }).returning();
    const defs = [['Studio', 'studio', 1, 2, 12, 520000, '1590490360182-c33d57733427'], ['Corner Room', 'corner', 2, 2, 8, 690000, '1618773928121-c32242e63f39'], ['Loft Suite', 'loft', 2, 3, 2, 1250000, '1578683010236-d716f9a3f461']] as const;
    let n = 201;
    for (const [i, [name, slug, base, max, count, price, img]] of defs.entries()) {
      const [r] = await tx.insert(s.roomTypes).values({ tenantId: T, propertyId: prop!.id, name, slug, baseOccupancy: base, maxOccupancy: max, maxAdults: max, maxChildren: 1, description: `${name} with blackout everything and a proper desk.`, bedConfig: 'Queen', sizeSqm: 22 + i * 12, sort: i, images: [{ url: u(img), alt: name }] }).returning();
      await tx.insert(s.ratePlans).values({ tenantId: T, roomTypeId: r!.id, name: 'Flexible', code: 'FLEX', basePrice: price, extraAdultPrice: 150000, cancellationPolicy: { freeUntilHours: 24, penaltyPercent: 100, label: 'Free cancellation until 24 hours before arrival' } });
      for (let k = 0; k < count; k++) await tx.insert(s.rooms).values({ tenantId: T, propertyId: prop!.id, roomTypeId: r!.id, number: String(n++) });
    }
    await tx.insert(s.taxes).values([{ tenantId: T, name: 'GST 12%', appliesTo: 'room', rateBps: 1200, maxAmount: 750000 }, { tenantId: T, name: 'GST 18%', appliesTo: 'room', rateBps: 1800, minAmount: 750001 }]);
    await tx.update(s.paymentSettings).set({ methodsEnabled: ['upi_manual', 'pay_at_property'], upiVpa: 'printworksbandra@okaxis', upiPayeeName: 'Printworks Hospitality LLP', manualPayWindowMinutes: 45 }).where(eq(s.paymentSettings.tenantId, T));
    for (const [i, r] of REQUEST_TYPES(true).entries()) await tx.insert(s.serviceRequestTypes).values({ tenantId: T, ...(r as object), sort: i } as never);
    await applyTemplate(tx, T, 'urban_boutique', people.front_desk!, { replaceContent: true });
    // No restaurant module here: drop the Dining page and its nav link.
    await tx.delete(s.pages).where(and(eq(s.pages.tenantId, T), eq(s.pages.slug, 'dining')));
    const [st] = await tx.select().from(s.siteSettings).where(eq(s.siteSettings.tenantId, T));
    await tx.update(s.siteSettings).set({ navigation: st!.navigation.filter((l) => l.href !== '/dining'), navCta: { label: 'Book', href: '/book' } }).where(eq(s.siteSettings.tenantId, T));
    for (const p of await tx.select().from(s.pages).where(eq(s.pages.tenantId, T))) await publishPage(tx, T, p.id, people.front_desk!, 'Launch');
  });
  console.log('✓ The Printworks (city boutique, no restaurant) — http://printworks.localhost:3000');
}

await asSystem(async (tx) => {
  const { syncPermissions } = await import('./domain/tenants/provision.js');
  await syncPermissions(tx);
  const { savePlatformBilling, DEFAULT_PLATFORM_BILLING } = await import('./domain/subscriptions/settings.js');
  await savePlatformBilling(tx, { ...DEFAULT_PLATFORM_BILLING, vpa: 'bookez@okhdfcbank', payeeName: 'bookEZ', legalName: 'bookEZ Technologies Private Limited', gstin: '29AAPFU0939F1ZR', address: '3rd Floor, 80 Feet Road, Indiranagar, Bengaluru 560038', stateCode: '29', email: 'billing@bookez.in' });
  await tx.insert(s.users).values({ tenantId: null, name: 'Platform Admin', email: 'admin@bookez.in', passwordHash: await hashPassword('Bookez!Admin2026'), isPlatformAdmin: true, emailVerifiedAt: new Date() });
});
const seabreezeId = await seedSeabreeze();
await seedPrintworks();
await invalidateTenant(seabreezeId);
await asSystem((tx) => tx.update(s.notifications).set({ status: 'sent', sentAt: new Date() }).where(eq(s.notifications.status, 'queued')));
console.log('✓ Platform admin — admin@bookez.in / Bookez!Admin2026');
await closeRedis();
await closeDb();
process.exit(0);
