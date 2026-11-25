# Store billing (Pro Tourer and Expedition Pass)

Decision 1 of the development plan: Pro Tourer and the Expedition Pass are
digital features used inside the app, so Google Play and the App Store require
their own billing. We use RevenueCat on top of both stores. Razorpay stays for
real-world payments such as club ride registration fees (F16).

Everything is behind the `store_billing` flag (off by default). With the flag
off, or with no billing provider registered, the upgrade sheet shows plans and
prices with "In-app purchases open soon" and no buy buttons.

## How it fits together

1. The app calls `registerBillingProvider()` (mobile/src/services/billing.ts)
   with a RevenueCat adapter once the SDK is installed.
2. `UpgradePromptModal` shows "Go Pro", the annual plan and, on a trip, "This
   trip" (Expedition Pass). Before buying a pass the adapter sets the
   RevenueCat subscriber attribute `pending_pass_ride_id` to the trip id.
3. RevenueCat calls `supabase/functions/revenuecat-webhook`. The pure mapping
   lives in `supabase/functions/_shared/billing.ts` (unit tested).
4. The webhook calls `apply_billing_tier` / `apply_billing_pass`
   (migration 20261201000400). Both are idempotent on the RevenueCat event id
   (`billing_events`) and only the service role can run them.

Product ids: `ridentrack_pro_monthly`, `ridentrack_pro_annual`,
`ridentrack_expedition_pass` (non-consumable per purchase; one pass per trip).
Entitlement id: `pro_tourer`.

Cancellation keeps Pro until the paid period ends; expiration and refunds drop
the rider to free. A refunded pass is marked `refunded`.

## Prices per country (F19)

The app no longer shows fixed rupee prices. `priceText()` in `shared/premium.ts`
shows the store's localised price string (from RevenueCat, cached on the phone
by `useStorePrices`). Before the store answers, riders in India see the
reference price from `PAYMENT_CONFIG`; riders elsewhere see no price rather
than rupees. Set the price for each country in Play Console and App Store
Connect (price tiers / local prices), not in code.

## What Suman needs to do

- Create the products above in Play Console and App Store Connect.
- Create a RevenueCat project, add both apps, create entitlement `pro_tourer`
  and attach the two subscriptions.
- `npx expo install react-native-purchases` in `mobile/`, rebuild the dev
  client, and add the adapter below (called once after sign-in).
- Supabase secrets: `REVENUECAT_WEBHOOK_AUTH` (any long random string), and
  `BILLING_ACCEPT_SANDBOX=true` only on a test project.
- Deploy the function: `supabase functions deploy revenuecat-webhook --no-verify-jwt`.
- RevenueCat → Integrations → Webhooks: the function URL, Authorization header
  equal to `REVENUECAT_WEBHOOK_AUTH`.
- Set `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` / `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
- Turn on `store_billing` in `app_flags` for staff first (allow list), then roll out.

## Adapter sketch

```ts
import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';
import { registerBillingProvider, type BillingProduct } from './billing';

const IDS: Record<BillingProduct, string> = {
  pro_monthly: 'ridentrack_pro_monthly',
  pro_annual: 'ridentrack_pro_annual',
  expedition_pass: 'ridentrack_expedition_pass',
};

export function startRevenueCat() {
  const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey) return;
  Purchases.configure({ apiKey });
  registerBillingProvider({
    identify: async userId => { await Purchases.logIn(userId); },
    prices: async () => {
      const products = await Purchases.getProducts(Object.values(IDS));
      return Object.fromEntries(products.map(p => [Object.keys(IDS).find(k => IDS[k as BillingProduct] === p.identifier), p.priceString]));
    },
    purchase: async (product, opts) => {
      try {
        if (product === 'expedition_pass') await Purchases.setAttributes({ pending_pass_ride_id: opts?.rideId ?? '' });
        const [item] = await Purchases.getProducts([IDS[product]]);
        await Purchases.purchaseStoreProduct(item);
        return { status: 'purchased' };
      } catch (e: any) {
        if (e?.userCancelled) return { status: 'cancelled' };
        return { status: 'failed', message: e?.message ?? 'Unknown error' };
      }
    },
    restore: async () => {
      const info = await Purchases.restorePurchases();
      return info.entitlements.active.pro_tourer ? { status: 'purchased' } : { status: 'cancelled' };
    },
  });
}
```
