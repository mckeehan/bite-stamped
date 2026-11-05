# Calendar feed

Your visits can show up in a calendar app (Apple Calendar, Google Calendar,
Outlook, Thunderbird…) as a calendar you subscribe to. It is read-only: change
visits in the app, and the calendar follows the next time the calendar app
checks (every few hours; Google Calendar can take up to a day).

## Turning it on

The feed comes from the server's copy of your journal, so it needs
[sync](sync.md): sign in under Settings → Sync first.

1. Settings → Calendar → **Create calendar link**.
2. Then one of:
   - **Add to Calendar** opens the link as `webcal://…`, which subscribes in
     Apple Calendar (iPhone, iPad, Mac) and in most desktop calendar apps.
   - **Add to Google Calendar** opens Google Calendar's "add by URL" page.
     Google fetches the feed from its own servers, so your server must be
     reachable from the internet.
   - **Copy link** for any other app ("subscribe to calendar", "add calendar
     from URL", "internet calendar").

## What's in it

One event per visit, titled with the restaurant's name:

- A visit with a time is an event at that moment, with no length: it ends
  when it starts, so calendar apps show it as a short marker at that time
  (Google Calendar draws it like a 15–30 minute event). The app keeps
  visit times as clock times without a time zone, so the feed reads them in
  the time zone of the device that created the link (or, for a link made
  before that was kept, the server's), daylight saving time included, and
  sends them in UTC. Calendar apps then show them in your time zone. To use
  another time zone, make a new link on a device set to it.
- A visit with only a date is an all-day event.
- The location is the restaurant's address (and its coordinates, so maps
  can find it).
- The notes have the visit's rating as stars, the cuisine, who was there,
  the visit's notes and a link to the restaurant in the app.

Events are marked "free", so they don't block time in your calendar.

## Privacy

Calendar apps can't sign in, so the link itself is the key: anyone who has
it can see your visits. Keep it to yourself. If it gets out:

- **Make a new link**: the old one stops working at once; subscribe again
  with the new one.
- **Turn off**: no link works until you create a new one.

Each signed-in account has its own link; all of them show the same journal.
A link stops working when its account is taken off `ALLOWED_EMAILS`.

## How it works

- `GET /api/calendar/<token>.ics` serves the feed (`text/calendar`,
  [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)). It reads the current
  version of every `restaurants/*.md` file on the server. Code:
  [`server/calendar.js`](../server/calendar.js).
- `GET`, `POST` and `DELETE /api/calendar` (signed in) show, create or
  replace, and remove your link. The token is 24 random bytes, stored in
  the `calendar_feeds` table of `bite-stamped.sqlite` with the time zone
  the app sent when it made the link.
- Visits have no ids of their own, so each event's id is made from the
  restaurant's file name and the visit's date. Changing a visit's date makes
  it a new event in the calendar (the old one disappears).
