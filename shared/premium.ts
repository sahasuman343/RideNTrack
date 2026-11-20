/**
 * Premium Tier Architecture & Payment Integration Placeholders
 */

export type SubscriptionTier = 'free' | 'pro_tourer';

export interface PlanLimits {
  tier: SubscriptionTier;
  maxActiveTrips: number;
  maxWaypointsPerTrip: number;
  supportsTopographicalMaps: boolean;
  supportsGpxExport: boolean;
  supportsOfflineWeatherRadar: boolean;
}

export const PLAN_LIMITS: Record<SubscriptionTier, PlanLimits> = {
  free: {
    tier: 'free',
    maxActiveTrips: 5,
    maxWaypointsPerTrip: 15,
    supportsTopographicalMaps: false,
    supportsGpxExport: false,
    supportsOfflineWeatherRadar: false,
  },
  pro_tourer: {
    tier: 'pro_tourer',
    maxActiveTrips: 100,
    maxWaypointsPerTrip: 50,
    supportsTopographicalMaps: true,
    supportsGpxExport: true,
    supportsOfflineWeatherRadar: true,
  },
};

export interface PaymentArchitectureConfig {
  provider: 'razorpay' | 'stripe';
  currency: 'INR' | 'USD';
  monthlyPlanPriceInr: number;
  annualPlanPriceInr: number;
  merchantName: string;
}

export const PAYMENT_CONFIG: PaymentArchitectureConfig = {
  provider: 'razorpay',
  currency: 'INR',
  monthlyPlanPriceInr: 199,
  annualPlanPriceInr: 1799,
  merchantName: 'RideNTrack Pro Tourer',
};

export function canCreateMoreTrips(currentActiveCount: number, tier: SubscriptionTier = 'free'): boolean {
  return currentActiveCount < PLAN_LIMITS[tier].maxActiveTrips;
}

export function canAddMoreWaypoints(currentWaypointsCount: number, tier: SubscriptionTier = 'free'): boolean {
  return currentWaypointsCount < PLAN_LIMITS[tier].maxWaypointsPerTrip;
}
