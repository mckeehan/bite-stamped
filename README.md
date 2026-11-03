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
- Place search through OpenStreetMap (online only; everything else works offline)
- Sync between devices and server backup, after signing in with an emailed code
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

**Settings → Export ZIP** gives you the files from a device; edit them with
any editor (Obsidian works well) and **Import ZIP** them again. Files with the
same path are replaced, everything else is kept (and then synced).

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
its versions stay in `versions/`.

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

### Run it as a service

**Linux (systemd)** – `/etc/systemd/system/bite-stamped.service`:

```ini
[Unit]
Description=Bite-Stamped restaurant journal
After=network-online.target

[Service]
User=bite-stamped
WorkingDirectory=/opt/bite-stamped
ExecStart=/usr/bin/node --env-file=.env --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/bite-stamped/data

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now bite-stamped` and `journalctl -u bite-stamped -f` for the log.

**macOS (launchd)** – `~/Library/LaunchAgents/com.example.bite-stamped.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.bite-stamped</string>
  <key>WorkingDirectory</key><string>/Users/you/bite-stamped</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>--env-file=.env</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>server/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/bite-stamped/data/bite-stamped.log</string>
  <key>StandardErrorPath</key><string>/Users/you/bite-stamped/data/bite-stamped.log</string>
</dict></plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.example.bite-stamped.plist`. Use the
path of your `node` (`which node`).

To update: `git pull`, then restart the service. Bump `VERSION` in
`app/sw.js` with every change to the app (and add new files to its list) so
installed copies update.

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
