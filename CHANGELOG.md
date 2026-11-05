# Changelog

What changed in each release of Bite-Stamped. The version is shown at the
bottom of Settings.

Versions follow [semantic versioning](https://semver.org/) (MAJOR.MINOR.PATCH):

- **MAJOR** when something you have no longer works without you doing
  something: the data format, sync between devices, or the server's settings
  change in a way older copies can't follow.
- **MINOR** for new features that work with what you have (server database
  changes that apply themselves on restart count here).
- **PATCH** for fixes and small adjustments that add nothing new.

Every release gets an entry here, server-only ones too. Newest first; the
format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-11-05

The first release numbered with semantic versioning. The app is the same as
release 27; the releases before it are summed up below.

### Changed

- Versions are now MAJOR.MINOR.PATCH, and this changelog lists what each
  release changes.

## Releases before 1.0.0

Numbered 1 to 27, without a changelog; the details are in the git history.

### 2026-11-05 (releases 21–27)

- **Timeline** tab: every visit, newest first, under a heading per day.
  **Visited** tab: the restaurant list, sorted by name. Back from a
  restaurant returns to the list it was opened from.
- Place search lists restaurants you've visited within about 5 miles
  (all of them, by most recent visit, without a location or offline).
- A "Search Foursquare for …" button under the place search results.
- **Calendar feed** of visits through a private link (Settings → Calendar),
  with visit times in the time zone of the device that made the link, as
  moments rather than hour-long events.
- Adding a place to try: Search looks everywhere, not just nearby, and
  restaurants already in the journal only show when they match the search.

### 2026-11-04 (releases up to 20)

- New restaurants start from food places nearby; places already in the
  journal are marked, with the choice to add a visit.
- Bottom bar with Journal (now Timeline), To Try and Settings; sorting, map
  and add buttons on the lists.
- App updates apply right away; the version and release date show in
  Settings; Safari picks up new releases.
- Accessibility fixes (contrast, focus, star ratings by keyboard).
- Visits have a time as well as a date; To Try sorts by Nearest; the place
  search opens with the keyboard ready on phones.
- Optional Foursquare fallback when OpenStreetMap finds no place, through
  the server; addresses looked up for places that only have a location.
- New restaurants added from the Journal get a visit for now.
- Directions and sharing from a restaurant page (Apple Maps, Google Maps,
  Waze, the share sheet).
- Documentation moved into `docs/`.

### 2026-11-03

- Offline restaurant journal: restaurants, visits, dishes and photos,
  stored as Markdown with YAML headers; export and import as a ZIP.
- Converter from the Eatlist app's data.
- Offline-first sync through a self-hosted Node server, with every version
  of every file kept.
- Can be served below a path of an existing site (`BASE_PATH`).
