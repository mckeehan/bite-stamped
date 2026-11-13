// Finding places that are the same place twice (from importing, or adding
// it again under another name), and what merging two of them gives.
//
// A pair counts as a possible duplicate when the two have
// - the same street address (house number and street; "Pkwy" and "Parkway"
//   are the same), even under different names or towns, or
// - the same name and are within 150 m (or, without a location, in the same
//   town), so two branches of a chain across town don't count, or
// - similar names (one's words start the other's) within 40 m.
// The person decides: these are suggestions.

import { nameKey, nameMatches, distance, mergeRestaurants, stateCode } from './model.js';

const SAME_NAME_METERS = 150;
const SIMILAR_NAME_METERS = 40;

// Street words written out, so "2849 Winfield Dunn Pkwy" and
// "2849 Winfield Dunn Parkway" are the same.
const STREET_WORDS = {
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue', blvd: 'boulevard', dr: 'drive',
  ln: 'lane', ct: 'court', pl: 'place', pkwy: 'parkway', pky: 'parkway', hwy: 'highway', hy: 'highway',
  cir: 'circle', trl: 'trail', ter: 'terrace', sq: 'square', pike: 'pike', pk: 'pike', expy: 'expressway',
  fwy: 'freeway', tpke: 'turnpike', ste: 'suite', mt: 'mount', ft: 'fort',
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

// The address as house number and street, compared loosely; '' without a
// house number (a street alone doesn't say which place).
export function addressKey(address) {
  const first = String(address ?? '').split(',')[0];
  const words = nameKey(first).split(' ').filter(Boolean).map((w) => STREET_WORDS[w] || w);
  // Suite and unit numbers aren't part of where the building is.
  const cut = words.findIndex((w) => w === 'suite' || w === 'unit' || w === 'apt');
  const kept = cut > 0 ? words.slice(0, cut) : words;
  return /^\d+[a-z]?$/.test(kept[0] || '') && kept.length > 1 ? kept.join(' ') : '';
}

const hasPoint = (r) => Number.isFinite(r.lat) && Number.isFinite(r.lon) && r.lat !== null && r.lon !== null;
const sameTown = (a, b) => a.city && b.city && nameKey(a.city) === nameKey(b.city);
// "Tennessee" and "TN" are the same state.
const sameState = (a, b) => !a.state || !b.state || stateCode(a.state) === stateCode(b.state);
const similarNames = (a, b) => nameMatches(a.name, b.name) || nameMatches(b.name, a.name);
// The same type ("Post office"), with the same category or one left empty.
const sameKind = (a, b) => {
  const type = nameKey(a.type);
  if (!type || type !== nameKey(b.type)) return false;
  const ca = nameKey(a.cuisine);
  const cb = nameKey(b.cuisine);
  return !ca || !cb || ca === cb;
};

// A pair's key, the same either way round: for remembering "not the same".
export const pairKey = (a, b) => [a.path, b.path].sort().join('\n');

// Why `a` and `b` look like the same place, strongest first; [] if they don't.
export function duplicateReasons(a, b) {
  const reasons = [];
  const meters = hasPoint(a) && hasPoint(b) ? distance(a, b) : null;
  const nameA = nameKey(a.name);
  const sameName = nameA && nameA === nameKey(b.name);
  const similar = !sameName && similarNames(a, b);
  const address = addressKey(a.address);
  const sameAddress = address && address === addressKey(b.address) && sameState(a, b);
  if (sameAddress) reasons.push('Same address');
  if (sameName && (sameAddress || (meters === null ? sameTown(a, b) : meters <= SAME_NAME_METERS))) reasons.push('Same name');
  // (One address can cover a big site: a winery 3 km from the house.)
  else if (similar && (meters === null ? sameAddress : meters <= (sameAddress ? SAME_NAME_METERS : SIMILAR_NAME_METERS))) reasons.push('Similar name');
  // A shared address alone is often a shopping centre: only the same kind
  // of place there counts (two names for one post office).
  if (sameAddress && reasons.length === 1) {
    if (!sameKind(a, b)) return [];
    reasons.push('Same kind of place');
  }
  return reasons;
}

// All possible duplicate pairs among `places`, except the pairs in `notSame`
// (a Set of pairKey). → [{ a, b, reasons, meters }], those whose names
// match first, then those with more reasons, then the closest. Compares only places that share an
// address, a name or a small area, so thousands of places are quick.
export function findDuplicates(places, notSame = new Set()) {
  const groups = new Map();
  const add = (key, r) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); };
  const CELL = 0.002; // degrees, about 200 m
  for (const r of places) {
    const address = addressKey(r.address);
    if (address) add(`a:${address}`, r);
    const name = nameKey(r.name);
    if (name) add(`n:${name}`, r);
    if (hasPoint(r)) add(`g:${Math.floor(r.lat / CELL)}:${Math.floor(r.lon / CELL)}`, r);
  }
  // Neighbouring cells too, for places either side of a cell's edge.
  const near = (r) => {
    if (!hasPoint(r)) return [];
    const y = Math.floor(r.lat / CELL);
    const x = Math.floor(r.lon / CELL);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(groups.get(`g:${y + dy}:${x + dx}`) || []));
    return out;
  };
  const seen = new Set();
  const pairs = [];
  for (const a of places) {
    const candidates = [
      ...(groups.get(`a:${addressKey(a.address)}`) || []),
      ...(groups.get(`n:${nameKey(a.name)}`) || []),
      ...near(a),
    ];
    for (const b of candidates) {
      if (b === a || b.path === a.path) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      if (notSame.has(key)) continue;
      const reasons = duplicateReasons(a, b);
      if (!reasons.length) continue;
      const meters = hasPoint(a) && hasPoint(b) ? Math.round(distance(a, b)) : null;
      pairs.push({ a, b, reasons, meters });
    }
  }
  // Names that match say more than an address and a kind of place.
  const score = (p) => p.reasons.length + (p.reasons.some((r) => r.endsWith('name')) ? 2 : 0);
  return pairs.sort((p, q) => (score(q) - score(p)) || ((p.meters ?? 1e9) - (q.meters ?? 1e9)) || p.a.name.localeCompare(q.a.name));
}

// One place from two: `keep`'s name and details, with what it lacks filled
// in from `other`; the visits, dishes, photos, tags and notes of both (the
// same visit or photo only once). A place to try only if both were.
// `other`'s images should already point where they will be kept.
export function mergePlaces(keep, other) {
  const merged = mergeRestaurants(keep, other);
  merged.path = keep.path;
  merged.rating = keep.rating || other.rating;
  merged.toTry = keep.toTry && other.toTry;
  return merged;
}
