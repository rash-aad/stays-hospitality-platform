/**
 * Channel-manager providers. bookEZ pushes availability, rates and restrictions and pulls OTA bookings
 * through one interface. `mock` is a working in-process provider for development and tests; `channex`
 * talks to Channex.io — verify against the Channex staging environment before going live.
 */
export type AvailabilityUpdate = { externalRoomTypeId: string; dateFrom: string; dateTo: string; availability: number };
export type RestrictionUpdate = { externalRatePlanId: string; dateFrom: string; dateTo: string; rate: number; stopSell: boolean; minStay: number };
export type ExternalBooking = {
  revisionId: string; externalId: string; status: 'new' | 'modified' | 'cancelled'; channel: string;
  externalRatePlanId: string; checkIn: string; checkOut: string; adults: number; children: number;
  guest: { firstName: string; lastName: string; email: string | null; phone: string | null }; total: number | null; notes: string | null;
};
export type Conn = { id: string; externalPropertyId: string; environment: 'staging' | 'production'; apiKey: string | null };

export interface ChannelAdapter {
  test(conn: Conn): Promise<string>;
  pushAvailability(conn: Conn, updates: AvailabilityUpdate[]): Promise<void>;
  pushRestrictions(conn: Conn, updates: RestrictionUpdate[]): Promise<void>;
  fetchBookings(conn: Conn): Promise<ExternalBooking[]>;
  ack(conn: Conn, revisionId: string): Promise<void>;
}

// ---------------------------------------------------------------- test provider

type MockState = { availability: AvailabilityUpdate[]; restrictions: RestrictionUpdate[]; inbox: ExternalBooking[]; acked: string[] };
const mockStore = new Map<string, MockState>();
export const mockState = (connId: string) => {
  if (!mockStore.has(connId)) mockStore.set(connId, { availability: [], restrictions: [], inbox: [], acked: [] });
  return mockStore.get(connId)!;
};

export const mockAdapter: ChannelAdapter = {
  async test() { return 'Test channel manager connected'; },
  async pushAvailability(conn, updates) { mockState(conn.id).availability.push(...updates); },
  async pushRestrictions(conn, updates) { mockState(conn.id).restrictions.push(...updates); },
  async fetchBookings(conn) { const s = mockState(conn.id); return s.inbox.filter((b) => !s.acked.includes(b.revisionId)); },
  async ack(conn, revisionId) { mockState(conn.id).acked.push(revisionId); },
};

// ---------------------------------------------------------------- Channex

const base = (c: Conn) => (c.environment === 'production' ? 'https://app.channex.io/api/v1' : 'https://staging.channex.io/api/v1');

async function channex<T>(c: Conn, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!c.apiKey) throw new Error('Add the Channex API key');
  const res = await fetch(`${base(c)}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'user-api-key': c.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

type ChannexRevision = {
  id: string;
  attributes: {
    booking_id: string; status: string; ota_name?: string; arrival_date: string; departure_date: string; amount?: string | number; ota_reservation_code?: string; notes?: string;
    customer?: { name?: string; surname?: string; mail?: string; phone?: string };
    rooms?: { rate_plan_id: string; occupancy?: { adults?: number; children?: number } }[];
  };
};

export const channexAdapter: ChannelAdapter = {
  async test(c) {
    const r = await channex<{ data?: { attributes?: { title?: string } } }>(c, `/properties/${encodeURIComponent(c.externalPropertyId)}`);
    return `Connected to Channex property “${r.data?.attributes?.title ?? c.externalPropertyId}”`;
  },
  async pushAvailability(c, updates) {
    if (!updates.length) return;
    await channex(c, '/availability', { method: 'POST', body: { values: updates.map((u) => ({ property_id: c.externalPropertyId, room_type_id: u.externalRoomTypeId, date_from: u.dateFrom, date_to: u.dateTo, availability: u.availability })) } });
  },
  async pushRestrictions(c, updates) {
    if (!updates.length) return;
    await channex(c, '/restrictions', { method: 'POST', body: { values: updates.map((u) => ({ property_id: c.externalPropertyId, rate_plan_id: u.externalRatePlanId, date_from: u.dateFrom, date_to: u.dateTo, rate: (u.rate / 100).toFixed(2), stop_sell: u.stopSell, min_stay_arrival: u.minStay })) } });
  },
  async fetchBookings(c) {
    const r = await channex<{ data?: ChannexRevision[] }>(c, `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(c.externalPropertyId)}`);
    return (r.data ?? []).flatMap((rev) => {
      const a = rev.attributes;
      const room = a.rooms?.[0];
      if (!room) return [];
      const status = a.status === 'cancelled' ? 'cancelled' : a.status === 'modified' ? 'modified' : 'new';
      return [{
        revisionId: rev.id, externalId: a.ota_reservation_code || a.booking_id, status, channel: a.ota_name ?? 'Channex',
        externalRatePlanId: room.rate_plan_id, checkIn: a.arrival_date, checkOut: a.departure_date,
        adults: room.occupancy?.adults ?? 2, children: room.occupancy?.children ?? 0,
        guest: { firstName: a.customer?.name || 'Guest', lastName: a.customer?.surname || a.ota_name || 'OTA', email: a.customer?.mail || null, phone: a.customer?.phone || null },
        total: a.amount != null ? Math.round(Number(a.amount) * 100) : null, notes: a.notes ?? null,
      } satisfies ExternalBooking];
    });
  },
  async ack(c, revisionId) { await channex(c, `/booking_revisions/${encodeURIComponent(revisionId)}/ack`, { method: 'POST' }); },
};

export const ADAPTERS: Record<'mock' | 'channex', ChannelAdapter> = { mock: mockAdapter, channex: channexAdapter };
