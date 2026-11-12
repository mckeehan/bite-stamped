# Searching your lists

The search box at the top of the Timeline, Visited and To Try narrows the
list as you type. The code is in [`app/js/search.js`](../app/js/search.js).
(Finding a new place to add is something else: [place search](place-search.md).)

## Any word

Plain words look everywhere in a place: its name, type, cuisine, address,
city, state, country, tags, notes, dishes, the people and notes of its
visits, and photo titles. Upper and lower case and accents don't matter
("cafe" finds "Café"), and a word matches part of a word ("knox" finds
Knoxville). With several words, a place has to have all of them. Put words in
quotes to find them together: `"date night"`.

## One field

Start a word with a field name and a colon to look only there:

| Field | Looks in | Also |
|---|---|---|
| `tag:` | the place's tags | `tags:` |
| `with:` | the people of its visits | `people:`, `person:` |
| `city:` | its city | `town:` |
| `state:` | its state | |
| `type:` | its type (Restaurant, Bar, Museum…) | |
| `cuisine:` | its cuisine or category | `category:` |
| `dish:` | the names of its dishes | `dishes:` |
| `name:` | its name | |

The value matches part of the field: `tag:night` finds the tags "Date night"
and "Late night". A value with spaces goes in quotes: `tag:"date night"`.
Fields and plain words can be mixed, and all have to match:
`tag:brunch with:anna knoxville`. A word with a colon that isn't a field name
(`10:30`) is a plain word.

## Suggestions

- With the search box empty, it suggests the fields: tap `tag:` to start one.
- Typing the start of a field name ("ta") suggests the field (`tag:`).
- After `tag:` (or any field), it lists that field's values among the places
  on this tab that contain what you've typed so far: those starting with it
  first, then those with a word starting with it, then the rest; more often
  used ones first, with how many places have each. Tap one (or press Return
  for the first) to put it in the search.
