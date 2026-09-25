/**
 * Tenant module registry. Every enableable capability is listed here; the API
 * enforces these keys server-side and the web app reads the same registry.
 */
export const MODULES = {
  room_booking: { name: 'Room Booking', group: 'Stay', requires: [] },
  payments: { name: 'Payments', group: 'Stay', requires: [] },
  offers: { name: 'Offers & Promotions', group: 'Stay', requires: [] },
  restaurant: { name: 'Restaurant', group: 'Dining', requires: [] },
  'restaurant.reservations': { name: 'Restaurant Reservations', group: 'Dining', requires: ['restaurant'] },
  'restaurant.ordering': { name: 'Restaurant Ordering', group: 'Dining', requires: ['restaurant'] },
  room_service: { name: 'Room Service', group: 'Dining', requires: ['restaurant.ordering'] },
  guest_portal: { name: 'Guest Portal', group: 'Guest services', requires: [] },
  housekeeping: { name: 'Housekeeping', group: 'Guest services', requires: [] },
  maintenance: { name: 'Maintenance Requests', group: 'Guest services', requires: [] },
  concierge: { name: 'Concierge & Guest Requests', group: 'Guest services', requires: [] },
  experiences: { name: 'Activities & Experiences', group: 'Guest services', requires: [] },
  spa: { name: 'Spa & Wellness', group: 'Guest services', requires: [] },
  transport: { name: 'Transport & Transfers', group: 'Guest services', requires: [] },
  events: { name: 'Events & Banquets', group: 'Guest services', requires: [] },
  notifications: { name: 'Notifications', group: 'Platform', requires: [] },
  website_builder: { name: 'Website Builder', group: 'Platform', requires: [] },
  reports: { name: 'Reports & Analytics', group: 'Platform', requires: [] },
  integrations: { name: 'Integrations', group: 'Platform', requires: [] },
} as const satisfies Record<string, { name: string; group: string; requires: readonly string[] }>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return v in MODULES;
}

/** Modules that must be disabled when `key` is disabled. */
export function dependentsOf(key: ModuleKey): ModuleKey[] {
  const out = new Set<ModuleKey>();
  const walk = (k: ModuleKey) => {
    for (const m of MODULE_KEYS) {
      if ((MODULES[m].requires as readonly string[]).includes(k) && !out.has(m)) {
        out.add(m);
        walk(m);
      }
    }
  };
  walk(key);
  return [...out];
}

/** A module is effective only if it and all its prerequisites are enabled. */
export function effectiveModules(enabled: Iterable<string>): Set<ModuleKey> {
  const on = new Set([...enabled].filter(isModuleKey));
  const ok = (k: ModuleKey): boolean =>
    on.has(k) && (MODULES[k].requires as readonly ModuleKey[]).every(ok);
  return new Set(MODULE_KEYS.filter(ok));
}
