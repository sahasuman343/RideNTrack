import React, { createContext, useContext, useEffect, useState } from 'react';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Ensure loading finishes within 3 seconds even if network is offline/slow
    const timeout = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 3000);

    supabase.auth.getSession()
      .then((res) => {
        if (!isMounted) return;
        const currentSession = res?.data?.session ?? null;
        setSession(currentSession);
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
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); void stopBackgroundLocationUpdates().catch(console.warn); }
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      authData?.subscription?.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      const current = (await supabase.auth.getSession())?.data?.session;
      if (current?.user.id === userId) setProfile(data as Profile | null);
    } catch (err) {
      console.warn('Profile fetch error:', err);
    }
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
      if (data.user) fetchProfile(data.user.id);
    }
  }

  async function signOut() {
    await stopBackgroundLocationUpdates();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
