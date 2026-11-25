/**
 * 2-Tier Monetization & Host-Unlocks-Group Entitlements
 */

export type SubscriptionTier = 'free' | 'pro_tourer';

export interface TierLimits {
  tier: SubscriptionTier;
  maxActiveTrips: number;
  maxTripDays: number | null; // null = unlimited
  maxWaypointsPerTrip: number;
  maxParticipantsPerRide: number;
  locationRetentionDays: number | null; // null = unlimited
  supportsTopographicalMaps: boolean;
  supportsGpxExport: boolean;
  supportsGpxImport: boolean;
  supportsTouringIntelligence: boolean;
  supportsExpensesAndJournal: boolean;
  supportsSpectatorLink: boolean;
  supportsChatAttachments: boolean;
  supportsOfflineWeatherRadar: boolean;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    tier: 'free',
    maxActiveTrips: 5,
    maxTripDays: 2,
    maxWaypointsPerTrip: 5,
    maxParticipantsPerRide: 6,
    locationRetentionDays: 7,
    supportsTopographicalMaps: false,
    supportsGpxExport: false,
    supportsGpxImport: false,
    supportsTouringIntelligence: false,
    supportsExpensesAndJournal: false,
    supportsSpectatorLink: false,
    supportsChatAttachments: false,
    supportsOfflineWeatherRadar: false,
  },
  pro_tourer: {
    tier: 'pro_tourer',
    maxActiveTrips: 100,
    maxTripDays: null,
    maxWaypointsPerTrip: 50,
    maxParticipantsPerRide: 50,
    locationRetentionDays: null,
    supportsTopographicalMaps: true,
    supportsGpxExport: true,
    supportsGpxImport: true,
    supportsTouringIntelligence: true,
    supportsExpensesAndJournal: true,
    supportsSpectatorLink: true,
    supportsChatAttachments: true,
    supportsOfflineWeatherRadar: true,
  },
};

// Backward-compatible alias
export type PlanLimits = TierLimits;
export const PLAN_LIMITS = TIER_LIMITS;

export interface RideEntitlements {
  effectiveTier: SubscriptionTier;
  limits: TierLimits;
  isHostUnlocked: boolean;
  canJoinAnyRide: true;
  canUseSos: true;
  canUseTripChat: true;
}

export function resolveRideEntitlements(params: {
  hostTier?: SubscriptionTier | null;
  userTier?: SubscriptionTier | null;
  hasExpeditionPass?: boolean;
}): RideEntitlements {
  const isHostUnlocked = params.hostTier === 'pro_tourer' || Boolean(params.hasExpeditionPass);
  const effectiveTier: SubscriptionTier =
    isHostUnlocked || params.userTier === 'pro_tourer' ? 'pro_tourer' : 'free';

  return {
    effectiveTier,
    limits: TIER_LIMITS[effectiveTier],
    isHostUnlocked,
    canJoinAnyRide: true,
    canUseSos: true,
    canUseTripChat: true,
  };
}

export interface PaymentArchitectureConfig {
  provider: 'razorpay' | 'stripe';
  currency: 'INR' | 'USD';
  monthlyPlanPriceInr: number;
  annualPlanPriceInr: number;
  expeditionPassPriceInr: number;
  merchantName: string;
}

/**
 * Reference prices for India only. Since F19 the stores set the real price per
 * country and the app shows the store's own localised string; these numbers
 * are a fallback for Indian riders before the store answers.
 */
export const PAYMENT_CONFIG: PaymentArchitectureConfig = {
  provider: 'razorpay',
  currency: 'INR',
  monthlyPlanPriceInr: 199,
  annualPlanPriceInr: 1799,
  expeditionPassPriceInr: 99,
  merchantName: 'RideNTrack Pro Tourer',
};

export function canCreateMoreTrips(currentActiveCount: number, tier: SubscriptionTier = 'free'): boolean {
  return currentActiveCount < TIER_LIMITS[tier].maxActiveTrips;
}

export function canAddMoreWaypoints(currentWaypointsCount: number, tier: SubscriptionTier = 'free'): boolean {
  return currentWaypointsCount < PLAN_LIMITS[tier].maxWaypointsPerTrip;
}

// ----- F19 localised pricing ------------------------------------------------

export type PricedProduct = 'pro_monthly' | 'pro_annual' | 'expedition_pass' | 'club_monthly' | 'club_annual';

const REFERENCE_INR: Partial<Record<PricedProduct, number>> = {
  pro_monthly: PAYMENT_CONFIG.monthlyPlanPriceInr,
  pro_annual: PAYMENT_CONFIG.annualPlanPriceInr,
  expedition_pass: PAYMENT_CONFIG.expeditionPassPriceInr,
};

/**
 * The price to show: the store's localised string when it has answered;
 * otherwise the Indian reference price, but only for riders in India (or
 * when the region is unknown). Elsewhere null: never show rupees to a rider
 * the store will charge in another currency.
 */
export function priceText(
  product: PricedProduct,
  storePrices: Partial<Record<PricedProduct, string>> | null | undefined,
  region: string | null | undefined,
  suffix = '',
): string | null {
  const store = storePrices?.[product];
  if (store) return `${store}${suffix}`;
  const inIndia = !region || region.toUpperCase() === 'IN';
  const ref = REFERENCE_INR[product];
  return inIndia && ref != null ? `₹${ref}${suffix}` : null;
}

/** One sentence for places that mention Pro in passing; avoids a currency when it is unknown. */
export function proPriceSentence(storePrices: Partial<Record<PricedProduct, string>> | null | undefined, region: string | null | undefined): string {
  const monthly = priceText('pro_monthly', storePrices, region, '/month');
  const pass = priceText('expedition_pass', storePrices, region, ' a trip');
  if (monthly && pass) return `Pro Tourer ${monthly}, or an Expedition Pass for ${pass}.`;
  return 'Pro Tourer or an Expedition Pass for one trip; prices are shown in your store.';
}

