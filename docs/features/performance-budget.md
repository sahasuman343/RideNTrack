# Low-end Android tuning (F14)

## Tiers

`shared/performance.ts` puts Android phones with 3.5 GB of RAM or less (or a
year class of 2016 or older) in the **low** tier. iPhones are always standard.

| | Standard | Low |
| --- | --- | --- |
| Own trail points on the map | 2,000 | 600 (distance is unaffected) |
| HUD updates | 1 per second | 1 every 2 seconds |
| Rider name labels | all zooms | zoom 11 and closer |
| Road report labels | zoom 11 and closer | zoom 13 and closer |

SOS, alerts, the attention bar and pack dots are the same on every tier.

Flag `low_end_tuning` (on) switches tiering; its payload `{"tier": "low"}`
forces the low tier for testing on a fast phone.

## Budget

Every ride-screen PR must hold this on a 3 GB Android phone (Redmi or Realme),
map open, 15 riders moving, HUD running (`PERFORMANCE_BUDGET`):

- Frame rate above **50 fps** on the live map.
- JS heap under **180 MB**.
- Cold start to map under **4 s**.

Flag `perf_sampling` (off) records `ride_perf_sample` analytics events: frame
rate and stutter share over 10 seconds every 5 minutes while the ride screen is
open, with the tier. No location or ids.

## Needs Suman

- Profile with Sentry performance on a Redmi or Realme 3 GB phone; fix what it
  finds (the plan's second F14 PR is driven by that profile).
- Turn on `perf_sampling` for a week of beta rides to see real frame rates.
