# Eats – restaurant journal

A private restaurant journal that runs in the browser, installs on a phone's
Home Screen and works offline. Plain HTML, CSS and JavaScript: no frameworks,
no build step, no dependencies.

- Restaurants with rating, "to try" flag, cuisine, address, website, phone, tags
  and Markdown notes
- Visits with date, rating, people and notes
- Dishes with rating, price, notes and an image
- Photos with a title and date; any photo can be the cover
- Place search through OpenStreetMap (online only; everything else works offline)
- Export and import as a ZIP of Markdown files

## Data format

Each restaurant is one Markdown file with a YAML header. Images sit next to
them in `media/`:

```
restaurants/trattoria-da-luca.md
media/trattoria-da-luca/mw0ryxwb-oxql.jpg
```

```markdown
---
name: Trattoria da Luca
rating: 5
cuisine: Italian
city: Knoxville
tags:
- date night
visits:
- date: 2026-10-12
  rating: 5
  people:
  - Anna
  notes: Anniversary dinner
dishes:
- name: Cacio e pepe
  rating: 5
  price: $19
  image: media/trattoria-da-luca/mw0rzrfs-oaod.jpg
photos:
- file: media/trattoria-da-luca/mw0ryxwb-oxql.jpg
  title: "Patio: table #4, golden hour"
  date: 2026-10-12
---

Ask for the **cacio e pepe**.
```

On the device the files live in the browser's IndexedDB, so they are there
offline. **Settings → Export ZIP** gives you the real files; edit them with any
editor (Obsidian works well) and **Import ZIP** them again. Files with the same
path are replaced, everything else is kept.

## Run locally

Needs Node.js 22 or newer for the tests (the server runs on 20).

```bash
npm start          # http://localhost:8080 (PORT=… to change)
npm test           # YAML, model and ZIP tests (node --test)
npm run icons      # redraw the icons in icons/
```

## Bring over data from Eatlist

On a Mac with the Eatlist app installed (and synced from iCloud):

```bash
npm run import-eatlist                # writes ~/Downloads/eatlist-for-eats-<date>.zip
```

Then import that ZIP in the app (Settings → Import ZIP). The script only reads
a copy of Eatlist's database. The ZIP holds your personal data: keep it out of
this public repo (`*.zip` is git-ignored).

## Install on a phone

Installing and offline mode need HTTPS, so the app has to be hosted. Any static
host works; the app is just these files (leave out `scripts/`, `test/`).
GitHub Pages, Cloudflare Pages or Netlify are free options.

Then on the iPhone: open the URL in Safari → Share → **Add to Home Screen**.
Open it once while online; after that it works offline. In Settings, tap
**Ask to keep data permanently**, and export a ZIP now and then as a backup;
the data lives only on that device.

After changing files, bump `VERSION` in `sw.js` (and add new files to its
list) so installed copies pick up the update.
