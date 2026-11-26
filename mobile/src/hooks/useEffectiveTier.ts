import { useAuth } from './useAuth';
import { useFlag } from './useFeatureFlags';

/** The plan whose limits apply: Pro for everyone while `beta_free_pro` is on. */
export function useEffectiveTier(): 'free' | 'pro_tourer' {
  const { profile } = useAuth();
  const betaFreePro = useFlag('beta_free_pro');
  return betaFreePro ? 'pro_tourer' : profile?.subscription_tier ?? 'free';
}
