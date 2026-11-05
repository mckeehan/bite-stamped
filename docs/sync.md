# How offline-first sync works

- Every device keeps the full journal in the browser's IndexedDB. The app only
  ever reads and writes that copy, so it works the same with or without a
  connection.
- Each local file remembers the server version it is based on and whether it
  changed since. When the device is online and signed in, it uploads its
  changes (`PUT` with `If-Match`), then asks the server for everything that
  changed since its last sync (a change counter).
- If a file changed elsewhere first, the server answers 409 and the device
  merges both versions of the place (visits, dishes, photos and tags are
  combined; single values keep this device's edit) and uploads the merge. An
  edit wins over a deletion.
- Each server's data has a random id. If a device meets a different one (a new
  or restored server), it uploads its whole copy again, merging with what is
  there, and downloads everything.
- Sync runs after each change (after 1.5 s), when the app comes back online or
  to the foreground, and every 5 minutes while it is open.

What the server keeps of each upload: [storage-and-backups.md](storage-and-backups.md).

## Sign-in

Only addresses in `ALLOWED_EMAILS` get a code (valid 10 minutes, five
tries). A correct code sets an HttpOnly session cookie for a year. Writes also
need an `X-Bite-Stamped` header from the same origin; sign-in requests are limited per
client address; responses carry a strict Content Security Policy.
