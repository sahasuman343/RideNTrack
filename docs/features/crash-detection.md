# Crash detection (F7)

Status: beta, off by default. Two flags:

| Flag | What it does |
| --- | --- |
| `sensor_recorder` | Saves short motion windows around hard events to `crash_telemetry`, only for riders who turn on "Help tune crash detection" in Profile → Emergency details. |
| `crash_detection_beta` | Runs the 45 second "Are you OK?" countdown when the detector sees a crash. The flag payload can override thresholds (see `CRASH_THRESHOLDS` in `shared/crash.ts`), e.g. `{"impactG": 5.5, "stillSeconds": 12}`. |

## What the rider and the pack see

1. The detector sees a spike over `impactG` while the bike was moving over
   `minSpeedBeforeKmh`, then the phone stays still and slow for `stillSeconds`.
2. Full-screen countdown (attention item `crash_countdown`): the whole screen is
   the "I'm OK" button, haptics get stronger towards zero, and "Are you OK? Tap
   anywhere on your phone to cancel." is spoken through the headset at 45, 30
   and 15 seconds.
3. The pack immediately sees "Asha: possible crash. Checking if they are OK."
   Family hears nothing.
4. "I'm OK" sends `crash_cancelled` (the pack sees "Asha is OK" for a minute)
   and records a `false_alarm` row. No family message.
5. No answer, or "Get help now": `crash_detected` goes to the pack as an SOS,
   the server SMS goes out (`crash_alert`, with `server_sms` on), family
   contacts get `family_crash`, and the SOS sheet stays open for a bystander
   with Call 112.

## Code

- `shared/crash.ts`: detector, thresholds, countdown item, telemetry rows. Unit
  tests in `tests/unit/crash.test.cjs` replay synthetic traces (crash, speed
  breaker, dropped phone, lagging GPS speed). Add real traces from
  `crash_telemetry` there as fixtures during the beta.
- `mobile/src/services/crashSensors.ts`: sample source. Uses the native
  `CrashDetector` module if the build has it, otherwise `expo-sensors` while
  the ride screen is open (25 Hz).
- `mobile/src/hooks/ride/useCrashDetection.ts`: countdown, haptics, speech,
  telemetry, escalation through `useSosWorkflow().escalateCrash`.
- `supabase/migrations/20261201000900_crash_detection.sql`: alert types,
  `crash_telemetry` with RLS, research consent, family trigger.

## Native module (F7-b, not in the build yet)

Foreground sampling stops when the screen locks. To detect crashes with the
screen off, add a local Expo module at `mobile/modules/crash-detector` named
`CrashDetector` with this contract (the JS side already looks for it):

```ts
start(intervalMs: number): void   // begin sampling at about this interval
stop(): void
// event 'onSample': { t: number /* epoch ms */, g: number /* |accel| in g */, gyroDps: number }
```

- Android: register a `SensorEventListener` for `TYPE_ACCELEROMETER` and
  `TYPE_GYROSCOPE` from inside the existing location foreground service
  (`expo-location` task), so it runs while locked.
- iOS: `CMMotionManager` accelerometer and gyro updates; they keep arriving in
  the background while location updates keep the app alive.

The module was left out on purpose: native code that cannot be built and run
on a device here would risk breaking the EAS build.

## General availability (F7 GA)

The go / no-go numbers come from the beta telemetry:

1. Run `select public.crash_beta_report(now() - interval '90 days');` with the
   service role (SQL editor). It returns consenting riders, their riding hours
   and every event's peak and speed before it, with no ids or locations.
2. Save the JSON and run `node scripts/crash-tune.cjs report.json`. It sweeps
   impact and speed thresholds (`shared/crashTuning.ts`) and prints, for each
   pair, false alarms per 1,000 riding hours, crashes caught and crashes missed.
3. GA when the best pair has **no missed crash**, **under 1 false alarm per
   1,000 riding hours** and at least **500 riding hours** of data
   (`GA_TARGET`). The script prints the flag payload to use.
4. Set that payload on `crash_detection_beta`, raise its rollout percentage
   step by step (10, 50, 100), and watch `crash_false_alarm` analytics.
5. Once at 100% for a month, rename the flag in a release and remove the
   "beta" wording from Profile.

## Needs Suman

- Play Console: the `USE_FULL_SCREEN_INTENT` declaration (Android 14+), so the
  countdown can show over the lock screen.
- Apple: the critical alerts entitlement request.
- Device tests on 4 Android brands and 1 iPhone, including cancelling with
  gloves on.
- DLT templates `crash_alert` and `family_crash` (text in
  `supabase/functions/_shared/outbound.ts`).
- Turn on `sensor_recorder` for beta testers first; turn on
  `crash_detection_beta` once a few hundred riding hours of telemetry show the
  false-alarm rate (goal: under 1 per 1,000 riding hours).
