import type { ConfigContext, ExpoConfig } from 'expo/config';

/*
 * Build lanes. app.json is the production app; APP_VARIANT (set per profile
 * in eas.json) turns a build into the dev app so both can live on one phone:
 *
 *   production / preview -> "RideNTrack"      com.ridentrack.app      live Supabase
 *   development          -> "RideNTrack Dev"  com.ridentrack.app.dev  dev Supabase
 *     (profiles "development" = dev client, "development-apk" = installable APK)
 *
 * Supabase keys come from the EAS environment of the same name, never from here.
 */
const variant = process.env.APP_VARIANT ?? 'production';
const isDev = variant === 'development';

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!isDev) return base;
  return {
    ...base,
    name: 'RideNTrack Dev',
    scheme: 'ridentrack-dev',
    ios: { ...base.ios, bundleIdentifier: 'com.ridentrack.app.dev' },
    android: { ...base.android, package: 'com.ridentrack.app.dev' },
    extra: { ...base.extra, appVariant: variant },
  };
};
