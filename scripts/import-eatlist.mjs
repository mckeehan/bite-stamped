// Converts the data of the Eatlist app (Core Data store of its Mac version)
// into a ZIP that Bite-Stamped can import: one Markdown file per restaurant plus photos.
// macOS only; needs the `sqlite3` command line tool that ships with macOS.
//
//   node scripts/import-eatlist.mjs [output.zip] [path/to/Eatlist_CloudKit.sqlite]
//
// The store is copied to a temporary folder first, so the app's own files are
// only read. Open Eatlist on the Mac beforehand so it has synced from iCloud.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { newRestaurant, toMarkdown, uniquePath, mediaDir, today } from '../app/js/model.js';
import { createZip } from '../app/js/zip.js';

const DEFAULT_STORE = join(homedir(), 'Library/Containers/yqiang.Eatlist/Data/Library/Application Support/Eatlist/Eatlist_CloudKit.sqlite');
const output = resolve(process.argv[2] || join(homedir(), 'Downloads', `eatlist-for-bite-stamped-${today()}.zip`));
const store = resolve(process.argv[3] || DEFAULT_STORE);
const externalData = join(dirname(store), `.${basename(store, '.sqlite')}_SUPPORT`, '_EXTERNAL_DATA');

// Core Data dates are seconds since 2001-01-01 UTC.
const CORE_DATA_EPOCH = 978307200;
const toDate = (seconds) => (seconds === null || seconds === undefined ? null : new Date((seconds + CORE_DATA_EPOCH) * 1000));
const ymd = (date, timeZone) => date && new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const rating = (v) => (v > 0 ? Math.min(5, v) : 0); // Eatlist uses -1 (or 0) for "not rated"

if (!existsSync(store)) {
  console.error(`No Eatlist data found at\n  ${store}\nOpen Eatlist on this Mac once so it syncs, or pass the path as the second argument.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'eatlist-'));
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(store + suffix)) copyFileSync(store + suffix, join(work, 'store.sqlite' + suffix));
}

function query(sql) {
  const out = execFileSync('sqlite3', ['-json', '-readonly', join(work, 'store.sqlite'), sql], { maxBuffer: 1 << 28 }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

// An image attribute is either stored inline (first byte 1) or in a separate
// file named by a UUID (first byte 2, then the UUID as text).
function imageBytes(hex) {
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf[0] === 1) return buf.subarray(1);
  if (buf[0] === 2) {
    const file = join(externalData, buf.subarray(1).toString('utf8').replace(/\0+$/, ''));
    return existsSync(file) ? readFileSync(file) : null;
  }
  return buf;
}

function imageExt(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes.subarray(4, 12).toString('latin1').startsWith('ftyphei')) return 'heic';
  return 'jpg';
}

try {
  const restaurants = query(`select Z_PK pk, ZNAME name, ZRATING rating, ZTOTRY toTry, ZFORMATTEDADDRESS address, ZCITY city,
    ZSTATE state, ZCOUNTRY country, ZCOUNTRYCODE countryCode, ZLATITUDE lat, ZLONGITUDE lon, ZRESTAURANTURL website,
    ZGOOGLEPLACEID googlePlaceId, ZNOTES notes, ZCREATIONDATE created from ZRESTAURANT order by ZCREATIONDATE`);
  const visits = query(`select Z_PK pk, ZRESTAURANT restaurant, ZRATING rating, ZVISITDATE date, ZTIMEZONEIDENTIFIER tz from ZRESTAURANTVISIT`);
  const people = query(`select v.Z_5VISITS visit, trim(coalesce(p.ZGIVENNAME, '') || ' ' || coalesce(p.ZFAMILYNAME, '')) name
    from Z_2VISITS v join ZPERSON p on p.Z_PK = v.Z_2PEOPLE`);
  const dishes = query(`select ZRESTAURANT restaurant, ZNAME name, ZRATINGVALUE rating, ZNOTES notes from ZMENUITEM order by ZCREATIONDATE`);
  const photos = query(`select ZRESTAURANT restaurant, hex(ZIMAGEDATA) data, hex(ZIMAGETHUMBNAILDATA) thumb,
    coalesce(ZPHOTOCREATIONDATEVALUE, ZCREATIONDATE) date from ZPHOTO order by ZCREATIONDATE`);

  const files = [];
  const paths = [];
  const counts = { restaurants: 0, visits: 0, dishes: 0, photos: 0, photosMissing: 0 };

  for (const row of restaurants) {
    const r = newRestaurant({
      name: row.name || 'Unnamed',
      rating: rating(row.rating),
      toTry: row.toTry === 1,
      address: row.address,
      city: row.city,
      state: row.state,
      country: row.country,
      countryCode: row.countryCode,
      lat: row.lat,
      lon: row.lon,
      website: row.website,
      googlePlaceId: row.googlePlaceId,
      notes: row.notes,
      created: toDate(row.created)?.toISOString(),
    });
    r.path = uniquePath(r.name, paths);
    paths.push(r.path);

    r.visits = visits.filter((v) => v.restaurant === row.pk).map((v) => ({
      date: ymd(toDate(v.date), v.tz),
      rating: rating(v.rating),
      people: people.filter((p) => p.visit === v.pk && p.name).map((p) => p.name),
      notes: '',
    }));
    r.dishes = dishes.filter((m) => m.restaurant === row.pk).map((m) => ({
      name: m.name || '', rating: rating(m.rating), price: '', notes: m.notes || '', image: '',
    }));

    let n = 0;
    for (const p of photos.filter((p) => p.restaurant === row.pk)) {
      const bytes = imageBytes(p.data) || imageBytes(p.thumb);
      if (!bytes) { counts.photosMissing++; continue; }
      const file = `${mediaDir(r.path)}eatlist-${++n}.${imageExt(bytes)}`;
      files.push({ path: file, data: new Uint8Array(bytes) });
      r.photos.push({ file, title: '', date: ymd(toDate(p.date)) || '' });
    }

    r.updated = new Date().toISOString();
    files.push({ path: r.path, data: toMarkdown(r) });
    counts.restaurants++;
    counts.visits += r.visits.length;
    counts.dishes += r.dishes.length;
    counts.photos += r.photos.length;
  }

  const zip = await createZip(files.sort((a, b) => a.path.localeCompare(b.path)));
  writeFileSync(output, new Uint8Array(await zip.arrayBuffer()));
  console.log(`Wrote ${output}`);
  console.log(`${counts.restaurants} restaurants, ${counts.visits} visits, ${counts.dishes} dishes, ${counts.photos} photos` +
    (counts.photosMissing ? ` (${counts.photosMissing} photos had no image data)` : ''));
} finally {
  rmSync(work, { recursive: true, force: true });
}
