# Bring over data from Eatlist

On a Mac with the Eatlist app installed (and synced from iCloud):

```bash
npm run import-eatlist                # writes ~/Downloads/eatlist-for-bite-stamped-<date>.zip
```

It brings over restaurants (rating, "to try", address and the other details),
visits with the people who came along, dishes and photos. To write the ZIP
elsewhere or read a different copy of the Eatlist data:

```bash
node scripts/import-eatlist.mjs [output.zip] [path/to/Eatlist_CloudKit.sqlite]
```

Then import that ZIP in the app (Settings → Import ZIP); it syncs from there.
The script only reads a copy of Eatlist's database. The ZIP holds your
personal data: keep it out of this public repo (`*.zip` is git-ignored).
