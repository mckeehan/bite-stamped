# Storage and backups on the server

The server keeps every version of every file it receives. There is no
separate backup job: a save never overwrites or deletes earlier content. This
page explains how that works, what it protects against and what it doesn't,
and how to get an old version back.

The code is in [`server/files.js`](../server/files.js) (the sync API) and
[`server/storage.js`](../server/storage.js) (the disk layout).

## What is in `DATA_DIR`

```
bite-stamped.sqlite      file index, change counter, login codes, sessions,
                         calendar links
versions/<path>/<rev>    every version of every file: the history
files/<path>             the current version of each file, as plain files
```

`<path>` is the file's path in the journal: `places/<STATE>-<city>-<name>.md` (`restaurants/…` before 2.0.0), or an
image under `media/` (see [data-format.md](data-format.md)).

`files/` holds the current version of every file, for browsing the Markdown
and images. The place files there can be edited: see
[editing place files on the server](#editing-place-files-on-the-server).
Images there are for looking at only; changes to them are not synced.

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
4. `files/<path>` is replaced with the new revision: a copy for a place
   file (`.md`), which you may edit there, and a hard link for an image (a
   copy if the file system doesn't support hard links), which takes no extra
   space.

The `files` table in SQLite holds only the **current** revision of each path,
not the list of earlier ones. The history is the contents of
`versions/<path>/`.

## Deletes

Deleting a place or image in the app does not delete any bytes. The
server gives the path a new revision marked `deleted`, so other devices learn
about the deletion, and removes the `files/<path>` link. Every earlier version
stays in `versions/<path>/`.

## The only case where bytes are removed

If an upload loses a conflict, because another device changed the file first,
the server removes the revision it just wrote. That revision never became
current, and the device that sent it merges the two versions and uploads
again (see [sync.md](sync.md)).

## What this protects against and what it doesn't

**It protects against** mistakes made in the app or on a device: an edit
that removes too much, a deleted place, a bad import, or a device that
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

Nothing is ever pruned, so `versions/` only grows. Each save of a place
stores the whole Markdown file again; these are small. Photos make up most of
the space, and each photo is usually stored once, since photos are rarely
changed after they are added. Check the size with `du -sh versions`.

## Editing place files on the server

The place files in `files/places/` can be changed with any text editor (or
Obsidian), and new ones added there or deleted. Before each sync from a
device (at most every few seconds), and when it starts, the server looks at
that folder: a changed, new or deleted `.md` file becomes a change just like
one from a device, kept as a new version in `versions/`. Devices get it on
their next sync, and if one changed the same place meanwhile, the two
versions are merged as usual ([sync](sync.md)). The server log says what it
found, e.g. `changed in files/: places/TN-knoxville-luca.md`.

- **The format:** a file must start with its YAML header (a line `---`) and
  have a `name`; one that doesn't is not synced, and the log says why. The
  header's fields are in [data-format.md](data-format.md).
- **The file name:** a new file can have any name ending in `.md`; the app
  renames it to `<STATE>-<city>-<name>.md` the next time it loads (and so
  does any place whose name, town or state you changed).
- **Not while saving:** a file saved less than two seconds ago is left for
  the next check, in case it is still being written.
- **Deleting:** a file deleted from `files/places/` deletes the place
  (its earlier versions stay). If the whole folder is empty or missing,
  nothing is deleted.
- **Images:** files under `files/media/` are not checked; add photos in the
  app.

Each place file in `files/` is a copy of its version, not a hard link (since
2.18.0; the server makes the copies when it first starts), so an editor that
saves into the file itself can't change a saved version.

## Getting an old version back

The app has no screen for this yet. By hand:

1. Find the file's versions. Revision ids start with the time, so sorting by
   name sorts them oldest first:

   ```bash
   ls -l versions/places/TN-knoxville-main-street-tavern.md/
   ```

2. Look at a version; each one is the complete file:

   ```bash
   cat versions/places/TN-knoxville-main-street-tavern.md/mw0xb152-UMBg_mwF
   ```

3. To restore it, copy it over the file in `files/`; the next sync picks it
   up ([editing place files](#editing-place-files-on-the-server)):

   ```bash
   cp versions/places/TN-knoxville-main-street-tavern.md/mw0xb152-UMBg_mwF files/places/TN-knoxville-main-street-tavern.md
   ```

   Or put it in a ZIP under its journal path and import that ZIP
   in the app (**Settings → Import ZIP**). Files with the same path are
   replaced and everything else is kept; the device then syncs the restored
   version to the server as a new revision.

   ```bash
   mkdir -p restore/places
   cp versions/places/TN-knoxville-main-street-tavern.md/mw0xb152-UMBg_mwF restore/places/TN-knoxville-main-street-tavern.md
   (cd restore && zip -r ../restore.zip places)
   ```

   For a deleted place, restore the last version before the deletion:
   the deletion itself has no file in `versions/`.

A signed-in device can also fetch any revision through the API with
`GET /api/files/<path>?rev=<rev>`.

## Note on the first migration

The comments in `migrations/0001_init.sql` still describe an earlier design
that stored files in Cloudflare R2 at `files/<path>/<rev>`. The table layout
is the same; the server now stores the bytes in `versions/<path>/<rev>` on
local disk.
