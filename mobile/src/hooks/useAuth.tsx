import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { stopBackgroundLocationUpdates } from '../services/backgroundLocation';
import type { Profile } from '@ridentrack/shared';
import { registerAccount } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: { display_name: string; phone: string | null; emergency_contact?: string | null; avatar_url: string | null }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
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
        console.warn('Profile fetch error:', err);
      } finally {
        if (profileRequest.current?.promise === promise) profileRequest.current = null;
      }
    })();
    profileRequest.current = { userId, promise };
    return promise;
  }

  async function signUp(email: string, password: string, username: string, displayName: string) {
    const data = await registerAccount(supabase, { email, password, username, displayName });
    return Boolean(data.session);
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

  async function updateProfile(updates: { display_name: string; phone: string | null; emergency_contact?: string | null; avatar_url: string | null }) {
    if (!activeUserId.current) throw new Error('You must be signed in to edit your profile.');
    const { data, error } = await supabase.from('profiles').update(updates).eq('id', activeUserId.current).select('*').single();
    if (error) throw error;
    setProfile(data as Profile);
  }

  async function signOut() {
    await stopBackgroundLocationUpdates();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    activeUserId.current = null;
    setSession(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signUp, signIn, signOut, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
