import { useCallback, useEffect, useState } from 'react';
import type { ClubRole, ClubView, MyClub } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useFlag } from './useFeatureFlags';

/** F15: clubs I belong to, for Home and the trip screen. */
export function useMyClubs() {
  const { user } = useAuth();
  const enabled = useFlag('clubs');
  const [clubs, setClubs] = useState<MyClub[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    if (!user || !enabled) { setClubs([]); setLoaded(true); return; }
    const { data, error } = await supabase.rpc('get_my_clubs');
    if (!error && Array.isArray(data)) setClubs(data as MyClub[]);
    setLoaded(true);
  }, [user, enabled]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { enabled, clubs, loaded, refresh };
}

function rpcError(error: { message?: string } | null): never | void {
  if (error) throw new Error(error.message || 'Something went wrong. Try again.');
}

/** F15: one club, with the actions its screen needs. */
export function useClub(slug: string | undefined) {
  const [view, setView] = useState<ClubView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [joinCode, setJoinCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!slug) return;
    const { data, error } = await supabase.rpc('get_club', { p_slug: slug });
    if (error) { setState('error'); return; }
    if (!data) { setState('missing'); return; }
    const next = data as ClubView;
    setView(next);
    setState('ready');
    if (next.my_role === 'owner' || next.my_role === 'admin') {
      const { data: code } = await supabase.rpc('get_club_join_code', { p_club_id: next.club.id });
      setJoinCode(typeof code === 'string' ? code : null);
    } else {
      setJoinCode(null);
    }
  }, [slug]);
  useEffect(() => { void refresh(); }, [refresh]);

  const clubId = view?.club.id;
  const join = useCallback(async (code?: string | null) => {
    rpcError((await supabase.rpc('join_club', { p_slug: slug, p_code: code ?? null })).error);
    await refresh();
  }, [slug, refresh]);
  const leave = useCallback(async () => {
    rpcError((await supabase.rpc('leave_club', { p_club_id: clubId })).error);
    await refresh();
  }, [clubId, refresh]);
  const setRole = useCallback(async (userId: string, role: ClubRole | 'removed') => {
    rpcError((await supabase.rpc('set_club_member_role', { p_club_id: clubId, p_user_id: userId, p_role: role })).error);
    await refresh();
  }, [clubId, refresh]);
  const scheduleNext = useCallback(async (seriesId: string, date: string) => {
    const { data, error } = await supabase.rpc('schedule_series_ride', { p_series_id: seriesId, p_date: date });
    rpcError(error);
    await refresh();
    return data as string;
  }, [refresh]);
  const createSeries = useCallback(async (name: string, rule: string, templateRideId: string) => {
    rpcError((await supabase.rpc('create_club_series', { p_club_id: clubId, p_name: name, p_rule: rule, p_template_ride_id: templateRideId })).error);
    await refresh();
  }, [clubId, refresh]);

  return { view, state, joinCode, refresh, join, leave, setRole, scheduleNext, createSeries };
}

export async function createClub(input: { name: string; slug: string; city: string; description: string; joinPolicy: 'open' | 'code' }) {
  const { error } = await supabase.rpc('create_club', {
    p_name: input.name.trim(), p_slug: input.slug, p_city: input.city, p_description: input.description, p_join_policy: input.joinPolicy,
  });
  rpcError(error);
}

export async function setRideClub(rideId: string, clubId: string | null) {
  rpcError((await supabase.rpc('set_ride_club', { p_ride_id: rideId, p_club_id: clubId })).error);
}
