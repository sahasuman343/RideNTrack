# Clubs (F15)

Flag: `clubs` (on).

- **Tables**: `clubs` (slug, name, city, description, join policy, join code,
  verified), `club_members` (owner / admin / member, joined_at),
  `club_ride_series` (small RRULE subset), `rides.club_id`,
  `rides.club_series_id`.
- **Access**: all writes go through RPCs. Signed-in riders can see clubs;
  only members see the roster and series; only admins see the join code. The
  **verified badge** has no client write path, and a trigger also blocks it
  for `authenticated` / `anon`. Set it with the service role:
  `update clubs set verified = true where slug = '…';`
- **Roles**: owners manage roles; admins can remove plain members; a club always
  keeps at least one owner. Riders own at most three clubs.
- **Rides**: the captain of a trip who is also a club admin adds it to the club
  (trip screen, Club row). A **regular ride** is a template trip plus a pattern
  ("Every Sunday", "First Sunday of the month"); "Plan 7 Jun" copies the
  template onto the next free date and opens it.
- **Member history** comes from finished club rides each member was on (count
  and km), shown on the roster.
- **App**: Home lists your clubs (or "Start a club"), `club/new`, and
  `club/[slug]` (join, next rides, regular rides, roster, invite, leave).
  Links `ridentrack://club/<slug>` open the club.
- **Web**: `/club/<slug>` is public and server-rendered: name, city, verified
  badge, riders, rides and km together, upcoming *public* rides. No member names.

## Needs Suman

- Decide who gets the verified badge and how (for example a form plus a call).
- Universal / app links so `https://ridentrack.app/club/<slug>` opens the app
  when installed (apple-app-site-association and assetlinks.json).
