# Website waitlist

The form on the home page and `/waitlist` lets anyone join the launch waitlist.
The first 10 people who **confirm their email** get Pro free for 3 months.

## How it works

1. The form shows a Cloudflare Turnstile check. With a passing token it posts
   `{ email, name, turnstile_token }` to the `waitlist-join` Edge Function.
2. The function checks the token with Cloudflare. It then calls
   `join_waitlist(email, name, ip_hash)` with the service role. The database
   allows 5 tries per network per hour and 300 signups per hour overall. It
   stores a salted hash of the IP, never the IP itself.
3. The function emails a confirmation link through Resend:
   `https://ridentrack.app/waitlist/confirm?token=…`. The link works for 7 days.
   Asking again after 10 minutes sends a fresh link, and the old one stops working.
4. `/waitlist/confirm` shows a **Confirm my email** button and calls
   `confirm_waitlist(token)` only when it is pressed, because email scanners
   open links on their own. Places go in the order people confirm.
   `waitlist_places_left()` counts only confirmed emails.
5. If Resend rejects the email, the function calls `waitlist_send_failed(email)`
   so the next try sends a fresh link straight away.

The form always answers "Check your email". It never says whether an address
is already on the list. Signups can't be made straight through the API.

## Setup

1. **Cloudflare Turnstile.** In the Cloudflare dashboard, go to Turnstile and
   add a widget for `ridentrack.app` (add the Vercel preview host if you want
   previews to work). Copy the site key and the secret key.
2. **Vercel.** Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the site key and
   redeploy. Without it, the form says the waitlist isn't open yet.
3. **Resend.** Verify the sending domain, then create an API key.
4. **Supabase Edge Function secrets** (live and dev):

   | Secret | Value |
   | --- | --- |
   | `TURNSTILE_SECRET_KEY` | Turnstile secret key |
   | `RESEND_API_KEY` | Resend API key |
   | `WAITLIST_FROM_EMAIL` | e.g. `rideNtrack <hello@ridentrack.app>` |
   | `WAITLIST_SITE_URL` | `https://ridentrack.app` (dev: the dev site URL) |
   | `WAITLIST_ALLOWED_ORIGINS` | optional, comma-separated, defaults to `https://ridentrack.app,https://www.ridentrack.app` |
   | `WAITLIST_IP_SALT` | optional random string, defaults to the service key |

   The function fails closed: until the first three secrets are set, it answers
   503 and nobody can join.
5. Deploy it: `supabase functions deploy waitlist-join`. It runs with
   `verify_jwt = false` (see `supabase/config.toml`), because the site calls it
   with the publishable key.

For local testing, Cloudflare's test keys always pass: site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## Reading the list

In the SQL editor, with the service role:

```sql
SELECT position, email, name, created_at, confirmed_at
  FROM public.waitlist_signups
 WHERE confirmed_at IS NOT NULL
 ORDER BY confirmed_at, position;
```

The first 10 rows are the launch offer.
