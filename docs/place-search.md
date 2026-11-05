# Place search

When you add a place, the app helps you find it so you don't have to type
the address. Everything here needs a connection; the rest of the app works
offline.

## OpenStreetMap (always on)

The app asks OpenStreetMap's [Nominatim](https://nominatim.org/) service
directly from the browser. The code is in [`app/js/places.js`](../app/js/places.js).

- **Nearby:** when the screen opens, it lists places (restaurants, fast
  food, cafés, bakeries, pubs, bars, ice cream, breweries, museums and
  sights) within about 3 km of you,
  closest first. Typing filters this list on the device.
- **Your journal:** places you've visited ("✓ Visited") or want to try
  ("✓ On your to-try list") are in the list too, even when OpenStreetMap
  doesn't have them. Before you type: with your location, those within about
  5 miles (8 km) sort in by distance; without it (or offline), all of them,
  most recent first. Typing finds any of them by name, however far away.
  When adding a place to try, they only show once what you type matches.
- **Search:** pressing Search looks the name up near you first (about 30 km),
  then anywhere.
- **Places to try:** when the new place is one to try (added from the
  To Try tab, or with "I want to try this place" ticked), Search looks
  everywhere at once: places near you only rank higher, so a place in
  another city turns up too.

Nominatim's [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
allows at most one request per second and no search-as-you-type, so the app
spaces its requests out and only searches Nominatim when you press Search.

## Check in

The + on the Timeline is for checking in where you are: it lists the places
within about 600 m, closest first, from your journal and from OpenStreetMap
(the same kinds as above, first in that smaller area). Where there are fewer
than three that close, it also searches about 3 km around and lists the
nearest ten, saying that nothing is within 600 m. Tapping one records a visit for the current date and time
straight away and opens it, to add a rating, people and notes. Offline, it
lists the places in your journal only. "Not here? Search for a place" opens
the usual search. Pulling the list down (or the refresh button at the top)
looks again with a fresh location; the places OpenStreetMap knows are only
fetched again once you have moved about 100 m, or after 10 minutes.

## Credits

OpenStreetMap's data is under the [Open Database License](https://www.openstreetmap.org/copyright),
which asks for a credit wherever it is shown, and so do the usage policies of
Nominatim and the map images. Foursquare's terms ask for one for its places
too. The app shows:

- "© OpenStreetMap contributors" in the corner of the map,
- under the place search results, "Places © OpenStreetMap contributors"
  and/or the "Powered by Foursquare" logo (light or dark, from Foursquare's
  brand kit, served with the app), for the results on screen,
- with each Foursquare result, "View on Foursquare", a link to the place's
  page there (`https://foursquare.com/v/<id>`), as Foursquare's terms ask
  wherever its data is shown,
- on the page of a place picked from Foursquare results, the same link and
  logo (the place keeps `foursquareId`),
- next to an address looked up from a location, "© OpenStreetMap
  contributors".

The server sends `Referrer-Policy: strict-origin-when-cross-origin`, so the
browser tells OpenStreetMap's services the site's address (never the page), as
their policies ask web apps to; before 2.0.1 it sent nothing to other sites.

## Foursquare (optional fallback)

OpenStreetMap misses some places. If the server has a Foursquare key, the app
also asks [Foursquare's Places API](https://docs.foursquare.com/fsq-developers-places/reference/place-search),
but only when OpenStreetMap has nothing:

- **After typing:** if nothing in the nearby list matches what you typed, and
  you stop typing for 1.5 seconds (at least 3 characters), the app asks
  Foursquare.
- **After Search:** if Nominatim finds nothing (or isn't reachable), the app
  asks Foursquare right away. If Nominatim finds only streets or towns by
  that name (no actual place), it asks Foursquare too and lists its results
  first.
- **Somewhere else:** Foursquare has no worldwide search; it only looks
  around a place. Add the town after a comma ("The Dillard House, Dillard
  GA") and it searches in that town instead of around you. A town it can't
  place is ignored.

The results show "Not on OpenStreetMap. Results from Foursquare." Foursquare
also returns places that merely share a word with the search; the app keeps
only those whose name has every word you typed (apart from "the", "and" and
the like).

- **On request:** when Foursquare hasn't been asked about what you typed (at
  least 3 characters), a "Search Foursquare for …" button under the results
  adds Foursquare's results at the bottom of the list.

The same search is only sent once per visit to the screen.

### Turning it on

1. Create a Places API **service key** at
   [foursquare.com/developers](https://foursquare.com/developers/). Calls with
   the standard fields (name, address, location, categories, phone, website)
   are billed as "Pro" calls; check Foursquare's
   [pricing](https://foursquare.com/pricing/#places_api) for the free amount.
2. Put it in `.env` on the server and restart:

   ```
   FOURSQUARE_API_KEY=your-service-key
   ```

The server log then says "fallback place search through Foursquare is on".
Without the key the fallback is off and the app never mentions Foursquare.

### How it works

- The app never talks to Foursquare itself. It calls its own server at
  `GET /api/places/search?q=<text>&lat=<lat>&lon=<lon>`, and the server adds
  the key and passes the search on. The key never reaches the browser. Code:
  [`server/places.js`](../server/places.js).
- Only signed-in users can use it, and each gets at most 60 searches an hour,
  so nobody else can run up the bill.
- `GET /api/auth/me` answers `fallbackSearch: true` when the fallback is
  available to the signed-in user; that is how the app knows to use it.
- The location is rounded to about 100 m before it leaves the server.
  Foursquare searches within 50 km of it; for a place to try
  (`anywhere=1`) within 100 km, the most it allows (without a radius it
  would use 22 km). With `near=<town>` (the text after a comma) it searches
  in that town instead, without the location.
- Results are turned into the same shape as OpenStreetMap results, so
  picking one fills in the same fields (name, address, city, state, country,
  phone, website, location and cuisine from Foursquare's categories).
- Some Foursquare places come with a location but no address. When you pick
  one, the app looks the address up from the location with Nominatim's
  reverse geocoding (one request) and fills in only the fields that are still
  empty. The form says the address came from OpenStreetMap (with its credit),
  so you can check it.

### Privacy

With the key set, the text you search for and your rough location go through
the server to Foursquare when OpenStreetMap finds nothing. Settings → Place
search and maps says so when the fallback is on.
