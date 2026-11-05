# Place search

When you add a restaurant, the app helps you find it so you don't have to type
the address. Everything here needs a connection; the rest of the app works
offline.

## OpenStreetMap (always on)

The app asks OpenStreetMap's [Nominatim](https://nominatim.org/) service
directly from the browser. The code is in [`app/js/places.js`](../app/js/places.js).

- **Nearby:** when the screen opens, it lists food places (restaurants, fast
  food, cafés, bakeries, pubs, bars, ice cream) within about 3 km of you,
  closest first. Typing filters this list on the device.
- **Places you've been:** restaurants with a visit in your journal are in the
  list too, marked "✓ Visited", even when OpenStreetMap doesn't have them.
  With your location, those within about 5 miles (8 km) sort in by distance;
  without it (or offline), all of them are listed, most recent visit first.
- **Search:** pressing Search looks the name up near you first (about 30 km),
  then anywhere.

Nominatim's [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
allows at most one request per second and no search-as-you-type, so the app
spaces its requests out and only searches Nominatim when you press Search.

## Foursquare (optional fallback)

OpenStreetMap misses some places. If the server has a Foursquare key, the app
also asks [Foursquare's Places API](https://docs.foursquare.com/fsq-developers-places/reference/place-search),
but only when OpenStreetMap has nothing:

- **After typing:** if nothing in the nearby list matches what you typed, and
  you stop typing for 1.5 seconds (at least 3 characters), the app asks
  Foursquare.
- **After Search:** if Nominatim finds nothing (or isn't reachable), the app
  asks Foursquare right away.

The results show "Not on OpenStreetMap. Results from Foursquare."

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
  Foursquare searches within 50 km of it.
- Results are turned into the same shape as OpenStreetMap results, so
  picking one fills in the same fields (name, address, city, state, country,
  phone, website, location and cuisine from Foursquare's categories).
- Some Foursquare places come with a location but no address. When you pick
  one, the app looks the address up from the location with Nominatim's
  reverse geocoding (one request) and fills in only the fields that are still
  empty. The form says the address came from OpenStreetMap, so you can check it.

### Privacy

With the key set, the text you search for and your rough location go through
the server to Foursquare when OpenStreetMap finds nothing. Settings → Place
search and maps says so when the fallback is on.
