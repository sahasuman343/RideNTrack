/*
 * Store billing (decision 1). Pro Tourer and the Expedition Pass are digital
 * features, so they are bought through Google Play / App Store via RevenueCat.
 * The RevenueCat SDK is a native module that needs a dev build, so it is
 * plugged in through registerBillingProvider() rather than imported here.
 * Until a provider is registered (and the store_billing flag is on) the app
 * shows plans and prices but no buy buttons. Setup: docs/features/store-billing.md
 */

export type BillingProduct = 'pro_monthly' | 'pro_annual' | 'expedition_pass';

export type PurchaseOutcome =
  | { status: 'purchased' }
  | { status: 'cancelled' }
  | { status: 'pending' }
  | { status: 'failed'; message: string };

export interface BillingProvider {
  /** Ties store purchases to the Supabase user id the webhook reads. */
  identify(userId: string): Promise<void>;
  /** Localised store prices, e.g. { pro_monthly: '₹199.00' }. */
  prices(): Promise<Partial<Record<BillingProduct, string>>>;
  /** rideId is required for the Expedition Pass so the webhook knows which trip it unlocks. */
  purchase(product: BillingProduct, opts?: { rideId?: string }): Promise<PurchaseOutcome>;
  restore(): Promise<PurchaseOutcome>;
}

let provider: BillingProvider | null = null;
const listeners = new Set<() => void>();

export function registerBillingProvider(next: BillingProvider | null) {
  provider = next;
  listeners.forEach(fn => fn());
}

export function getBillingProvider() {
  return provider;
}

export function onBillingProviderChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Friendly sentence for each outcome; null means say nothing. */
export function purchaseMessage(outcome: PurchaseOutcome, product: BillingProduct): string | null {
  switch (outcome.status) {
    case 'purchased':
      return product === 'expedition_pass'
        ? 'Expedition Pass unlocked for this trip. It can take a few seconds to show for everyone.'
        : 'Welcome to Pro Tourer. Your features unlock in a few seconds.';
    case 'pending':
      return 'Payment is pending with the store. We will unlock it as soon as it clears.';
    case 'failed':
      return `The store could not finish the purchase: ${outcome.message}`;
    default:
      return null;
  }
}
