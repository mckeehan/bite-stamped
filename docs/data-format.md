# Data format

Each restaurant is one Markdown file with a YAML header. Images sit next to
them in `media/`:

```
restaurants/TN-knoxville-trattoria-da-luca.md
media/TN-knoxville-trattoria-da-luca/mw0ryxwb-oxql.jpg
```

## File names

`restaurants/<STATE>-<city>-<name>.md`:

- **STATE** is the state's two-letter abbreviation in upper case (`TN` for
  "Tennessee" or "tn"; Canadian provinces too). A state the app has no
  abbreviation for is written out in upper case.
- **city** and **name** are in lower case; accents are dropped and every run
  of characters other than a–z and 0–9 becomes `-`
  ("Debbie's Drive Inn" → `debbie-s-drive-inn`).
- A part that is empty is left out (`restaurants/chez-marie.md` for a place
  without state or city).
- When another restaurant already has the name, `-2`, `-3`… is added
  (`TN-sevierville-taco-bell-2.md`). Names count as taken regardless of case.

Changing a restaurant's name, city or state in the app renames its file.
Images keep their paths, since the header refers to them by path; new ones
go into the folder of the new name. Files from before this naming (version
1.3.0) are renamed the first time the app starts after updating.

```markdown
---
name: Trattoria da Luca
rating: 5
cuisine: Italian
city: Knoxville
tags:
- date night
visits:
- date: 2026-10-12T19:30
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

A visit's `date` is the local date and time of the visit (`2026-10-12T19:30`),
or just the date (`2026-10-12`) when the time is not known. Photo dates are
dates only.

**Settings → Export ZIP** gives you the files from a device; edit them with
any editor (Obsidian works well) and **Import ZIP** them again. Files with the
same path are replaced, everything else is kept (and then synced).

How the server stores these files and keeps their history:
[storage-and-backups.md](storage-and-backups.md).
