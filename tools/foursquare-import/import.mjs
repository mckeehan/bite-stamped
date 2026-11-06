// Converts a Foursquare / Swarm data export into a ZIP that Bite-Stamped can
// import (Settings → Import ZIP): a place per venue, a visit per check-in.
// See README.md in this folder.
//
//   node --env-file-if-exists=.env tools/foursquare-import/import.mjs <export folder or .zip> --journal <Bite-Stamped export .zip> [options]

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readZip, createZip } from '../../app/js/zip.js';
import { today } from '../../app/js/model.js';
import { parseExport, collectVenues, parseJournal, buildPlaces } from './convert.mjs';
import { openCache, lookUpVenues } from './lookup.mjs';

const HELP = `Usage: npm run import-foursquare -- <export> --journal <file> [options]

  <export>               the Foursquare data export: its folder, or the .zip as downloaded

  --journal <file>       your places so far, so check-ins at places you already have
                         become visits there instead of second copies that the import
                         would write over them: a ZIP from Settings → Export ZIP, or the
                         server's files folder (data/files)
  --empty-journal        there are no places yet (instead of --journal)
  --out <file>           the ZIP to write (default: ~/Downloads/foursquare-for-bite-stamped-<date>.zip)
  --lookup <source>      where addresses and kinds of place come from:
                           foursquare  Foursquare's Places API (needs FOURSQUARE_API_KEY;
                                       one billed call per venue, cached)
                           nominatim   OpenStreetMap, from where you checked in (free,
                                       one venue a second, address only)
                           none        only names (files are then named by name only)
                         default: foursquare when FOURSQUARE_API_KEY is set, else nominatim
  --since <YYYY-MM-DD>   only check-ins from that day on
  --min-checkins <n>     only venues you checked in at this often (default 1)
  --food                 only places to eat and drink (needs a lookup to know)
  --lists <names>        lists whose venues become places to try, comma separated
                         (default: all of them)
  --no-lists             no places to try from lists
  --cache <file>         lookup cache (default: tools/foursquare-import/.cache/venues.json)
  --dry-run              count and say what would happen; no lookups, nothing written
`;

const HERE = fileURLToPath(new URL('.', import.meta.url));

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      journal: { type: 'string' }, 'empty-journal': { type: 'boolean' }, out: { type: 'string' },
      lookup: { type: 'string' }, since: { type: 'string' }, 'min-checkins': { type: 'string' },
      food: { type: 'boolean' }, lists: { type: 'string' }, 'no-lists': { type: 'boolean' },
      cache: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
} catch (e) {
  fail(`${e.message}\n\n${HELP}`);
}
const opt = args.values;
if (opt.help) { console.log(HELP); process.exit(0); }
if (args.positionals.length !== 1) fail(HELP);
if (!opt.journal && !opt['empty-journal']) {
  fail(`Say where your places are (--journal), so places you already have aren't replaced\nby the import; or --empty-journal if there are none yet.\n\n${HELP}`);
}
const apiKey = process.env.FOURSQUARE_API_KEY || '';
const mode = opt.lookup || (apiKey ? 'foursquare' : 'nominatim');
if (!['foursquare', 'nominatim', 'none'].includes(mode)) fail(`--lookup is foursquare, nominatim or none, not "${mode}".`);
if (mode === 'foursquare' && !apiKey) fail('--lookup foursquare needs FOURSQUARE_API_KEY (in .env or the environment).');
if (opt.since && !/^\d{4}-\d\d-\d\d$/.test(opt.since)) fail('--since takes a date like 2020-01-31.');
const minCheckins = Number(opt['min-checkins'] || 1);
if (!Number.isInteger(minCheckins) || minCheckins < 1) fail('--min-checkins takes a whole number, 1 or more.');
const out = resolve(opt.out || join(homedir(), 'Downloads', `foursquare-for-bite-stamped-${today()}.zip`));

// A folder's files or a ZIP's entries → [{ path, bytes }].
async function readFiles(path) {
  const full = resolve(path);
  let stat;
  try { stat = statSync(full); } catch { fail(`Not found: ${full}`); }
  if (!stat.isDirectory()) return readZip(new Blob([readFileSync(full)]));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ path: relative(full, p).split('\\').join('/'), bytes: readFileSync(p) });
    }
  };
  walk(full);
  return files;
}

const exp = parseExport(await readFiles(args.positionals[0]));
const journal = opt.journal ? parseJournal(await readFiles(opt.journal)) : [];
if (opt.journal && !journal.length) fail(`No places found in ${opt.journal}. Use --empty-journal if there are none yet.`);
const venues = collectVenues(exp.checkins, { since: opt.since });
const toTryLists = opt['no-lists'] ? [] : opt.lists ? opt.lists.split(',').map((s) => s.trim()).filter(Boolean) : null;
const lists = toTryLists === null ? exp.lists : exp.lists.filter((l) => toTryLists.some((n) => n.toLowerCase() === l.name.toLowerCase()));

const kept = [...venues.values()].filter((v) => v.checkins.length >= minCheckins);
const listed = lists.flatMap((l) => l.venues).filter((v) => !kept.some((k) => k.id === v.id))
  .map((v) => ({ id: v.id, name: v.name, checkins: [] }));
const toLookUp = [...kept, ...listed.filter((v, i) => listed.findIndex((w) => w.id === v.id) === i)];
const cache = openCache(resolve(opt.cache || join(HERE, '.cache', 'venues.json')));
const uncached = toLookUp.filter((v) => !cache.get(v.id, mode === 'foursquare' ? 'foursquare' : 'nominatim')).length;

console.log(`${[...venues.values()].reduce((n, v) => n + v.checkins.length, 0)} check-ins at ${venues.size} venues${opt.since ? ` since ${opt.since}` : ''}; ` +
  `${kept.length} venues with at least ${minCheckins} check-in${minCheckins > 1 ? 's' : ''}, ` +
  `${toLookUp.length - kept.length} more from lists (${lists.map((l) => l.name).join(', ') || 'none'}).`);
console.log(`Your journal: ${journal.length} places.`);
if (mode !== 'none') {
  console.log(mode === 'foursquare'
    ? `Lookup: Foursquare, ${uncached} venues not in the cache (up to ${uncached} billed calls).`
    : `Lookup: OpenStreetMap, ${uncached} venues not in the cache (about ${Math.ceil(uncached * 1.1 / 60)} min).`);
}
if (opt['dry-run']) process.exit(0);

const info = await lookUpVenues(toLookUp, { mode, apiKey, cache, log: (s) => console.log(s) });
const { files, counts, skipped } = buildPlaces({
  venues, lists, tips: exp.tips, photos: exp.photos, info, journal,
  options: { minCheckins, food: Boolean(opt.food) },
});
if (!files.length) {
  console.log('Nothing to import: everything is in your journal already.');
  process.exit(0);
}
const zip = await createZip(files);
writeFileSync(out, new Uint8Array(await zip.arrayBuffer()));
console.log(`Wrote ${out}`);
console.log(`${counts.newPlaces} new places (${counts.toTry} to try), ${counts.updatedPlaces} places you had with new visits; ` +
  `${counts.visits} visits added, ${counts.knownVisits} check-ins already were visits; ${counts.photos} photos, ${counts.tips} tips.`);
if (skipped.notFood) console.log(`Left out ${skipped.notFood} places that aren't for eating or drinking.`);
console.log('Import it in Bite-Stamped: Settings → Import ZIP, on a device that has synced (so its places match the journal you gave).');

function fail(message) {
  console.error(message);
  process.exit(1);
}
