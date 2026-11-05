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

## [2.2.1] - 2026-11-05

### Fixed

- The note line of 2.2.0 went into the Timeline's cards instead of the lists'
  and stopped the Timeline from showing.

## [2.2.0] - 2026-11-05

### Added

- On the Visited and To Try lists (and the map's place card), a place with
  notes shows their first line, in italics after a 📝, without Markdown marks.

## [2.1.0] - 2026-11-05

### Added

- Foursquare credit as its terms ask: the "Powered by Foursquare" logo
  (light or dark) under Foursquare results, a "View on Foursquare" link with
  each result, and on the page of a place picked from Foursquare, a link to
  its page there and the logo. Such places keep their Foursquare id
  (`foursquareId`).

## [2.0.1] - 2026-11-05

### Fixed

- Credits for the data the app shows: "Places © OpenStreetMap contributors"
  and/or "Places from Foursquare" under the place search results, the same
  credit next to an address looked up from a location, and "© OpenStreetMap
  contributors" (was "© OpenStreetMap") on the map.
- The browser now tells OpenStreetMap's map images and search which site is
  asking (only the site's address, not the page), as their usage policies ask
  of web apps (`Referrer-Policy: strict-origin-when-cross-origin`, was
  `same-origin`). Takes effect after restarting the server.

## [2.0.0] - 2026-11-05

A journal of any kind of place, not only restaurants.

### Changed

- **Restart the server when updating:** files are now in `places/` instead
  of `restaurants/`, which a server older than 2.0.0 refuses. The app moves
  existing files (giving them the type "Restaurant") when it starts, after
  the first sync, but only once the server runs 2.0.0; places added or
  renamed before then wait on the device until it does.
- Wording throughout the app is about places ("New place", "Add your first
  place", "Delete place"…).
- The place search lists breweries, museums and sights nearby too, and ranks
  actual places above streets and towns, not food places above everything.

### Added

- A **Type** for each place (Restaurant, Bar, Café, Brewery, Museum, Park,
  Attraction… or any text), filled in from the place search. Cards show the
  cuisine or category, or else the type; the place page shows both.
- For places that aren't for eating or drinking, "Cuisine" is called
  "Category" and the Dishes section is hidden (unless it has dishes).
- Importing a ZIP exported before 2.0.0 still works: each file replaces the
  place it was.

## [1.3.0] - 2026-11-05

### Changed

- Restaurant files are named `<STATE>-<city>-<name>.md`, e.g.
  `TN-newport-debbie-s-drive-inn.md`: the state's two-letter abbreviation,
  then city and name in lower case with other characters as `-`; `-2`, `-3`…
  when the name is taken. Existing files are renamed the first time the app
  starts after updating, and a file is renamed when you change the
  restaurant's name, city or state. Images stay where they are.

### Fixed

- Deleting a restaurant also deletes images kept outside its folder.

## [1.2.0] - 2026-11-05

### Added

- Adding a restaurant also lists the places on your To Try list, marked
  "On your to-try list", next to the ones you've visited.

### Changed

- Typing in the place search finds any restaurant in your journal by name,
  however far away; the 5-mile limit only applies to the list shown before
  you type.

## [1.1.1] - 2026-11-05

### Fixed

- Foursquare results that don't match the name you typed (a search for
  "The Dillard House" listed Waffle House and The Chop House nearby) are left
  out. With nothing left, the app says so and suggests adding the town.

## [1.1.0] - 2026-11-05

### Added

- Place search: add the town after a comma ("The Dillard House, Dillard GA")
  to find a restaurant somewhere else through Foursquare.
- When OpenStreetMap finds only streets or towns by that name, the app asks
  Foursquare for the restaurant too, and lists its results first.

### Fixed

- Adding a place to try searched Foursquare only within about 22 km
  (Foursquare's default without a radius) instead of everywhere; it now
  uses Foursquare's widest area, 100 km, or the town you name.

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
