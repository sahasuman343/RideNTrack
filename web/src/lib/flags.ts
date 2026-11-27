'use client';
import { useEffect, useState } from 'react';
import { resolveFlags, type FlagSet } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

/** Remote feature flags for the signed-in rider; defaults until they load or if the read fails. */
export function useFlags(userId: string | undefined): FlagSet {
  const [flags, setFlags] = useState<FlagSet>(() => resolveFlags(null));
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase.rpc('get_my_flags').then(({ data, error }) => {
      if (!cancelled && !error && Array.isArray(data)) setFlags(resolveFlags(data));
    }, () => {});
    return () => { cancelled = true; };
  }, [userId]);
  return flags;
}
