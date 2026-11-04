# Storage and backups on the server

The server keeps every version of every file it receives. There is no
separate backup job: a save never overwrites or deletes earlier content. This
page explains how that works, what it protects against and what it doesn't,
and how to get an old version back.

The code is in [`server/files.js`](../server/files.js) (the sync API) and
[`server/storage.js`](../server/storage.js) (the disk layout).

## What is in `DATA_DIR`

```
bite-stamped.sqlite      file index, change counter, login codes, sessions
versions/<path>/<rev>    every version of every file: the history
files/<path>             the current version of each file, as plain files
```

`<path>` is the file's path in the journal: `restaurants/<name>.md`, or an
image under `media/` (see [data-format.md](data-format.md)).

## What happens on a save

1. A device uploads a file (`PUT /api/files/<path>`). The server gives the
   upload a new revision id. The id is the time in milliseconds, in base 36,
   followed by a random part, e.g. `mw0xb161-tH0ceUVa`.
2. The bytes are written to `versions/<path>/<rev>`, first to a temporary
   file that is then renamed into place, so a crash never leaves a
   half-written version. Earlier revisions of that path are not touched.
3. In one SQLite transaction the server checks that the device's upload is
   based on the current revision. If it is, the row for the path in the
   `files` table is updated to point at the new revision, and the change
   counter goes up by one; other devices use that counter to fetch changes.
4. `files/<path>` is replaced with a hard link to the new revision (a copy if
   the file system doesn't support hard links). It takes no extra space and
   is only there for browsing: edits made in `files/` are not synced.

The `files` table in SQLite holds only the **current** revision of each path,
not the list of earlier ones. The history is the contents of
`versions/<path>/`.

## Deletes

Deleting a restaurant or image in the app does not delete any bytes. The
server gives the path a new revision marked `deleted`, so other devices learn
about the deletion, and removes the `files/<path>` link. Every earlier version
stays in `versions/<path>/`.

## The only case where bytes are removed

If an upload loses a conflict, because another device changed the file first,
the server removes the revision it just wrote. That revision never became
current, and the device that sent it merges the two versions and uploads
again (see "How offline-first sync works" in the README).

## What this protects against and what it doesn't

**It protects against** mistakes made in the app or on a device: an edit
that removes too much, a deleted restaurant, a bad import, or a device that
syncs damaged data. All earlier versions are still on the server.

**It does not protect against** losing the server's disk. If the drive fails
or `DATA_DIR` is deleted, the history is gone too. Copy the whole `DATA_DIR`
to another machine or drive as well; nothing does this automatically:

- with the server stopped: copy the folder (rsync, Time Machine, …), or
- while it runs: `sqlite3 bite-stamped.sqlite ".backup copy.sqlite"` for the
  database, plus a copy of `versions/`. The files in `versions/` never change
  once written, so incremental copies (rsync, Time Machine) are cheap.

`files/` only holds links to the current versions, so a backup of the
database and `versions/` already contains everything in it.

Each device also keeps its own full copy of the journal, and
**Settings → Export ZIP** saves one as Markdown files at any time.

## Size

Nothing is ever pruned, so `versions/` only grows. Each save of a restaurant
stores the whole Markdown file again; these are small. Photos make up most of
the space, and each photo is usually stored once, since photos are rarely
changed after they are added. Check the size with `du -sh versions`.

## Getting an old version back

The app has no screen for this yet. By hand:

1. Find the file's versions. Revision ids start with the time, so sorting by
   name sorts them oldest first:

   ```bash
   ls -l versions/restaurants/main-street-tavern.md/
   ```

2. Look at a version; each one is the complete file:

   ```bash
   cat versions/restaurants/main-street-tavern.md/mw0xb152-UMBg_mwF
   ```

3. To restore it, put it in a ZIP under its journal path and import that ZIP
   in the app (**Settings → Import ZIP**). Files with the same path are
   replaced and everything else is kept; the device then syncs the restored
   version to the server as a new revision.

   ```bash
   mkdir -p restore/restaurants
   cp versions/restaurants/main-street-tavern.md/mw0xb152-UMBg_mwF restore/restaurants/main-street-tavern.md
   (cd restore && zip -r ../restore.zip restaurants)
   ```

   For a deleted restaurant, restore the last version before the deletion:
   the deletion itself has no file in `versions/`.

A signed-in device can also fetch any revision through the API with
`GET /api/files/<path>?rev=<rev>`.

## Note on the first migration

The comments in `migrations/0001_init.sql` still describe an earlier design
that stored files in Cloudflare R2 at `files/<path>/<rev>`. The table layout
is the same; the server now stores the bytes in `versions/<path>/<rev>` on
local disk.
