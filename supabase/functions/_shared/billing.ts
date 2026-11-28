/*
 * Store billing (decision 1): Pro Tourer and the Expedition Pass are digital
 * features used inside the app, so they are sold through Google Play Billing
 * and Apple In-App Purchase, via RevenueCat. This file maps RevenueCat webhook
 * events to what the database should change. Pure, so Node tests cover it.
 */

export const PRODUCT_IDS = {
  proMonthly: 'ridentrack_pro_monthly',
  proAnnual: 'ridentrack_pro_annual',
  expeditionPass: 'ridentrack_expedition_pass',
  /** F16: club plan, bought by a club owner or admin; unlocks Pro on every club ride. */
  clubMonthly: 'ridentrack_club_monthly',
  clubAnnual: 'ridentrack_club_annual',
} as const;

export const PRO_ENTITLEMENT = 'pro_tourer';

export interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  transaction_id?: string | null;
  /** On CANCELLATION: CUSTOMER_SUPPORT means the store refunded it. */
  cancel_reason?: string | null;
  environment?: 'SANDBOX' | 'PRODUCTION';
  subscriber_attributes?: Record<string, { value: string }>;
}

export type BillingAction =
  | { kind: 'set_tier'; userId: string; tier: 'free' | 'pro_tourer'; expiresAt: string | null }
  | { kind: 'grant_pass'; userId: string; rideId: string; transactionId: string }
  | { kind: 'revoke_pass'; userId: string; transactionId: string }
  | { kind: 'set_club_plan'; userId: string; clubId: string; active: boolean; expiresAt: string | null }
  | { kind: 'ignore'; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
// CANCELLATION only stops auto-renew; access continues until EXPIRATION.
const ENDING_TYPES = new Set(['EXPIRATION']);

/** A refund ends access now; a plain auto-renew cancel runs to the period end. */
function isRefund(event: RevenueCatEvent): boolean {
  return event.type === 'REFUND' || (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT');
}

export function billingActionFor(event: RevenueCatEvent, nowMs: number = Date.now()): BillingAction {
  const userId = event.app_user_id;
  if (!userId || !UUID.test(userId)) return { kind: 'ignore', reason: 'anonymous_or_invalid_user' };

  if (event.product_id === PRODUCT_IDS.expeditionPass) {
    const txn = event.transaction_id ?? '';
    if (!txn) return { kind: 'ignore', reason: 'missing_transaction' };
    if (event.type === 'NON_RENEWING_PURCHASE' || event.type === 'INITIAL_PURCHASE') {
      const rideId = event.subscriber_attributes?.pending_pass_ride_id?.value ?? '';
      if (!UUID.test(rideId)) return { kind: 'ignore', reason: 'pass_without_ride' };
      return { kind: 'grant_pass', userId, rideId, transactionId: txn };
    }
    if (event.type === 'REFUND' || event.type === 'CANCELLATION') return { kind: 'revoke_pass', userId, transactionId: txn };
    return { kind: 'ignore', reason: `pass_event_${event.type}` };
  }

  if (event.product_id === PRODUCT_IDS.clubMonthly || event.product_id === PRODUCT_IDS.clubAnnual) {
    const clubId = event.subscriber_attributes?.pending_club_id?.value ?? '';
    if (!UUID.test(clubId)) return { kind: 'ignore', reason: 'club_plan_without_club' };
    const expiresAt = typeof event.expiration_at_ms === 'number' ? new Date(event.expiration_at_ms).toISOString() : null;
    if (ACTIVE_TYPES.has(event.type)) {
      const live = !(event.expiration_at_ms && event.expiration_at_ms < nowMs);
      return { kind: 'set_club_plan', userId, clubId, active: live, expiresAt };
    }
    if (ENDING_TYPES.has(event.type) || isRefund(event)) return { kind: 'set_club_plan', userId, clubId, active: false, expiresAt };
    return { kind: 'ignore', reason: `club_event_${event.type}` };
  }

  const grantsPro = (event.entitlement_ids ?? []).includes(PRO_ENTITLEMENT)
    || event.product_id === PRODUCT_IDS.proMonthly || event.product_id === PRODUCT_IDS.proAnnual;
  if (!grantsPro) return { kind: 'ignore', reason: 'unknown_product' };

  const expiresAt = typeof event.expiration_at_ms === 'number' ? new Date(event.expiration_at_ms).toISOString() : null;
  if (ACTIVE_TYPES.has(event.type)) {
    if (event.expiration_at_ms && event.expiration_at_ms < nowMs) return { kind: 'set_tier', userId, tier: 'free', expiresAt };
    return { kind: 'set_tier', userId, tier: 'pro_tourer', expiresAt };
  }
  if (ENDING_TYPES.has(event.type) || isRefund(event)) return { kind: 'set_tier', userId, tier: 'free', expiresAt };
  return { kind: 'ignore', reason: `event_${event.type}` };
}
