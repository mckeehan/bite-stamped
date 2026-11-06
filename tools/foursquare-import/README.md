# Import from Foursquare (Swarm)

Turns your Foursquare / Swarm data export into a ZIP that Bite-Stamped
imports (Settings → Import ZIP):

- each **venue** you checked in at becomes a place, each **check-in** a visit
  (at the local time of the check-in; check-ins at the same place less than
  an hour apart count as one visit), and what you wrote with it (the
  "shout") becomes the visit's notes
- venues on your **lists** (e.g. "Wishlist") that you never checked in at
  become places to try
- your **tips** go into the place's notes, and your **photos** go with the
  place you checked in at just before taking them
- places get their Foursquare id, so the app links to their Foursquare page

## Get your export

In the Foursquare or Swarm app or on foursquare.com: Settings → Privacy →
Request your data (or "Download your data"). Foursquare emails a link to a
ZIP; download it. Unpacking it is optional.

## Run it

From the repository's folder, with Node.js 22 or newer:

1. In Bite-Stamped, let the app sync, then **Settings → Export ZIP**. The
   import reads it to find the places you already have.
2. Convert:

   ```bash
   npm run import-foursquare -- ~/Downloads/data-export-12345678.zip --journal ~/Downloads/bite-stamped-export.zip
   ```

   On the server you can give its files folder instead of an export:
   `--journal data/files`. It is only read.
3. In Bite-Stamped: **Settings → Import ZIP**, and pick the file it wrote
   (`~/Downloads/foursquare-for-bite-stamped-<date>.zip`). Do this soon after
   step 1, on a device that has synced: the ZIP has the whole new version of
   each place it touches, and the import replaces that file on the device.

Add `--dry-run` first to see the numbers (venues, check-ins, lookups) without
looking anything up or writing anything.

## Places you already have

The export only has each venue's name and where you were when you checked in,
so a place in your journal is recognised by its Foursquare id or by a similar
name within 250 m (as the app's place search does). For those:

- check-ins become visits there; a check-in within two hours of a visit you
  already have (or on the same day, for a visit without a time) is that
  visit, and only adds its text if the visit had none
- missing details (address, phone…) are filled in; nothing you wrote changes
- a place to try that you checked in at after adding it counts as visited

Running the import again (with a fresh export of your journal) adds nothing
twice; places with nothing new aren't in the ZIP.

## Addresses and kinds of place

Without them, places are only named (`starbucks.md` rather than
`TN-knoxville-starbucks.md`) and have no type. `--lookup` says where they come
from:

- **foursquare** (the default when `FOURSQUARE_API_KEY` is set, e.g. in
  `.env`, as for the server's [place search](../../docs/place-search.md)):
  Foursquare's place details, by the venue's id: address, town, state,
  kind of place, phone, website, and whether it has closed (tag `closed`).
  One call per venue, which Foursquare bills as a "Pro" call; check its
  [pricing](https://foursquare.com/pricing/#places_api) for the free amount.
  `--dry-run` says how many calls a run needs. Venues Foursquare doesn't know
  any more are looked up on OpenStreetMap.
- **nominatim** (the default otherwise): OpenStreetMap's address at the spot
  where you checked in. Free, but address only, and one venue a second (its
  usage policy), so a long history takes a while; it can be interrupted and
  run again.
- **none**: names only.

Answers are kept in `tools/foursquare-import/.cache/venues.json` (not in git:
it shows where you have been), so a second run asks nothing again.

## Choosing what to import

A check-in history has many places that aren't for a journal (work, petrol
stations, shops):

- `--food`: only places to eat and drink (needs a lookup to know the kind)
- `--min-checkins 2`: only places you went to more than once
- `--since 2020-01-01`: only check-ins from that day on
- `--lists Wishlist` or `--no-lists`: which lists become places to try

`npm run import-foursquare -- --help` lists all options.

## What is left out

Check-ins without a venue, comments, likes, "visits" Swarm detected on its own
(`visits.json`, `unconfirmed_visits.json`), friends and account data.
