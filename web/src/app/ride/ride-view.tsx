'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { type Ride, type LocationUpdate, type Alert, ALERT_LABELS, mergeAlerts, isStale, watchRide, type Connection } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import './ride.css';
const RideMap = dynamic(() => import('@/components/ride-map'), { ssr: false, loading: () => <div className="ride-loading">Loading map…</div> });
export default function RideView() {
  const rideId = useSearchParams().get('id');
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [riders, setRiders] = useState<LocationUpdate[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const onSelect = useCallback((id: string | null) => setSelected(id), []);
  useEffect(() => {
    if (!rideId || !/^[0-9a-f-]{36}$/i.test(rideId)) { router.replace('/dashboard'); return; }
    let cancelled = false;
    let feed: ReturnType<typeof watchRide> | undefined;
    const start = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) throw error;
      if (!session) { router.replace('/login'); return; }
      feed = watchRide(supabase, rideId, session.user.id, { ride: setRide, locations: setRiders,
        alerts: incoming => setAlerts(previous => mergeAlerts(previous,incoming)), connection: setConnection, error: setError });
    };
    void start().catch(e => { if (!cancelled) setError(e.message); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) { feed?.stop(); router.replace('/login'); }
    });
    return () => { cancelled = true; feed?.stop(); subscription.unsubscribe(); };
  }, [rideId,router,retry]);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    change(); window.addEventListener('online',change); window.addEventListener('offline',change);
    const timer = setInterval(() => setNow(Date.now()),5000);
    return () => { window.removeEventListener('online',change); window.removeEventListener('offline',change); clearInterval(timer); };
  }, []);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false),2000); return () => clearTimeout(timer); }, [copied]);
  const liveCount = riders.filter(p => !isStale(p.timestamp,now)).length;
  const shown = riders.filter(p => p.display_name.toLowerCase().includes(query.toLowerCase()));
  const freshAlerts = alerts.filter(a => !dismissed.includes(a.id) && now - Date.parse(a.created_at) < 3600000).slice(0,3);
  async function copyCode() {
    try { await navigator.clipboard.writeText(ride!.ride_code); setCopied(true); }
    catch { setError('Copy this ride code: ' + ride?.ride_code); }
  }
  if (!ride) return <main className="ride-loading"><Link className="wordmark" href="/dashboard">ride<span>n</span>track.</Link>
    {error ? <><h1>We couldn’t open this ride</h1><p role="alert">{error}</p><button className="primary-button" onClick={() => setRetry(v => v + 1)}>Try again</button></> : <><span className="loader" /><p>Connecting to your group…</p></>}
    <Link href="/dashboard">Back to rides</Link></main>;
  return <main className="ride-shell">
    <header className="ride-topbar"><Link href="/dashboard" className="wordmark">ride<span>n</span>track<span>.</span></Link><div className="topbar-divider" /><div className="topbar-ride"><span className="eyebrow">YOUR GROUP, IN SYNC</span><h1>{ride.name}</h1></div><div className={'connection-pill ' + (online && connection === 'live' ? '' : 'is-offline')} role="status"><i />{!online ? 'Offline' : connection === 'live' ? 'Connected' : 'Reconnecting'}</div><Link href="/dashboard" className="back-link">← All rides</Link></header>
    <div className="ride-workspace">
      <aside className={'ride-panel ' + (expanded ? 'is-expanded' : '')}>
        <button className="mobile-panel-toggle" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><span className="panel-handle" /><span>{liveCount} live · {riders.length} on map <b>{expanded ? '⌄' : '⌃'}</b></span></button>
        <div className="panel-intro"><div className="section-heading"><span className="eyebrow">RIDE OVERVIEW</span><span className={'ride-status ' + ride.status}>{ride.status}</span></div><h2>Every rider.<br />One adventure.</h2><div className="route-stops"><div><span className="stop-dot origin" /><span><small>STARTING POINT</small><strong>{ride.origin}</strong></span></div><div><span className="stop-dot destination" /><span><small>DESTINATION</small><strong>{ride.destination}</strong></span></div></div><button className="invite-code" onClick={() => void copyCode()} aria-label="Copy ride invitation code"><span>RIDE CODE</span><strong>{ride.ride_code}</strong><span>{copied ? 'Copied ✓' : 'Copy ↗'}</span></button></div>
        <div className="rider-section"><div className="section-heading"><h3>Your group <span>{riders.length}</span></h3><span className="live-label">{liveCount} live</span></div><label className="rider-search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a rider" aria-label="Find a rider" /></label><div className="rider-list">{shown.map(p => { const stale = isStale(p.timestamp,now); return <button key={p.user_id} className={'rider-row ' + (selected === p.user_id ? 'selected' : '')} onClick={() => setSelected(p.user_id)} aria-pressed={selected === p.user_id}><span className={'rider-avatar ' + (stale ? 'is-stale' : '')}>{p.display_name.slice(0,2).toUpperCase()}<i /></span><span className="rider-detail"><strong>{p.display_name}</strong><small>{stale ? 'Last seen ' + Math.max(1,Math.floor((now-Date.parse(p.timestamp))/60000)) + 'm ago' : 'Sharing location'}</small></span><span className="rider-speed">{stale ? '—' : Math.round(p.speed*3.6)}<small>km/h</small></span></button>; })}{!shown.length && <div className="rider-empty">{query ? 'No riders match your search.' : 'Waiting for rider locations. Open the mobile app and start the ride to appear here.'}</div>}</div></div>
        <div className="panel-footer"><span>◎</span><p>Tap a rider to follow.<br /><strong>Pan the map to explore freely.</strong></p></div>
      </aside>
      <section className="ride-map-area" aria-label="Ride map and controls"><RideMap key={ride.id} ride={ride} riders={riders} selected={selected} fitRequest={fitRequest} onSelect={onSelect} />
        <div className="map-top-controls"><div className="map-label"><span className="eyebrow">{ride.status === 'completed' ? 'RIDE COMPLETE' : 'LIVE RIDE MAP'}</span><strong>{selected ? 'Following ' + (riders.find(p => p.user_id === selected)?.display_name || 'rider') : 'A little closer, wherever you ride.'}</strong></div><button className="map-action" onClick={() => { setSelected(null); setFitRequest(v => v + 1); }}>⊞ <span>Fit group</span></button></div>
        {(error || !online) && <div className="ride-notice" role="alert"><span>{!online ? 'You’re offline. Showing last known positions.' : error}</span><button onClick={() => { setError(null); setRetry(v => v + 1); }}>Retry</button></div>}
        <div className="map-alerts" aria-live="polite">{freshAlerts.map(a => <div className="ride-alert" key={a.id}><div><strong>{ALERT_LABELS[a.type]}</strong><p>{a.display_name} · {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit',minute: '2-digit' })}</p>{a.message && <p>{a.message}</p>}</div><button aria-label="Dismiss alert" onClick={() => setDismissed(ids => [...ids,a.id])}>×</button></div>)}</div>
        <div className="map-bottom"><div className="map-legend"><span><i className="legend-live" />Live rider</span><span><i className="legend-stale" />Last known</span><span><i className="legend-route" />Planned route</span></div><span className="map-note">{ride.status === 'completed' ? 'Location sharing has ended' : 'Positions update automatically'}</span></div>
      </section>
    </div>
  </main>;
}
