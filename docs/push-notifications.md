# Push notifications for ride alerts

Live-ride alerts (SOS, regroup, mechanical, rider behind, announcements) reach the
group through Supabase Realtime only while the ride screen is open. Push
notifications deliver them when a rider's phone is locked or the app is in the
background.

## Flow
1. The app requests notification permission when a rider opens an **active** ride,
   then calls `register_push_token` with its Expo push token. On later launches it
   refreshes the token silently (no prompt). Sign-out calls `unregister_push_token`.
2. An `INSERT` into `public.alerts` fires a Database Webhook that calls the
   `notify-ride-alert` Edge Function.
3. The function sends to every **other active participant** in that ride through the
   Expo Push API:
   - `emergency` → `sos-alerts` channel (max importance, alert chime, map link, 1 h TTL)
   - everything else → `ride-alerts` channel (high importance, 10 min TTL)
   - Non-emergency alerts older than 10 minutes (synced late from an offline queue)
     and alerts for completed rides are not pushed.
   - Tokens reported as `DeviceNotRegistered` are deleted.
4. Tapping a notification opens `/ride/<rideId>`.

## Data and permissions
- `public.push_tokens(token, user_id, platform, updated_at)` (migration 028).
- Clients can read only their own rows; all writes go through the two RPCs.
  Registering an existing token moves it to the signed-in account (shared device).
- Tokens are deleted with the profile on account deletion.

## One-time setup
1. **Android FCM credentials** (required for Android delivery):
   - Create a Firebase project for `com.ridentrack.app`, download
     `google-services.json` into `mobile/`, and add
     `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json`.
   - Upload the FCM V1 service-account key: `eas credentials` → Android →
     Push Notifications (FCM V1).
   - Rebuild the app (`eas build`). Expo Go cannot receive remote pushes.
2. **Deploy the function and its secret**
   ```sh
   supabase functions deploy notify-ride-alert --no-verify-jwt
   supabase secrets set ALERT_WEBHOOK_SECRET=<long random value>
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions
   automatically. JWT verification is disabled because the webhook authenticates
   with the shared secret instead.
3. **Create the Database Webhook** (Dashboard → Database → Webhooks):
   - Table `public.alerts`, event `INSERT`
   - Type: Supabase Edge Function → `notify-ride-alert`, method `POST`
   - HTTP header `x-webhook-secret: <same value as ALERT_WEBHOOK_SECRET>`

## Failure modes
- No FCM credentials / Expo Go: token registration fails and is logged; in-app
  Realtime alerts keep working.
- Permission denied: no token is stored; the rider still gets in-app alerts.
- Push service outage: the function returns 502 and the webhook logs the failure;
  alerts remain in the database and appear in the app.

## GPS retention schedule

Migration 029 installs `purge_old_location_history(retention_days DEFAULT 90)`;
the client never receives access to it. Schedule a daily HTTP request to the
`purge-location-history` Edge Function:

```sh
supabase functions deploy purge-location-history --no-verify-jwt
supabase secrets set LOCATION_PURGE_SECRET=<long random value> LOCATION_RETENTION_DAYS=90
```

Use the Supabase scheduled-function UI (Database > Cron, or the Edge Function
schedule configuration) to call the function daily with
`x-schedule-secret: <same secret>`. A 90-day default bounds stored precision;
change `LOCATION_RETENTION_DAYS` to 7–3650 only after updating the privacy notice.

The function verifies the shared secret before using the service role and reports
how many rows were deleted. Failed calls return 500 and do not silently report
success.
