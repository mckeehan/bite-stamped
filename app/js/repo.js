// Loads all restaurant files into memory and writes changes back to the
// file store. Also owns image object URLs and ZIP export/import.

import * as store from './store.js';
import { fromMarkdown, toMarkdown, restaurantPath, mediaDir, imagesOf, RESTAURANT_DIR, MEDIA_DIR } from './model.js';
import { createZip, readZip } from './zip.js';
import { shrinkImage } from './images.js';

const restaurants = new Map(); // path → restaurant
const imageURLs = new Map(); // file path → object URL

export async function loadAll() {
  restaurants.clear();
  for (const rec of await store.listFiles(RESTAURANT_DIR)) {
    if (!rec.path.endsWith('.md')) continue;
    try {
      restaurants.set(rec.path, fromMarkdown(rec.path, new TextDecoder().decode(rec.bytes)));
    } catch (e) {
      console.warn('Could not read', rec.path, e);
    }
  }
}

export function all() {
  return [...restaurants.values()];
}

export function get(path) {
  return restaurants.get(path);
}

export function knownPeople() {
  const count = new Map();
  for (const r of restaurants.values()) for (const v of r.visits) for (const p of v.people) count.set(p, (count.get(p) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

export function knownTags() {
  return [...new Set(all().flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b));
}

// Saves a restaurant; a new one gets its file name (model.js: restaurantPath).
// With `rename` (after editing name, city or state), an existing one moves to
// the name that now fits; its images stay where they are, since the file
// refers to them by path. Returns the restaurant, with its path.
export async function save(r, { rename = false } = {}) {
  const old = r.path;
  if (!old || rename) r.path = restaurantPath(r, restaurants.keys());
  r.updated = new Date().toISOString();
  await store.writeFile(r.path, toMarkdown(r));
  if (old && old !== r.path) {
    await store.deleteFile(old);
    restaurants.delete(old);
  }
  restaurants.set(r.path, r);
  return r;
}

// Gives every restaurant whose file name doesn't follow the pattern yet the
// name that does (once, after the naming changed). Returns old → new paths.
// Two devices doing this at the same time end up with the same names (the
// same rule, in the same order), so sync sees the same files.
export async function renameAll() {
  const moved = new Map();
  // By name without .md, so taco-bell.md comes before taco-bell-2.md and keeps
  // the name without a number.
  const key = (r) => r.path.replace(/\.md$/, '');
  for (const r of [...restaurants.values()].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    const path = restaurantPath(r, restaurants.keys());
    if (path === r.path) continue;
    const old = r.path;
    const next = { ...r, path };
    await store.writeFile(path, toMarkdown(next));
    await store.deleteFile(old);
    restaurants.delete(old);
    restaurants.set(path, next);
    moved.set(old, path);
  }
  return moved;
}

export async function remove(r) {
  await store.deleteFile(r.path);
  await store.deletePrefix(mediaDir(r.path));
  // Images from before a rename are in the folder of the old name.
  for (const file of imagesOf(r)) await store.deleteFile(file);
  for (const file of imagesOf(r)) forgetImage(file);
  restaurants.delete(r.path);
}

// Stores an image for a restaurant (which must have been saved) and returns its path.
export async function addImage(r, file) {
  const blob = await shrinkImage(file);
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${mediaDir(r.path)}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  await store.writeFile(path, blob, blob.type);
  return path;
}

export async function deleteImage(file) {
  forgetImage(file);
  await store.deleteFile(file);
}

function forgetImage(file) {
  const url = imageURLs.get(file);
  if (url) URL.revokeObjectURL(url);
  imageURLs.delete(file);
}

export async function imageURL(file) {
  if (!file) return '';
  if (imageURLs.has(file)) return imageURLs.get(file);
  const blob = await store.readBlob(file);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  imageURLs.set(file, url);
  return url;
}

// --- export / import ---

export async function exportZip() {
  const records = await store.listFiles();
  const files = records.map((rec) => ({ path: rec.path, data: new Uint8Array(rec.bytes), date: new Date(rec.mtime) }));
  files.push({ path: 'README.md', data: README });
  return createZip(files);
}

// Merges a ZIP into the store: files with the same path are replaced.
// Accepts archives whose files sit inside one top folder (as Finder makes them).
export async function importZip(blob) {
  const entries = await readZip(blob);
  const known = [RESTAURANT_DIR, MEDIA_DIR];
  const top = entries.every((e) => known.some((k) => e.path.startsWith(k)) || e.path === 'README.md')
    ? ''
    : commonTopFolder(entries);
  let count = 0;
  for (const e of entries) {
    const path = e.path.slice(top.length);
    if (!known.some((k) => path.startsWith(k))) continue;
    forgetImage(path);
    await store.writeFile(path, e.bytes, store.guessType(path));
    if (path.startsWith(RESTAURANT_DIR) && path.endsWith('.md')) count++;
  }
  await loadAll();
  return count;
}

function commonTopFolder(entries) {
  const first = entries[0]?.path.split('/')[0];
  return first && entries.every((e) => e.path.startsWith(first + '/')) ? first + '/' : '';
}

export async function deleteEverything() {
  for (const file of imageURLs.keys()) forgetImage(file);
  await store.clearAll();
  restaurants.clear();
}

export async function storageEstimate() {
  const est = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted: !!persisted };
}

export async function requestPersistence() {
  return (await navigator.storage?.persist?.()) ?? false;
}

const README = `# Restaurant journal export

Each restaurant is one Markdown file in \`restaurants/\`. The YAML header holds
its details, visits, dishes and photos; the text below the header is your notes.
Images are in \`media/<restaurant>/\` and are referenced by path from the header.

You can edit these files with any text editor (or Obsidian) and import the ZIP
again: files with the same path are replaced, everything else is kept.
`;
