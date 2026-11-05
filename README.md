# Bite-Stamped – a journal of places

A private journal of the places you go – restaurants, bars, breweries,
museums, sights, anything – that runs in the browser, installs on a phone's
Home Screen and works offline. Signed-in devices sync with each other through
a small server you host yourself, which also keeps every version of every file
as a backup. Plain HTML, CSS and JavaScript plus Node.js: no frameworks, no
build step, no dependencies at all.

## Features

- Places of any type (restaurant, bar, museum, park…) with rating, "to try"
  flag, cuisine or category, address, website, phone, tags and Markdown notes
- Visits with date, rating, people and notes; **check in** from the Timeline
  with one tap on a place right around you
- Dishes with rating, price, notes and an image (for places to eat and drink)
- Photos with a title and date; any photo can be the cover
- A "Timeline" of every visit by day, plus "Visited" and "To Try" lists, sorted by name, last visit, rating, visits, date
  added or distance, or shown on a map (OpenStreetMap)
- Adding a place lists places nearby (food and drink, museums, sights) and [searches by name](docs/place-search.md)
  through OpenStreetMap, with Foursquare as an optional fallback (online only,
  like the map images; everything else works offline)
- Offline-first [sync](docs/sync.md) between devices, after signing in with an
  emailed code; conflicting edits are merged
- Your visits as a [calendar feed](docs/calendar.md) to subscribe to in Apple
  Calendar, Google Calendar or Outlook, through a private link
- [Storage and backup](docs/storage-and-backups.md) on your server: every
  version of every file is kept
- Export and import as a ZIP of Markdown files with YAML headers
  ([data format](docs/data-format.md))
- [Bring over your data from Eatlist](docs/import-from-eatlist.md) (on a Mac):
  restaurants, visits, people, dishes and photos, as a ZIP to import

## Run the server

Needs Node.js 22.13 or newer (it uses the built-in `node:sqlite`).

```bash
git clone https://github.com/mckeehan/bite-stamped.git
cd bite-stamped
cp .env.example .env      # then edit .env
npm start                 # http://127.0.0.1:8080
npm test                  # all tests, including two devices syncing
```

Settings (in `.env` or the environment):

| Variable | Meaning |
|---|---|
| `PORT`, `HOST` | Where to listen. Default `8080` on `127.0.0.1`; use `0.0.0.0` to reach it from other devices without a proxy. |
| `DATA_DIR` | Where the data goes. Default `./data`. Back it up; see [what is in it](docs/storage-and-backups.md#what-is-in-data_dir). |
| `ALLOWED_EMAILS` | Comma-separated addresses that may sign in. Removing an address ends its sessions. |
| `SMTP_URL`, `MAIL_FROM` | Email for sign-in codes: `smtps://user:pass@host:465` (TLS) or `smtp://user:pass@host:587` (STARTTLS). URL-encode `@` in user names as `%40`. Without `SMTP_URL`, codes are printed in the server log. |
| `TRUST_PROXY` | `1` behind a reverse proxy, so the server sees the real `https://` address and client IPs. |
| `BASE_PATH` | Serve the app below a path of an existing site, e.g. `/bites` for `https://example.com/bites/`. The proxy must pass the full path through ([Apache example](docs/https.md#below-a-path-of-an-existing-apache-site)). Default: the site root. |
| `FOURSQUARE_API_KEY` | Optional. Turns on a [fallback place search](docs/place-search.md) through Foursquare when OpenStreetMap finds nothing. The key stays on the server. |

For Gmail, use an [app password](https://support.google.com/accounts/answer/185833)
with `smtps://you%40gmail.com:app-password@smtp.gmail.com:465`.

### HTTPS (needed on the phone)

Installing the app and offline mode need HTTPS. Setups with Tailscale, Caddy,
or below a path of an existing Apache site: [docs/https.md](docs/https.md).

### Run it as a service

Examples for Linux (systemd) and macOS (launchd):
[docs/run-as-a-service.md](docs/run-as-a-service.md).

### Update

To update: `git pull`, then restart the service
([how](docs/run-as-a-service.md#restart-after-an-update)). What changed in each release is in
[CHANGELOG.md](CHANGELOG.md).

To make a release: raise the [semantic version](CHANGELOG.md) and the date in
`app/js/version.js` (shown at the bottom of Settings), put the same version
in `VERSION` in `app/sw.js` and in `package.json`, add an entry at the top of
CHANGELOG.md (`npm test` checks all of these match), and add new files to the
list in `app/sw.js`, so installed copies update. They pick up the new version the next time they are
opened or brought to the front, and reload into it as soon as nothing is being
edited.
