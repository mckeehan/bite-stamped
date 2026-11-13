# Duplicate places

The same place can end up in the journal twice: imported from Foursquare
under one name and added again under another ("United States Postal Service"
and "Kodak Post Office"), or found once by OpenStreetMap and once by
Foursquare. **Settings → Find duplicate places** lists the pairs that look
like the same place, to merge or to leave apart. The code is in
[`app/js/duplicates.js`](../app/js/duplicates.js); the merge itself in
`merge()` in [`app/js/repo.js`](../app/js/repo.js).

## What counts as a possible duplicate

Two places, when they have

- **the same street address**: house number and street, compared loosely
  ("2849 Winfield Dunn Pkwy" is "2849 Winfield Dunn Parkway"; suite numbers
  don't count; "Tennessee" is "TN"), and either a similar name or the same
  kind of place (the same type, with the same category or one left empty).
  A shared address alone isn't enough: a shopping centre has one address
  for many shops.
- **the same name** (ignoring case, accents, apostrophes and a leading
  "The") within 150 m, or, without a location, in the same town. Branches of
  a chain across town don't count.
- **similar names** (the words of one start the words of the other, like
  "Debbie's Drive-In" and "Debbie's Drive Inn") within 40 m, or within 150 m
  at the same address.

Pairs with matching names come first, then the closest. These are
suggestions; you decide.

## Merging

**Merge…** asks which of the two to keep: its name, address and other
details stay. The one with more visits is chosen to start with. The other
place is deleted, and

- its visits, dishes, photos and tags move to the kept place (the same visit,
  dish or photo only once), and its notes are added below the kept place's;
- details the kept place doesn't have (phone, website, location, rating…)
  are filled in from it; the earlier "added" date of the two is kept;
- the place stays on the to-try list only if both were;
- its photos move into the kept place's folder (`media/<kept place>/`), so
  nothing still points at the deleted place's folder.

Like any change, a merge syncs to your other devices. To undo one, the server
keeps every version of every file ([storage and backups](storage-and-backups.md)).

## Not the same

**Not the same** leaves a pair out of the list from then on. This is kept on
the device where you said it (not synced); "Show them again" at the top
brings them all back.
