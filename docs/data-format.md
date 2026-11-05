# Data format

Each place is one Markdown file with a YAML header. Images sit next to
them in `media/`:

```
places/TN-knoxville-trattoria-da-luca.md
media/TN-knoxville-trattoria-da-luca/mw0ryxwb-oxql.jpg
```

## File names

`places/<STATE>-<city>-<name>.md`:

- **STATE** is the state's two-letter abbreviation in upper case (`TN` for
  "Tennessee" or "tn"; Canadian provinces too). A state the app has no
  abbreviation for is written out in upper case.
- **city** and **name** are in lower case; accents are dropped and every run
  of characters other than a–z and 0–9 becomes `-`
  ("Debbie's Drive Inn" → `debbie-s-drive-inn`).
- A part that is empty is left out (`places/chez-marie.md` for a place
  without state or city).
- When another place already has the name, `-2`, `-3`… is added
  (`TN-sevierville-taco-bell-2.md`). Names count as taken regardless of case.

Changing a place's name, city or state in the app renames its file.
Images keep their paths, since the header refers to them by path; new ones
go into the folder of the new name.

Before 2.0.0 the files were in `restaurants/` (and before 1.3.0 named after
the restaurant only). The app moves such files to `places/` and renames them
the first time it starts after updating, giving them the type `Restaurant`.
Importing a ZIP exported before 2.0.0 works too: each file replaces the place
it was.

```markdown
---
name: Trattoria da Luca
rating: 5
type: Restaurant
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

`type` is what kind of place it is: any text, such as Restaurant, Bar, Café,
Brewery, Museum, Park or Attraction (the app suggests these). Places to eat
and drink (or without a type) have dishes, and `cuisine` is their cuisine;
for other places `cuisine` holds a category (shown as "Category").

`foursquareId` is set when the place was picked from Foursquare's results:
its page there (`https://foursquare.com/v/<id>`) is linked from the place's page.

A visit's `date` is the local date and time of the visit (`2026-10-12T19:30`),
or just the date (`2026-10-12`) when the time is not known. Photo dates are
dates only.

**Settings → Export ZIP** gives you the files from a device; edit them with
any editor (Obsidian works well) and **Import ZIP** them again. Files with the
same path are replaced, everything else is kept (and then synced).

How the server stores these files and keeps their history:
[storage-and-backups.md](storage-and-backups.md).
