# Data format

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

How the server stores these files and keeps their history:
[storage-and-backups.md](storage-and-backups.md).
