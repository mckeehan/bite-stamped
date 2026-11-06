// Offline check-ins: when the place search can't be reached (no connection,
// server down), a check-in is kept for later with what was typed, where the
// device was and when. Opening one later runs that search around that spot
// and records the visit at that time.
//
// They stay on this device (in the database's meta table, which sync and
// "clear" leave alone); they aren't journal files, so they don't sync.

import * as store from './store.js';

const KEY = 'offlineCheckins';

// `meta`: { getMeta, setMeta } (store.js; tests pass their own).
export function offlineCheckIns(meta) {
  // [{ id, query, lat, lon, date }], oldest first. `date` is a local
  // "YYYY-MM-DDTHH:MM" like a visit's.
  const list = async () => {
    const items = await meta.getMeta(KEY);
    return Array.isArray(items) ? items : [];
  };
  return {
    list,
    get: async (id) => (await list()).find((c) => c.id === id) || null,
    async add({ query = '', lat = null, lon = null, date }) {
      const item = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        query: String(query).trim(),
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lat) && Number.isFinite(lon) ? lon : null,
        date,
      };
      await meta.setMeta(KEY, [...(await list()), item]);
      return item;
    },
    remove: async (id) => meta.setMeta(KEY, (await list()).filter((c) => c.id !== id)),
  };
}

export const { list, get, add, remove } = offlineCheckIns(store);
