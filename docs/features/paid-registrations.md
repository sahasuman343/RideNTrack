# Club plan and paid registrations (F16)

Two flags, both **off** until the setup below is done: `club_plan` and
`paid_registrations`.

## Club plan (store billing, decision 1)

The club plan is a digital feature used in the app, so it is sold through
Google Play and the App Store via RevenueCat, like Pro.

- Products: `ridentrack_club_monthly`, `ridentrack_club_annual`. The app sets
  the subscriber attribute `pending_club_id` before the purchase.
- `revenuecat-webhook` maps them to `apply_club_plan` (service role only). The
  buyer must be an owner or admin of that club. Idempotent on the event id.
- `ride_has_pro_access` now also returns true for rides of a club with an
  active plan, so every Pro feature (spectator links, voice notes beyond the
  free safety rule, etc.) unlocks on club rides.
- Club screen → Club plan card (owners and admins) with store prices.

## Paid registration (Razorpay, real-world services)

Registration fees pay for real-world services (stay, fuel, support vehicle), so
Razorpay is allowed for them.

1. The captain turns on a fee on the trip screen (before the ride): amount,
   optional spots, what it covers. Once someone has paid, the fee is locked.
2. A rider taps **Register · ₹1,500**. The `create-registration-payment`
   function records a pending registration and creates a Razorpay **payment
   link** (no native SDK needed); the app opens it in the browser. A second tap
   reuses the same link.
3. `razorpay-webhook` checks `X-Razorpay-Signature`, then
   `apply_registration_payment` marks it paid (amount must match exactly), adds
   the rider to the ride, and ignores webhook retries and late failures.
4. Riders see "Registered. ₹1,500 paid."; the captain sees
   "12 of 20 paid · ₹18,000 collected".

## Needs Suman

- Razorpay account (KYC), then Edge Function secrets `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, optional
  `REGISTRATION_CALLBACK_URL` (a page that says "Payment received, go back to
  the app").
- Razorpay webhook to `…/functions/v1/razorpay-webhook` with events
  `payment_link.paid`, `payment_link.cancelled`, `payment_link.expired`,
  `payment.failed`, `refund.processed`.
- **Payouts to clubs**: money lands in RideNTrack's Razorpay account. Decide the
  platform fee and set up Razorpay Route (linked accounts per club) or manual
  payouts. Refunds are done in the Razorpay dashboard; the webhook updates the app.
- Store products `ridentrack_club_monthly` / `ridentrack_club_annual` in Play
  Console and App Store Connect, attached to RevenueCat.
- Turn on `paid_registrations` and `club_plan` once each is set up.
