# Android build lanes

Two GitHub workflows, one codebase. The EAS profile decides the app and the keys.

| Workflow | Runs | EAS profile | expo.dev environment | App |
|---|---|---|---|---|
| **Build RideNTrack APK (main, live)** (`build-android-apk.yml`) | every merge into `main` | `preview` | `preview` (live Supabase) | "RideNTrack", `com.ridentrack.app` |
| **Build RideNTrack Dev APK (any branch)** (`build-android-dev-apk.yml`) | manually, any branch | `development-apk` | `development` (dev Supabase) | "RideNTrack Dev", `com.ridentrack.app.dev` |

Both call `_eas-android-apk.yml`, which runs the full validation suite, waits for approval in the
`apk-approval` GitHub environment, builds on EAS and attaches the APK to the run's Artifacts.

`mobile/app.config.ts` reads `APP_VARIANT` from `mobile/eas.json`: `development` switches the name,
IDs and deep-link scheme (`ridentrack-dev`) so the dev app installs next to the live one. Supabase
keys are never in the repo; each build reads them from its expo.dev environment.

Other profiles: `development` (dev client for `npx expo start`, development environment) and
`production` (Play Store bundle, production environment).

## Notes

- GitHub only shows "Run workflow" for a manual workflow once the file is on the default branch (`main`).
- First dev build: EAS creates a signing key for `com.ridentrack.app.dev` (accept it). Push
  notifications in the dev app need FCM credentials for that package (`eas credentials`).
- Dev Supabase Auth: add `ridentrack-dev://**` to the redirect URLs.
