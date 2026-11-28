# Phone number sign-in

Riders can sign in, or create an account, with a 6-digit code texted to their
mobile, as well as with email and password. Email riders can add a number in
Profile ("Sign in with your phone") and then use either.

## How it works

- App and website call Supabase phone OTP (`signInWithOtp` / `verifyOtp`).
  Sign-in uses `shouldCreateUser: false`, so a typo never creates an account;
  "Create account > Phone" checks the username first and sends username,
  display name and invite code as metadata.
- Supabase Auth hands each code to the **Send SMS hook**
  (`supabase/functions/auth-send-sms`), which sends it through the same
  MSG91 / Gupshup account as server SMS, with its own DLT template.
- Codes never go through `outbound_messages`, so they never use the daily
  budget, SOS reserve or per-number caps kept for SOS and family texts. They
  have their own caps in `auth_sms_limits` (migration 071), checked by
  `claim_auth_sms`: 5 per number per hour, 10 per number per day, 2,000 a day
  in total, and Indian (+91) numbers only. Tune them in the SQL editor.
- Phone-only accounts get a profile even without metadata (`rider_xxxx`).
- The Email/Phone switch is hidden until the build has
  `EXPO_PUBLIC_PHONE_LOGIN=true` (app) or `NEXT_PUBLIC_PHONE_LOGIN=true` (web).

## What Suman needs to do

1. **DLT**: register this exact text as a Service Implicit (OTP) template
   under your sender header:
   `{#var#} is your RideNTrack sign-in code. Do not share it with anyone. - RideNTrack`
2. **MSG91**: create a Flow for it (`VAR1` = the code) and set Edge Function
   secrets `DLT_TEMPLATE_AUTH_OTP=<flow id>` plus, if not already set for
   server SMS, `SMS_PROVIDER=msg91` and `MSG91_AUTH_KEY`.
3. **Supabase > Authentication > Sign In / Providers > Phone**: enable phone
   sign-in. Set SMS OTP expiry to 600 seconds and OTP length to 6. The SMS
   provider fields don't matter once the hook is on.
4. **Supabase > Authentication > Hooks > Send SMS hook**: type HTTPS, URL
   `https://<project-ref>.supabase.co/functions/v1/auth-send-sms`, generate a
   secret. Copy it into the Edge Function secret `SEND_SMS_HOOK_SECRET`
   (the `v1,whsec_...` value as shown).
5. Set `AUTH_SMS_ENABLED=true` (separate from `SERVER_SMS_ENABLED`, so codes
   can go live before or after SOS texts).
6. Builds: `EXPO_PUBLIC_PHONE_LOGIN=true` in the EAS env, and
   `NEXT_PUBLIC_PHONE_LOGIN=true` in Vercel.
7. Optional, recommended before a public launch: turn on CAPTCHA protection
   in Supabase Auth (Turnstile is already set up for the waitlist) to stop
   bots requesting codes.

**Testing without SMS**: Supabase > Authentication > Phone > "Test phone
numbers and OTPs" lets you map e.g. `919999999999=123456`. Those never call
the hook, so no SMS is sent and nothing is billed.

**Cost**: MSG91 OTP SMS in India is roughly ₹0.15 to ₹0.25 per text, plus
DLT registration fees on the operator portal. Check MSG91's current price.
