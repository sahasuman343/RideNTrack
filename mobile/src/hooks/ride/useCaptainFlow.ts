import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDebrief,
  captainPhase,
  summariseRollCall,
  type CheckInSource,
  type Debrief,
  type LocationUpdate,
  type RollCallRider,
} from '@ridentrack/shared';
import * as Location from 'expo-location';
import { supabase } from '../../lib/supabase';
import { track } from '../../services/analytics';

/*
 * F1 Guided captain flow. Loads the briefing, roll call and debrief inputs,
 * checks this rider in automatically when they are near the meetup point,
 * and wraps the start, end, all-through and debrief RPCs.
 */

export interface BriefingState { version: number; handSignals: string[]; notes: string | null; publishedAt: string; readCount: number; memberCount: number }
interface RollCallRow { user_id: string; display_name: string; role: string | null; attendance_status: string; checked_in_by: CheckInSource; checked_in_at: string | null; briefing_read: boolean }
interface DebriefInputs {
  alerts: Array<{ type: string; created_at?: string }>;
  riders: number;
  started_at: string | null;
  ended_at: string | null;
  start_override_reason: string | null;
  regroups_missing: Array<{ point: string; names: string[] }>;
  debrief: { summary: string; facts: string[]; notes: string | null; saved_at: string } | null;
}

const AUTO_CHECK_IN_EVERY_MS = 60_000;
const ROLL_CALL_POLL_MS = 15_000;
const SWEEP_ROLES = new Set(['captain', 'co-captain', 'leader', 'sweeper', 'sweep', 'marshal']);

export class StartNeedsReasonError extends Error {}

export function useCaptainFlow(params: {
  rideId: string;
  rideName: string;
  rideStatus: string | undefined;
  userId: string | null | undefined;
  isAdmin: boolean;
  position: LocationUpdate | null;
  distanceKm?: number | null;
}) {
  const { rideId, rideName, rideStatus, userId, isAdmin, position, distanceKm } = params;
  const [briefing, setBriefing] = useState<BriefingState | null>(null);
  const [roster, setRoster] = useState<RollCallRow[]>([]);
  const [debriefInputs, setDebriefInputs] = useState<DebriefInputs | null>(null);
  const lastAutoCheckIn = useRef(0);

  const me = roster.find(r => r.user_id === userId);
  const myRole = isAdmin ? 'captain' : me?.role ?? null;
  const isLeader = isAdmin || myRole === 'captain' || myRole === 'co-captain' || myRole === 'leader';
  const canMarkAllThrough = isAdmin || (myRole != null && SWEEP_ROLES.has(myRole));

  const refreshBriefing = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_ride_briefing', { p_ride_id: rideId });
    if (error || !Array.isArray(data)) return;
    const row = data[0] as { version: number; hand_signals: string[]; notes: string | null; published_at: string; read_count: number; member_count: number } | undefined;
    setBriefing(row ? { version: row.version, handSignals: row.hand_signals ?? [], notes: row.notes, publishedAt: row.published_at, readCount: row.read_count, memberCount: row.member_count } : null);
  }, [rideId]);

  const refreshRollCall = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_roll_call', { p_ride_id: rideId });
    if (!error && Array.isArray(data)) setRoster(data as RollCallRow[]);
  }, [rideId]);

  const refreshDebrief = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_debrief_inputs', { p_ride_id: rideId });
    if (!error && data) setDebriefInputs(data as DebriefInputs);
  }, [rideId]);

  useEffect(() => {
    if (!rideId || !userId) return;
    void refreshBriefing();
    void refreshRollCall();
  }, [rideId, userId, refreshBriefing, refreshRollCall]);

  // While the pack gathers, the captain's roll call stays current.
  useEffect(() => {
    if (rideStatus !== 'planned' || !isLeader) return;
    const t = setInterval(() => { void refreshRollCall(); void refreshBriefing(); }, ROLL_CALL_POLL_MS);
    return () => clearInterval(t);
  }, [rideStatus, isLeader, refreshRollCall, refreshBriefing]);

  useEffect(() => {
    if (rideStatus === 'completed' && isLeader) void refreshDebrief();
  }, [rideStatus, isLeader, refreshDebrief]);

  // Automatic roll call. Before the start, GPS tracking is off, so take one
  // foreground fix a minute while this screen is open. The server checks the
  // distance (200 m) and freshness, so this cannot be faked from home.
  const myAttendance = me?.attendance_status;
  const isMember = Boolean(me);
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    if (rideStatus !== 'planned' || !userId || isAdmin || !isMember) return;
    if (myAttendance === 'checked_in' || myAttendance === 'absent') return;
    let cancelled = false;
    const attempt = async () => {
      const now = Date.now();
      if (now - lastAutoCheckIn.current < AUTO_CHECK_IN_EVERY_MS - 1000) return;
      lastAutoCheckIn.current = now;
      let fix: { lat: number; lng: number; at: string; accuracy: number | null } | null = null;
      const p = positionRef.current;
      if (p && now - Date.parse(p.timestamp) < 60_000) fix = { lat: p.lat, lng: p.lng, at: p.timestamp, accuracy: null };
      else {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (!perm.granted) return;
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          fix = { lat: loc.coords.latitude, lng: loc.coords.longitude, at: new Date(loc.timestamp).toISOString(), accuracy: loc.coords.accuracy ?? null };
        } catch { return; }
      }
      if (cancelled || !fix) return;
      const { data } = await supabase.rpc('report_roll_call_location', {
        p_ride_id: rideId, p_lat: fix.lat, p_lng: fix.lng, p_fix_at: fix.at, p_accuracy: fix.accuracy,
      });
      if (!cancelled && data === true) {
        track('captain_flow_step', { step: 'auto_check_in' });
        void refreshRollCall();
      }
    };
    void attempt();
    const t = setInterval(() => void attempt(), AUTO_CHECK_IN_EVERY_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [rideStatus, userId, isAdmin, isMember, myAttendance, rideId, refreshRollCall]);

  const riders: RollCallRider[] = useMemo(() => roster.map(r => ({
    userId: r.user_id, name: r.display_name || 'Rider', role: r.role, attendance: r.attendance_status, checkedInBy: r.checked_in_by,
  })), [roster]);
  const captainId = isAdmin ? userId : roster.find(r => r.role === 'captain' || r.role === 'leader')?.user_id;
  const rollCall = useMemo(() => summariseRollCall(riders, captainId), [riders, captainId]);
  const briefingRead = me?.briefing_read ?? false;

  const phase = captainPhase({ rideStatus: rideStatus ?? 'planned', briefingVersion: briefing?.version ?? null, debriefSaved: Boolean(debriefInputs?.debrief) });

  const publishBriefing = useCallback(async (handSignals: string[], notes: string) => {
    const { error } = await supabase.rpc('publish_ride_briefing', { p_ride_id: rideId, p_hand_signals: handSignals, p_notes: notes });
    if (error) throw new Error(error.message);
    track('captain_flow_step', { step: 'briefing_published' });
    await refreshBriefing();
  }, [rideId, refreshBriefing]);

  const markBriefingRead = useCallback(async () => {
    if (!briefing || briefingRead) return;
    await supabase.rpc('mark_briefing_read', { p_ride_id: rideId, p_version: briefing.version });
    void refreshRollCall();
  }, [briefing, briefingRead, rideId, refreshRollCall]);

  const setRiderStatus = useCallback(async (riderId: string, status: 'checked_in' | 'absent' | 'confirmed') => {
    setRoster(rows => rows.map(r => r.user_id === riderId
      ? { ...r, attendance_status: status, checked_in_by: status === 'checked_in' ? (riderId === userId ? 'self' : 'captain') : null }
      : r));
    const { error } = await supabase.rpc('set_roll_call_status', { p_ride_id: rideId, p_user_id: riderId, p_status: status });
    if (error) { void refreshRollCall(); throw new Error(error.message); }
  }, [rideId, userId, refreshRollCall]);

  /** Throws StartNeedsReasonError when riders are still waiting and no reason was given. */
  const startRide = useCallback(async (overrideReason?: string) => {
    const { data, error } = await supabase.rpc('start_ride', { p_ride_id: rideId, p_override_reason: overrideReason ?? null });
    if (error) {
      if (error.hint === 'start_anyway' || /Roll call not finished/.test(error.message)) throw new StartNeedsReasonError(error.message);
      throw new Error(error.message);
    }
    track('captain_flow_step', { step: overrideReason ? 'started_anyway' : 'started' });
    track('roll_call_completed', { waiting: rollCall.waiting.length, by_location: rollCall.byLocation });
    return data;
  }, [rideId, rollCall.waiting.length, rollCall.byLocation]);

  const endRide = useCallback(async () => {
    const { data, error } = await supabase.rpc('end_ride', { p_ride_id: rideId });
    if (error) throw new Error(error.message);
    void refreshDebrief();
    return data;
  }, [rideId, refreshDebrief]);

  const markAllThrough = useCallback(async (pointId: string) => {
    const { data, error } = await supabase.rpc('mark_regroup_all_through', { p_regroup_point_id: pointId });
    if (error) throw new Error(error.message);
    track('captain_flow_step', { step: 'all_through' });
    return (Array.isArray(data) ? data : []) as Array<{ missing_user_id: string; display_name: string }>;
  }, []);

  const generatedDebrief: Debrief | null = useMemo(() => {
    if (!debriefInputs) return null;
    const started = debriefInputs.started_at ? Date.parse(debriefInputs.started_at) : NaN;
    const ended = debriefInputs.ended_at ? Date.parse(debriefInputs.ended_at) : NaN;
    return buildDebrief({
      rideName,
      distanceKm,
      durationMinutes: Number.isFinite(started) && Number.isFinite(ended) ? (ended - started) / 60000 : null,
      riders: debriefInputs.riders,
      alerts: debriefInputs.alerts,
      regroupsMissing: debriefInputs.regroups_missing,
      startOverrideReason: debriefInputs.start_override_reason,
    });
  }, [debriefInputs, rideName, distanceKm]);

  const saveDebrief = useCallback(async (notes: string) => {
    if (!generatedDebrief) return;
    const { error } = await supabase.rpc('save_ride_debrief', {
      p_ride_id: rideId, p_summary: generatedDebrief.summary, p_facts: generatedDebrief.facts, p_notes: notes,
    });
    if (error) throw new Error(error.message);
    track('captain_flow_step', { step: 'debrief_saved' });
    await refreshDebrief();
  }, [rideId, generatedDebrief, refreshDebrief]);

  return {
    phase, briefing, briefingRead, rollCall, riders, myRole, isLeader, canMarkAllThrough,
    myCheckIn: me ? { status: me.attendance_status, by: me.checked_in_by } : null,
    savedDebrief: debriefInputs?.debrief ?? null, generatedDebrief,
    publishBriefing, markBriefingRead, setRiderStatus, startRide, endRide, markAllThrough, saveDebrief,
    refreshRollCall,
  };
}
