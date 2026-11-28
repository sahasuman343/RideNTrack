'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { PLAN_LIMITS, type SubscriptionTier } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

/** Returns the signed-in session, sending signed-out visitors to /login. */
export function useRequiredSession(): Session | null {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) router.replace('/login?next=' + encodeURIComponent(window.location.pathname));
      else setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) router.replace('/login');
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [router]);
  return session;
}

/**
 * The plan whose limits apply, matching the mobile app: Pro for everyone while
 * `beta_free_pro` is on. Limits are also enforced by the database, so this only
 * shapes what the form offers.
 */
export function useEffectiveTier(userId: string | undefined): SubscriptionTier {
  const [tier, setTier] = useState<SubscriptionTier>('free');
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void Promise.all([
      supabase.from('profiles').select('subscription_tier').eq('id', userId).single(),
      supabase.rpc('get_my_flags'),
    ]).then(([profile, flags]) => {
      if (cancelled) return;
      const beta = Array.isArray(flags.data) && flags.data.some((f: { key?: string; enabled?: boolean }) => f.key === 'beta_free_pro' && f.enabled);
      const own = (profile.data as { subscription_tier?: SubscriptionTier } | null)?.subscription_tier;
      setTier(beta ? 'pro_tourer' : own === 'pro_tourer' ? 'pro_tourer' : 'free');
    }, () => {});
    return () => { cancelled = true; };
  }, [userId]);
  return tier;
}

export function routePointLimit(tier: SubscriptionTier) {
  return PLAN_LIMITS[tier].maxWaypointsPerTrip;
}

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

/** Server errors in words a rider understands. */
export function friendlyTripError(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message || '';
  if (/active trip limit/i.test(message)) return 'You have reached the active trip limit for your plan. Complete or archive a trip first.';
  if (/waypoint|route point/i.test(message) && /limit/i.test(message)) return 'This trip has more route points than your plan allows.';
  if (/not its leader|permission|42501/i.test(message)) return 'Only the trip leader can do that.';
  return message || fallback;
}

export function formatTripDates(start?: string | null, end?: string | null): string {
  const fmt = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (start && end) return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  if (start) return fmt(start);
  return 'Dates not set';
}
