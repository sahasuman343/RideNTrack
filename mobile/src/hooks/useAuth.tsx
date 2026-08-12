import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: any | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Ensure loading finishes within 3 seconds even if network is offline/slow
    const timeout = setTimeout(() => {
      if (isMounted) setLoading(false);
    }, 3000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;
        setSession(session);
        if (session?.user) fetchProfile(session.user.id);
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setProfile(data);
    } catch (err) {
      console.warn('Profile fetch error:', err);
    }
  }

  async function signUp(email: string, password: string, username: string, displayName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName,
        },
      },
    });
    if (error) throw error;

    // If an authenticated session is created immediately, ensure profile is populated
    if (data?.session && data?.user) {
      try {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          username,
          display_name: displayName,
        });
      } catch (err) {
        console.warn('Profile fallback insert note:', err);
      }
    }
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
