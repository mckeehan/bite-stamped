# Bite-Stamped – restaurant journal

A private restaurant journal that runs in the browser, installs on a phone's
Home Screen and works offline. Signed-in devices sync with each other through
a small server you host yourself, which also keeps every version of every file
as a backup. Plain HTML, CSS and JavaScript plus Node.js: no frameworks, no
build step, no dependencies at all.

- Restaurants with rating, "to try" flag, cuisine, address, website, phone, tags
  and Markdown notes
- Visits with date, rating, people and notes
- Dishes with rating, price, notes and an image
- Photos with a title and date; any photo can be the cover
- "Journal" and "To Try" lists, sorted by last visit, rating, visits, name, date
  added or distance, or shown on a map (OpenStreetMap)
- Adding a place lists food places nearby and searches by name through
  OpenStreetMap (online only, like the map images; everything else works offline)
- Sync between devices and server backup, after signing in with an emailed code
- Export and import as a ZIP of Markdown files

## Data format

Each restaurant is one Markdown file with a YAML header, with its images in
`media/`; export and import use the same files. Details and an example:
[docs/data-format.md](docs/data-format.md).

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
| `DATA_DIR` | Where the data goes. Default `./data`. |
| `ALLOWED_EMAILS` | Comma-separated addresses that may sign in. Removing an address ends its sessions. |
| `SMTP_URL`, `MAIL_FROM` | Email for sign-in codes: `smtps://user:pass@host:465` (TLS) or `smtp://user:pass@host:587` (STARTTLS). URL-encode `@` in user names as `%40`. Without `SMTP_URL`, codes are printed in the server log. |
| `TRUST_PROXY` | `1` behind a reverse proxy, so the server sees the real `https://` address and client IPs. |
| `BASE_PATH` | Serve the app below a path of an existing site, e.g. `/bites` for `https://example.com/bites/`. The proxy must pass the full path through. Default: the site root. |

For Gmail, use an [app password](https://support.google.com/accounts/answer/185833)
with `smtps://you%40gmail.com:app-password@smtp.gmail.com:465`.

### What is in `DATA_DIR`

```
bite-stamped.sqlite      file index, change counter, login codes, sessions
versions/<path>/<rev>    every version of every file: the backup history
files/<path>             the current Markdown and images as plain files
```

Back up the whole folder (with the server stopped, or use
`sqlite3 bite-stamped.sqlite ".backup copy.sqlite"` for the database). `files/` is a
convenient read-only view: edits made there are not synced; use Export/Import
in the app for that. Deleting something in the app only marks it deleted, so
its versions stay in `versions/`. How the history works, what it does and
doesn't protect against, and how to restore an old version:
[docs/storage-and-backups.md](docs/storage-and-backups.md).

### HTTPS (needed on the phone)

Installing the app and offline mode need HTTPS. Two easy ways:

- **Tailscale** (private, no open ports): on the server,
  `tailscale serve --bg 8080`. The app is then at
  `https://<machine>.<tailnet>.ts.net` for your devices on Tailscale.
- **Caddy** (public, automatic certificates): a `Caddyfile` with
  ```
  bite-stamped.example.com {
    reverse_proxy 127.0.0.1:8080
  }
  ```

Set `TRUST_PROXY=1` in both cases.

### Below a path of an existing Apache site

For example `https://www.example.com/bites/`. In `.env`:

```
HOST=127.0.0.1
PORT=8080
TRUST_PROXY=1
BASE_PATH=/bites
```

In the site's existing `<VirtualHost *:443>` block (needs `mod_proxy`,
`mod_proxy_http` and `mod_headers`; on Debian/Ubuntu
`sudo a2enmod proxy proxy_http headers`):

```apache
RedirectMatch 301 ^/bites$ /bites/
<Location "/bites/">
    ProxyPass        "http://127.0.0.1:8080/bites/"
    ProxyPassReverse "http://127.0.0.1:8080/bites/"
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # Only Apache's own forwarding headers should reach the app.
    RequestHeader unset X-Forwarded-For
    RequestHeader unset X-Forwarded-Host
</Location>
```

Then `sudo apachectl configtest` and reload Apache. Everything stays below
`/bites/`: the pages, the API (`/bites/api/`), the session cookie and the
offline cache. Note that the app then shares its origin with the rest of the
site: scripts on other pages of that site could read its local data and use
its API. That is fine for a site you control; otherwise give the app its own
subdomain.

### Run it as a service

Examples for Linux (systemd) and macOS (launchd):
[docs/run-as-a-service.md](docs/run-as-a-service.md).

### Update

To update: `git pull`, then restart the service
([how](docs/run-as-a-service.md#restart-after-an-update)). With every change to the
app, raise the version and date in `app/js/version.js` (shown at the bottom
of Settings) and the same version in `VERSION` in `app/sw.js` (`npm test`
checks they match), and add new files to the list in `app/sw.js`, so
installed copies update. They pick up the new version the next time they are
opened or brought to the front, and reload into it as soon as nothing is being
edited.

## How offline-first sync works

- Every device keeps the full journal in the browser's IndexedDB. The app only
  ever reads and writes that copy, so it works the same with or without a
  connection.
- Each local file remembers the server version it is based on and whether it
  changed since. When the device is online and signed in, it uploads its
  changes (`PUT` with `If-Match`), then asks the server for everything that
  changed since its last sync (a change counter).
- If a file changed elsewhere first, the server answers 409 and the device
  merges both versions of the restaurant (visits, dishes, photos and tags are
  combined; single values keep this device's edit) and uploads the merge. An
  edit wins over a deletion.
- Each server's data has a random id. If a device meets a different one (a new
  or restored server), it uploads its whole copy again, merging with what is
  there, and downloads everything.
- Sync runs after each change (after 1.5 s), when the app comes back online or
  to the foreground, and every 5 minutes while it is open.

Sign-in: only addresses in `ALLOWED_EMAILS` get a code (valid 10 minutes, five
tries). A correct code sets an HttpOnly session cookie for a year. Writes also
need an `X-Bite-Stamped` header from the same origin; sign-in requests are limited per
client address; responses carry a strict Content Security Policy.

## Bring over data from Eatlist

On a Mac with the Eatlist app installed (and synced from iCloud):

```bash
npm run import-eatlist                # writes ~/Downloads/eatlist-for-bite-stamped-<date>.zip
```

Then import that ZIP in the app (Settings → Import ZIP); it syncs from there.
The script only reads a copy of Eatlist's database. The ZIP holds your
personal data: keep it out of this public repo (`*.zip` is git-ignored).
