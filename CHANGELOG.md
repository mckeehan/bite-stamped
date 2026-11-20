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

The commit of each release is tagged in git with its version, `vX.Y.Z`
(e.g. `git checkout v2.7.1`). Versions released together with a later one,
without a commit of their own (1.1.0, 1.1.1, 2.0.1, 2.2.0, 2.3.0, 2.4.0,
2.12.1), have no tag.

## [2.27.0] - 2026-11-20

### Changed

- Properties of a place file that the app doesn't use, such as Obsidian's
  `aliases`, `cssclasses` or links like `related: "[[Other place]]"`, are kept
  when the place is saved in the app (they used to be dropped) and through
  sync. An empty property stays as `key:`, the way Obsidian writes it. See
  docs/data-format.md.
- `created` and `updated` are written as local date and time to the second
  (`2026-11-20T07:54:09`), which Obsidian shows and edits as a date & time.
  They were UTC with milliseconds (`2026-11-20T12:54:09.123Z`), which
  Obsidian shows as text. Older files are read the same way, as the same
  moment in local time, and are written in the new form the next time the
  place is saved.

## [2.26.1] - 2026-11-19

### Fixed

- No empty space above the Timeline's calendar where the search box was.

## [2.26.0] - 2026-11-16

### Changed

- Type and Cuisine (or Category) on the place form suggest what your journal
  already has, as buttons under the field, narrowed as you type: values
  starting with what's typed first, the most used first, with how many places
  have each. Cuisine takes several values separated by commas, so it
  suggests for the one being typed and leaves out those already there; it
  suggests cuisines of places to eat for a place to eat, and categories of
  the others for the rest. Type also offers the usual types not used yet.
  (Type's suggestions were the phone's own list before, which doesn't
  narrow well on an iPhone.)

## [2.25.0] - 2026-11-16

### Changed

- The Timeline's calendar works like the month view in Apple's Calendar:
  tapping a day (any day, with visits or not) picks it and lists its visits
  under the month, earliest first. Tapping a visit opens the place; coming
  back keeps the day picked. "Show in the timeline" jumps to that day in
  the list. The calendar opens on today; another month opens on its first
  day with visits.
- The dots under each day are colored by the kind of place visited: food,
  coffee & sweets, drinks, outdoors, things to do, travel, or shops & other.
  A key under the month names the colors used in it.
- The calendar has no search box: it always shows every visit. The search
  is still there in the Timeline's list.

## [2.24.0] - 2026-11-15

### Added
- The Timeline can be shown as a month calendar (the button at the top,
  where the map button was): each day with a dot per visit (up to three),
  today circled. Tapping a day shows the timeline from that day. Change
  months with the arrows or by swiping; "Today" goes back to this month.
  A search narrows the calendar too (e.g. `with:anna`).

### Removed
- The Timeline's map view (Visited and To Try still have theirs).

## [2.23.0] - 2026-11-15

### Added
- The edit form has a **Location** field (latitude, longitude) to correct a
  place's location: type or paste it (e.g. `35.0737, -85.0931`, or a Google
  Maps link), or press **From the address** to look it up again. Links under
  it show the location in Apple Maps or Google Maps.

### Changed
- When OpenStreetMap only knows the street of an address (no house
  numbers there), the app says the location is somewhere along the street
  instead of quietly putting the pin there.

## [2.22.0] - 2026-11-15

### Added
- Saving a place with an address but no location, or with a changed
  address, looks the address up on OpenStreetMap and puts the place on the
  map. On the map, the note "N without a location are not on the map"
  offers to find the ones that already have an address.

## [2.21.0] - 2026-11-15

### Added
- The map stays where you panned and zoomed it: after opening a place, or
  going to another tab and back, each list's map (Timeline, Visited, To
  Try) is as you left it. Switching to the list forgets it, so the map
  starts around you (or your latest place) again.

## [2.20.0] - 2026-11-15

### Added
- Zoomed out, places close together on the map become one circle with
  their number; tapping it zooms in until its places fit. Circles never
  sit on top of each other. From the zoom where names show, every place
  has its own pin again.

### Changed
- The map draws only the pins and circles on screen, so moving it stays
  quick with thousands of places.

## [2.19.0] - 2026-11-15

### Added
- The map shows the names of places next to their pins once you zoom in
  to about a neighbourhood across. Where names would cover each other,
  the selected place's name comes first, then the others in the list's
  order; zooming in further makes room for more. Names near the right
  edge go to the left of their pin.

## [2.18.0] - 2026-11-15

### Added
- Place files edited on the server, in `DATA_DIR/files/places/`, sync to
  your devices: before each sync (and when it starts) the server turns a
  changed, new or deleted `.md` file there into a change like one from a
  device, kept as a new version. A file without a YAML header or a name is
  not synced, and the server log says why. See
  [docs/storage-and-backups.md](docs/storage-and-backups.md#editing-place-files-on-the-server).

### Changed
- Place files in `files/` are copies of their versions, not hard links,
  so an editor saving into a file can't change the saved history. The
  server makes the copies when it starts (a database change that applies
  itself; restart it after updating).

## [2.17.0] - 2026-11-14

### Added
- Checking in lists every named business and place to visit within about
  600 m (shops, banks, churches, offices, doctors, petrol stations, parks…),
  not just places to eat and drink and sights. They come from
  OpenStreetMap's Overpass API in one request and join the list when they
  arrive, so the list shows up as quickly as before. Checking in at one of
  them looks up its town first. The server allows the app to reach
  `overpass-api.de` (restart it after updating).

### Fixed
- The check-in screen no longer moves the search box down when there are
  few or no places to show: everything stays at the top.
- When nothing on the check-in screen matches what you type, it says what
  the list has (the places within about 600 m, and those in your journal)
  and that Search looks for any kind of place within about 20 miles; the
  link under the list reads "Not listed? Search for “…” within about 20
  miles".

## [2.16.1] - 2026-11-14

### Fixed
- Searching when checking in or adding a place: places in your journal no
  longer come above the search results however far away they are. Places
  are shown closest first, wherever they came from (a place you have been
  13 miles away no longer goes above the one you are standing at); streets
  and towns still come after places.

## [2.16.0] - 2026-11-13

### Added

- **Find and merge duplicate places:** Settings → Find duplicate places
  lists pairs that look like the same place twice: the same street address
  ("Pkwy" and "Parkway" alike) with a similar name or the same kind of
  place, or the same or a similar name close by. **Merge…** keeps the name
  and details of the one you choose and moves the other's visits, dishes,
  photos, tags and notes to it (the same visit only once); missing details
  are filled in from the other. **Not the same** leaves a pair out on that
  device. See docs/duplicates.md.

## [2.15.0] - 2026-11-12

### Added

- **Search in one field** on the Timeline, Visited and To Try:
  `tag:brunch`, `with:anna`, `city:`, `state:`, `type:`, `cuisine:`, `dish:`,
  `name:` look only there, matching part of the value
  (`tag:night` finds "Date night"). After typing `tag:` (or another field),
  the tags of the places on that tab show under the box, narrowing as you
  type; tap one to search for it. With the box empty, the fields are
  suggested. Plain words still search everything, now also ignoring accents,
  and `"quoted words"` are found together. See docs/search.md.

## [2.14.0] - 2026-11-12

### Added

- The search boxes (Timeline, Visited and To Try; Check in; New place) have
  an × at the right while there is text in them. Tapping it empties the box
  and the list goes back to what it showed before you typed. The keyboard
  stays up if it was up.

## [2.13.0] - 2026-11-11

### Added

- Settings → Appearance: Light, Dark or Follow device (the default, as
  before). The choice is kept on each device, not synced, and applies as the
  app opens, without a flash of the other theme. The browser's bar colour
  and the Foursquare logo follow the chosen theme too.

## [2.12.1] - 2026-11-11

### Changed

- New colours: red (#bd081c), black (#111111) and white, instead of orange
  on cream. The light theme has a white page, black text and red buttons and
  links; the dark theme a #111 page, white text and a lighter red (#bd081c
  is too dark to read on black). Stars are red too, and Delete buttons a
  darker red than Save. All text keeps at least 4.5:1 contrast.
- The app icon is red instead of orange. On an iPhone the home screen keeps
  the old icon until the app is added to it again.

## [2.12.0] - 2026-11-08

### Added

- Opening an offline check-in shows where you were when you saved it:
  "Where you were: Apple Maps · Google Maps" opens that spot (its saved
  location) in either map app, to see what was there. Not shown for a
  check-in saved without a location.

## [2.11.0] - 2026-11-08

### Changed

- The visit sheet has an X in the top right instead of Cancel, and its
  button at the bottom, full width: "Add to Journal" for a new visit. An
  existing visit has "Delete" and "Update" side by side there (Delete was a
  link at the end).
- **The X takes a check-in back.** Checking in records the visit at once, so
  Cancel used to leave it in the journal. Now the X removes that visit (and
  the place, if the check-in added it; a place to try goes back on the list)
  and returns to the Timeline. Tapping outside the sheet no longer closes a
  check-in's sheet by mistake. For any other visit the X closes the sheet
  without saving, as Cancel did.

### Fixed

- On an iPhone, the date and time fields of a visit were uneven, and the
  time ran off the right edge. They are now two equal halves.

## [2.10.0] - 2026-11-06

### Added

- **Offline check-ins.** When the place search can't be reached while
  checking in (no connection, server or OpenStreetMap down), "Save offline
  check-in" keeps what you typed, where you are and the time. The Timeline
  then shows a button, "1 offline check-in to finish"; opening one once you
  are back online searches for what you typed around where you were, and the
  visit you add gets the time you saved it, not the time you finish it. They
  stay on the device that saved them (not synced) until finished or deleted.

## [2.9.0] - 2026-11-06

### Changed

- The map (Timeline, Visited, To Try) opens close in, a few miles across,
  around where you are, instead of zoomed out to show every place. Until
  your location is known (or without it), it opens around the place you
  visited or added most recently. When the places shown are close together
  anyway (after a search, say), it still shows them all. The map asks for
  your location when it opens, the same as "Nearest" does.

## [2.8.2] - 2026-11-06

### Changed

- The Visited tab's icon matches the app icon, a map pin with a check mark
  in a dashed stamp ring, instead of a fork and knife.

## [2.8.1] - 2026-11-06

### Changed

- Calendar feed: the link to the place in an event's notes is a Markdown
  link, `[details](<link>)`, so apps that show Markdown display "details".
  The event's URL stays the plain link. Takes effect after restarting the
  server; calendar apps pick it up on their next refresh.

## [2.8.0] - 2026-11-06

### Added

- Signing in shows what is happening: the button says "Sending code…" and
  then "Signing in…", and as soon as the code is accepted Settings shows you
  signed in, with the first sync under way: "Downloading your journal… 350
  of 2,056" and a progress bar. (Before, the button just stayed grey
  until the whole journal had downloaded.) Later syncs show what they are
  doing too (uploading, downloading).
- The server says how many changes are left to download (`remaining` in
  `/api/changes`), for the progress bar. Takes effect after restarting the
  server; until then the app counts the files without a bar.

## [2.7.2] - 2026-11-06

### Changed

- A new app icon for a journal of any kind of place: a map pin with a check
  mark in a round, dashed stamp (places you have been, stamped like a
  passport) instead of a plate with fork and knife. Same orange. On an
  iPhone the home screen keeps the old icon until the app is added to it
  again.

## [2.7.1] - 2026-11-06

### Fixed

- The Timeline was slow to appear with a long history (thousands of visits):
  it drew every visit at once. The lists (Timeline, Visited, To Try) now draw
  the first 50 cards at once and more as you scroll towards the end; with
  13,000 visits the Timeline appears in a fraction of the time. Starting the
  app no longer reads the stored images just to find the places.

## [2.7.0] - 2026-11-06

### Changed

- On the Timeline, Visited and To Try, a place without a photo shows a
  symbol for its kind instead of its first letter: 🌮 for a Mexican
  restaurant, 🍕 for a pizzeria, ☕ for a café, ⛽ for a fuel station, 🥾 for a
  hiking trail, 🏨 for a hotel, and so on (from its type, and for restaurants
  their cuisine; 🍽️ for other places to eat, 📍 for the rest). The symbol also
  shows when a photo can't be loaded.

## [2.6.0] - 2026-11-06

### Added

- `tools/foursquare-import`: turns a Foursquare / Swarm data export into a
  ZIP to import: a place per venue, a visit per check-in (with what you wrote),
  places to try from your lists, tips and photos. Check-ins at places you
  already have become visits there, without repeating visits you already
  have. Addresses and kinds of place come from Foursquare (with the server's
  key) or OpenStreetMap, cached. `npm run import-foursquare -- --help`.
  The app itself is unchanged.

## [2.5.0] - 2026-11-06

### Added

- Check in has a search box at the top, ready without tapping "Not here?":
  typing narrows the list to the places whose name matches (from your
  journal, however far, and those OpenStreetMap found around you); Search
  opens the usual place search with what you typed, already searching.

## [2.4.1] - 2026-11-05

### Fixed

- Check in only listed places from your journal where OpenStreetMap has
  nothing within about 600 m (it only looked that far, so the nearest places
  were all your own). Now it looks about 3 km around when there are fewer
  than three places that close, lists the nearest ten, and says so.

## [2.4.0] - 2026-11-05

### Added

- Check in: pull the list down (or tap the refresh button at the top) to look
  again, with a fresh location, for when you have moved or the list is stale.

## [2.3.0] - 2026-11-05

### Added

- **Check in** from the Timeline: its + lists the places right around you
  (within about 600 m, closest first; places in your journal and places
  OpenStreetMap knows). Tapping one records a visit for now, at once, and
  opens it to add a rating, people and notes; a new place is added to the
  journal, a place to try counts as visited. "Not here? Search for a place"
  leads to the usual search. The + on Visited and To Try still adds a place.

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
