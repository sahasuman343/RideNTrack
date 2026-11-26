# Dev and prod build lanes

One codebase, two lanes. Nothing is copied; the branch and the EAS profile pick the lane.

| | Dev (testers) | Prod (riders) |
|---|---|---|
| Git branch | `dev` | `main` |
| Supabase | RideNTrack-dev (`pblyvdrffiqauoqgfqjh`) | live (`lpeaignvaesoeqeijrxe`) |
| Database deploy | automatic: `.github/workflows/deploy-dev-supabase.yml` | by hand at release (below) |
| EAS profile / environment | `preview` (APK) and `development` (dev client) | `production` (Play bundle) |
| App | "RideNTrack Dev", `com.ridentrack.app.dev`, scheme `ridentrack-dev` | "RideNTrack", `com.ridentrack.app`, scheme `ridentrack` |
| EAS Update channel | `preview` / `development` | `production` |

`mobile/app.config.ts` reads `APP_VARIANT` (set per profile in `mobile/eas.json`) and switches the
name, IDs and scheme. Supabase URL and key come from the EAS environment with the same name as the
profile (expo.dev > project > Environment variables), so a dev build can never talk to live.

## EAS environment variables

Set these in each of `development`, `preview` and `production`:

- `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (dev values in development/preview, live in production)
- `EXPO_PUBLIC_MAPBOX_TOKEN` (can be the same everywhere)
- `EXPO_PUBLIC_SENTRY_DSN` (optional)

## Day to day

1. Feature branches merge into `dev`. Dev Supabase updates itself.
2. Testers get a build: run the "Build Android beta APK" workflow on `dev` (EAS `preview`).
3. JS-only fix for testers: `eas update --channel preview --environment preview --message "..."`.

## Release to riders

1. Open a PR `dev` -> `main`, review, merge.
2. Apply new migrations to live: `npx supabase link --project-ref lpeaignvaesoeqeijrxe` then `npx supabase db push`
   (check `npx supabase migration list` first; live was set up partly by hand, so the first push may need
   `supabase migration repair` for versions that already exist there).
3. Deploy edge functions to live: `npx supabase functions deploy --project-ref lpeaignvaesoeqeijrxe`.
4. Build: `eas build --platform android --profile production`, then `eas submit -p android`.
5. JS-only fix for riders: `eas update --channel production --environment production --message "..."`.

## One-time setup for the dev app

- The dev app has its own Android package, so EAS makes it its own signing key on the first build
  (accept when asked). Push notifications need FCM credentials for `com.ridentrack.app.dev` too:
  `eas credentials` > Android > preview > Google Service Account / FCM.
- Supabase Auth (dev project): add `ridentrack-dev://**` to the redirect URLs.
