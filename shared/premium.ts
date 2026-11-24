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

// Backward-compatible legacy alias
export type PlanLimits = TierLimits;
export const PLAN_LIMITS: Record<SubscriptionTier, TierLimits> = {
  ...TIER_LIMITS,
  free: {
    ...TIER_LIMITS.free,
    maxWaypointsPerTrip: 15,
  },
};

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
