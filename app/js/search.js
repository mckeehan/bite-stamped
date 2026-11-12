// The list search (Timeline, Visited, To Try): plain words look everywhere
// in a place; "field:value" looks only in that field, e.g. tag:brunch,
// with:anna, city:knox. Values match partly and regardless of case and
// accents; a value with spaces goes in quotes, tag:"date night". Everything
// typed has to match.

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// What each field searches in a place. `label` is for the suggestions.
export const FIELDS = {
  tag: { label: 'Tag', values: (r) => r.tags },
  with: { label: 'With', values: (r) => r.visits.flatMap((v) => v.people) },
  city: { label: 'City', values: (r) => [r.city] },
  state: { label: 'State', values: (r) => [r.state] },
  type: { label: 'Type', values: (r) => [r.type] },
  cuisine: { label: 'Cuisine', values: (r) => r.cuisine.split(',').map((c) => c.trim()) },
  dish: { label: 'Dish', values: (r) => r.dishes.map((m) => m.name) },
  name: { label: 'Name', values: (r) => [r.name] },
};
// Other words for the same fields.
const ALIASES = { tags: 'tag', people: 'with', person: 'with', category: 'cuisine', dishes: 'dish', town: 'city' };
const fieldOf = (word) => {
  const w = word.toLowerCase();
  return FIELDS[w] ? w : ALIASES[w] || null;
};

// Splits a search into terms: { field, value, start, end, open } where
// `field` is null for a plain word or "quoted phrase", `start`/`end` locate
// the term in the text, and `open` says a quote isn't closed yet. A prefix
// that isn't a field ("10:30", "http:") is a plain word.
export function parseQuery(text) {
  const terms = [];
  const re = /([A-Za-z]+):"([^"]*)("?)|([A-Za-z]+):(\S*)|"([^"]*)("?)|(\S+)/g;
  for (let m; (m = re.exec(text));) {
    const [all, qField, qValue, qClose, field, value, phrase, pClose, word] = m;
    const at = { start: m.index, end: m.index + all.length };
    const f = fieldOf(qField || field || '');
    if (qField && f) terms.push({ field: f, value: qValue, open: !qClose, ...at });
    else if (field && f) terms.push({ field: f, value, open: false, ...at });
    else if (phrase !== undefined) terms.push({ field: null, value: phrase, open: !pClose, ...at });
    else terms.push({ field: null, value: word ?? all, open: false, ...at });
  }
  return terms;
}

// Everything a plain word searches.
function haystack(r) {
  return fold([
    r.name, r.type, r.cuisine, r.city, r.state, r.country, r.address, r.notes, ...r.tags,
    ...r.dishes.map((m) => m.name),
    ...r.visits.flatMap((v) => [...v.people, v.notes]),
    ...r.photos.map((p) => p.title),
  ].join('\n'));
}

export function matches(r, query) {
  const terms = parseQuery(String(query ?? '')).filter((t) => t.value.trim());
  if (!terms.length) return true;
  let hay = null;
  return terms.every((t) => {
    const v = fold(t.value.trim());
    if (t.field) return FIELDS[t.field].values(r).some((x) => x && fold(x).includes(v));
    hay ??= haystack(r);
    return hay.includes(v);
  });
}

// What to suggest while typing: when the text ends in a field term
// ("tag:", "tag:bru", 'tag:"date n'), that field's values among `places`
// that contain what follows the colon, most used first (at most `limit`).
// → { field, start, end, values: [{ value, count }] } or null.
export function suggest(text, places, limit = 8) {
  if (/\s$/.test(text) && !/"[^"]*$/.test(text)) return null;
  const last = parseQuery(text).at(-1);
  if (!last?.field || last.end !== text.length) return null;
  if (!last.open && /"$/.test(text.slice(last.start, last.end)) && text.slice(last.start).includes(':"')) return null;
  const typed = fold(last.value);
  const counts = new Map();
  for (const r of places) {
    for (const v of new Set(FIELDS[last.field].values(r).map((x) => String(x ?? '').trim()).filter(Boolean))) {
      const key = fold(v);
      const seen = counts.get(key);
      if (seen) seen.count++;
      else counts.set(key, { value: v, count: 1 });
    }
  }
  // Where the typed text falls: the value's start, a word's start, anywhere.
  const rank = (key) => (key.startsWith(typed) ? 0 : key.split(/[^a-z0-9]+/).some((w) => w.startsWith(typed)) ? 1 : 2);
  const values = [...counts.entries()]
    .filter(([key]) => key.includes(typed))
    .sort(([ka, a], [kb, b]) => (rank(ka) - rank(kb)) || (b.count - a.count) || a.value.localeCompare(b.value))
    .slice(0, limit)
    .map(([, v]) => v);
  return { field: last.field, start: last.start, end: last.end, values };
}

// The text with the term at start…end replaced by field:value (quoted when
// it has a space), followed by a space for the next word.
export function applySuggestion(text, { field, start, end }, value) {
  const term = `${field}:${/\s|"/.test(value) ? `"${value.replace(/"/g, '')}"` : value}`;
  return `${text.slice(0, start)}${term} ${text.slice(end).trimStart()}`;
}
