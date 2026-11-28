import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { stopBackgroundLocationUpdates } from '../services/backgroundLocation';
import { unregisterPushToken } from '../services/pushNotifications';
import { syncQueue } from '../services/syncQueue';
import { clearQueuedItemsForUser } from '../lib/offlineQueue';
import { clearAllCachedTripsForUser } from '../lib/tripCache';
import type { Profile } from '@ridentrack/shared';
import { registerAccount, sendSignInCode, sendSignUpCode, verifyPhoneCode, normaliseLoginPhone, type ReferralSource } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  profileError: boolean;
  reloadProfile: () => Promise<void>;
  signUp: (email: string, password: string, username: string, displayName: string, referral?: { code: string | null; source: ReferralSource } | null) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Texts a sign-in code. Returns the number in E.164 for the verify step. */
  sendPhoneCode: (phone: string, signUp?: { username: string; displayName: string; referral?: { code: string | null; source: ReferralSource } | null }) => Promise<string>;
  verifyPhoneSignIn: (phone: string, code: string) => Promise<void>;
  /** Adds a number to the signed-in account; the code confirms it. */
  startPhoneLink: (phone: string) => Promise<string>;
  confirmPhoneLink: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateProfile: (updates: {
    display_name?: string;
    phone?: string | null;
    emergency_contact?: string | null;
    avatar_url?: string | null;
    motorcycle_make?: string | null;
    motorcycle_model?: string | null;
    motorcycle_model_id?: string | null;
    fuel_tank_capacity_liters?: number | null;
    mileage_km_per_liter?: number | null;
    fuel_reserve_liters?: number | null;
    motorcycle_category?: 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter' | null;
    blood_group?: string | null;
    share_ice_with_ride?: boolean;
    share_phone_with_ride?: boolean;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const activeUserId = useRef<string | null>(null);
  const profileRequest = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  useEffect(() => {
    let isMounted = true;
    let authEpoch = 0;
    const startupEpoch = authEpoch;

    // Safety timeout: Ensure loading finishes within 3 seconds even if network is offline/slow
    const timeout = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 3000);

    supabase.auth.getSession()
      .then((res) => {
        if (!isMounted || authEpoch !== startupEpoch) return;
        const currentSession = res?.data?.session ?? null;
        setSession(currentSession);
        if (activeUserId.current !== (currentSession?.user.id ?? null)) setProfile(null);
        activeUserId.current = currentSession?.user.id ?? null;
        if (currentSession?.user) fetchProfile(currentSession.user.id);
      })
      .catch((err) => {
        console.warn('Error fetching session:', err);
      })
      .finally(() => {
        if (isMounted) {
          clearTimeout(timeout);
          setLoading(false);
        }
      });

    const { data: authData } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      ++authEpoch;
      setSession(session);
      if (activeUserId.current !== (session?.user.id ?? null)) setProfile(null);
      activeUserId.current = session?.user.id ?? null;
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); void stopBackgroundLocationUpdates().catch(console.warn); }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      authData?.subscription?.unsubscribe();
    };
  }, []);

  function fetchProfile(userId: string): Promise<void> {
    // Auth can emit INITIAL_SESSION while the startup getSession() path is
    // still resolving. Share one profile request per user instead of issuing
    // duplicate reads on slower devices and networks.
    if (profileRequest.current?.userId === userId) return profileRequest.current.promise;
    setProfileError(false);
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
        if (error) throw error;
        if (activeUserId.current === userId) setProfile(data as Profile | null);
      } catch (err) {
        if (activeUserId.current === userId) setProfileError(true);
        console.warn('Profile fetch error:', err);
      } finally {
        if (profileRequest.current?.promise === promise) profileRequest.current = null;
      }
    })();
    profileRequest.current = { userId, promise };
    return promise;
  }

  async function signUp(email: string, password: string, username: string, displayName: string, referral?: { code: string | null; source: ReferralSource } | null) {
    const data = await registerAccount(supabase, { email, password, username, displayName, referralCode: referral?.code ?? null, referralSource: referral?.source ?? null });
    if (data?.session) {
      setSession(data.session);
      if (activeUserId.current !== (data.user?.id ?? null)) setProfile(null);
      activeUserId.current = data.user?.id ?? null;
      if (data.user) fetchProfile(data.user.id);
    }
    return Boolean(data?.session);
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.session) {
      setSession(data.session);
      if (activeUserId.current !== (data.user?.id ?? null)) setProfile(null);
      activeUserId.current = data.user?.id ?? null;
      if (data.user) fetchProfile(data.user.id);
    }
  }

  function adoptSession(data: { session?: Session | null; user?: User | null } | null) {
    if (!data?.session) return;
    setSession(data.session);
    if (activeUserId.current !== (data.user?.id ?? null)) setProfile(null);
    activeUserId.current = data.user?.id ?? null;
    if (data.user) fetchProfile(data.user.id);
  }

  async function sendPhoneCode(phone: string, signUp?: { username: string; displayName: string; referral?: { code: string | null; source: ReferralSource } | null }) {
    if (!signUp) return sendSignInCode(supabase, phone);
    return sendSignUpCode(supabase, {
      phone, username: signUp.username, displayName: signUp.displayName,
      referralCode: signUp.referral?.code ?? null, referralSource: signUp.referral?.source ?? null,
    });
  }

  async function verifyPhoneSignIn(phone: string, code: string) {
    adoptSession(await verifyPhoneCode(supabase, phone, code, 'sms'));
  }

  async function startPhoneLink(phone: string) {
    const e164 = normaliseLoginPhone(phone);
    if (!e164) throw Object.assign(new Error('Enter a 10-digit Indian mobile number, or +country code and number.'), { code: 'phone_invalid' });
    const { error } = await supabase.auth.updateUser({ phone: e164 });
    if (error) throw Object.assign(new Error(error.message), { code: error.code, status: error.status });
    return e164;
  }

  async function confirmPhoneLink(phone: string, code: string) {
    const data = await verifyPhoneCode(supabase, phone, code, 'phone_change');
    adoptSession(data);
    if (!data?.session) {
      // Refresh so session.user.phone shows the new number.
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed?.session) setSession(refreshed.session);
    }
  }

  async function updateProfile(updates: {
    display_name?: string;
    phone?: string | null;
    emergency_contact?: string | null;
    avatar_url?: string | null;
    motorcycle_make?: string | null;
    motorcycle_model?: string | null;
    fuel_tank_capacity_liters?: number | null;
    mileage_km_per_liter?: number | null;
    fuel_reserve_liters?: number | null;
    motorcycle_category?: 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter' | null;
    blood_group?: string | null;
    share_ice_with_ride?: boolean;
    share_phone_with_ride?: boolean;
  }) {
    const userId = activeUserId.current;
    if (!userId || profile?.id !== userId) throw new Error('Load your rider profile before making changes.');
    await profileRequest.current?.promise;
    if (activeUserId.current !== userId) throw new Error('Your account has changed. Reopen your profile.');
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', userId).select('*').single();
    if (error) throw new Error(error.message);
    if (activeUserId.current === userId) setProfile(data as Profile);
  }

  async function signOut() {
    await stopBackgroundLocationUpdates();
    // Upload what we can while the session is still valid, then remove this
    // rider's GPS trail from the device so the next account cannot see it.
    await syncQueue().catch(() => {});
    await unregisterPushToken().catch(() => {});
    const userId = activeUserId.current;
    if (userId) {
      await clearAllCachedTripsForUser(userId).catch(() => {});
      await clearQueuedItemsForUser(userId).catch(() => {});
    }
    const { error } = await supabase.auth.signOut();
    activeUserId.current = null;
    setSession(null);
    setProfile(null);
    if (error) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  }

  async function deleteAccount() {
    const userId = activeUserId.current || session?.user?.id;
    if (!userId) throw new Error('You must be signed in to delete your account.');
    if (session?.user?.id && session.user.id !== userId) {
      throw new Error('Account mismatch during deletion request.');
    }
    await stopBackgroundLocationUpdates();
    const { error } = await supabase.rpc('delete_user_account', { p_expected_user_id: userId });
    if (error) throw new Error(error.message || 'Account deletion failed.');
    await clearAllCachedTripsForUser(userId).catch(() => {});
    await clearQueuedItemsForUser(userId).catch(() => {});
    // Server rows were removed with the profile; drop the local token record.
    await unregisterPushToken().catch(() => {});
    if (activeUserId.current === userId) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      activeUserId.current = null;
      setSession(null);
      setProfile(null);
    }
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, profileError, reloadProfile: () => activeUserId.current ? fetchProfile(activeUserId.current) : Promise.resolve(), loading, signUp, signIn, sendPhoneCode, verifyPhoneSignIn, startPhoneLink, confirmPhoneLink, signOut, deleteAccount, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
