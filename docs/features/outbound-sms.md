# Server SMS (family updates, SOS fallback)

Decision 2: MSG91 is the default SMS provider (Gupshup is wired as the
alternative). Indian SMS needs DLT registration, so every message is a fixed
template with variables.

- Queue: `outbound_messages` (migration 040). Nothing in the app
  sends SMS directly; database functions call `enqueue_outbound_message`,
  which applies daily caps, per-ride caps and a 10-minute duplicate guard
  (SOS templates skip the per-user and per-ride caps but not the global cap).
  Migration 065 adds abuse limits, all tunable in `outbound_limits`:
  SOS-class texts are capped at `sos_per_user_daily` (30) per rider, any one
  number receives at most `per_recipient_daily` (12) texts a day from all
  senders, and the last `sos_global_reserve` (300) of the global daily budget
  is kept for SOS-class texts only.
- Family contacts are still self-declared with consent, not verified by OTP.
  The per-number cap limits what a bad actor can do; add OTP verification if
  abuse shows up after launch.
- Sender: `supabase/functions/send-outbound-message`, triggered by a database
  webhook on INSERT and by a periodic `{ "sweep": true }` call. It retries up
  to 3 times.
- Kill switch: unless `SERVER_SMS_ENABLED=true`, messages are marked failed
  with `server_sms_disabled` and nothing is sent. The `server_sms` flag hides
  server SMS states in the app until it is live.
- Templates live in `supabase/functions/_shared/outbound.ts`. The wording must
  match the DLT template text exactly.

## What Suman needs to do

1. DLT: register the business entity on a DLT portal (Jio, Airtel or Vi),
   register a 6-letter sender header (for example `RDNTRK`), and register each
   template in `outbound.ts` as a Service Implicit (family) or Service
   Explicit/Transactional (SOS) template. Approval usually takes several days.
2. MSG91: create a Flow for each approved template (variables `VAR1..VARn` in
   the same order as the template), then set secrets:
   `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, and
   `DLT_TEMPLATE_<NAME>` with each MSG91 flow id.
3. `OUTBOUND_WEBHOOK_SECRET` (random string). Create a Database Webhook on
   `outbound_messages` INSERT that POSTs to the function with header
   `x-outbound-secret: <secret>`, and a cron (pg_cron or an external one)
   that POSTs `{ "sweep": true }` every minute.
4. Test with `SMS_PROVIDER=dry_run` (the default) first, then set
   `SERVER_SMS_ENABLED=true` and turn on the `server_sms` flag.
