'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  formatLastSeenAgo,
  classifyRiderFreshness,
  type LocationUpdate,
  type Ride,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import '../../ride/ride.css';

const RideMap = dynamic(() => import('@/components/ride-map'), {
  ssr: false,
  loading: () => <div className="ride-loading">Loading spectator map…</div>,
});

interface PublicSnapshot {
  expires_at: string;
  ride: Ride;
  waypoints: Array<{
    name: string;
    waypoint_type: string;
    latitude: number;
    longitude: number;
    sequence: number;
  }>;
  participants: LocationUpdate[];
}

const POLL_INTERVAL_MS = 45_000;

export default function TrackView({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc('get_public_ride_snapshot', {
          p_token: token,
        });
        if (cancelled) return;
        if (error) {
          setConnectionError(error.message || 'Unable to refresh live positions.');
        } else if (!data) {
          setExpired(true);
          setConnectionError(null);
          setSnapshot(null);
        } else {
          setExpired(false);
          setConnectionError(null);
          setSnapshot(data as PublicSnapshot);
        }
      } catch {
        if (!cancelled) {
          setConnectionError('Network error while refreshing live positions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const pollTimer = setInterval(() => void load(), POLL_INTERVAL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, [token, retryCount]);

  if (loading) {
    return (
      <main className="ride-loading">
        <Link className="wordmark" href="/">
          ride<span>n</span>track.
        </Link>
        <span className="loader" />
        <p>Loading live family spectator view…</p>
      </main>
    );
  }

  if (expired) {
    return (
      <main className="ride-loading">
        <Link className="wordmark" href="/">
          ride<span>n</span>track.
        </Link>
        <h1>Link expired or revoked</h1>
        <p>
          This family spectator link is no longer active. Ask the ride organizer to
          generate a fresh live tracking link.
        </p>
        <Link href="/">Back to RideNTrack</Link>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="ride-loading">
        <Link className="wordmark" href="/">
          ride<span>n</span>track.
        </Link>
        <h1>Unable to load ride</h1>
        <p role="alert">{connectionError || 'Please check your connection and try again.'}</p>
        <button className="primary-button" onClick={() => setRetryCount(c => c + 1)}>
          Try again
        </button>
      </main>
    );
  }

  const { ride, participants, waypoints } = snapshot;

  return (
    <main className="ride-shell">
      <header className="ride-topbar">
        <Link href="/" className="wordmark">
          ride<span>n</span>track<span>.</span>
        </Link>
        <div className="topbar-divider" />
        <div className="topbar-ride">
          <span className="eyebrow">FAMILY SPECTATOR VIEW · READ-ONLY</span>
          <h1>{ride.name}</h1>
        </div>
        <div className={'connection-pill ' + (connectionError ? 'is-offline' : '')} role="status">
          <i />
          {connectionError ? 'Stale · Retrying' : 'Auto-refresh 45s'}
        </div>
      </header>

      <div className="ride-workspace">
        <aside className={'ride-panel ' + (expanded ? 'is-expanded' : '')}>
          <button
            className="mobile-panel-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(v => !v)}
          >
            <span className="panel-handle" />
            <span>
              {participants.length} rider{participants.length === 1 ? '' : 's'} tracked{' '}
              <b>{expanded ? '⌄' : '⌃'}</b>
            </span>
          </button>
          <div className="panel-intro">
            <div className="section-heading">
              <span className="eyebrow">ROUTE</span>
              <span className={'ride-status ' + ride.status}>{ride.status}</span>
            </div>
            <div className="route-stops" style={{ marginTop: 16 }}>
              <div>
                <span className="stop-dot origin" />
                <span>
                  <small>ORIGIN</small>
                  <strong>{ride.origin}</strong>
                </span>
              </div>
              <div>
                <span className="stop-dot destination" />
                <span>
                  <small>DESTINATION</small>
                  <strong>{ride.destination}</strong>
                </span>
              </div>
            </div>
            {waypoints.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 14 }}>
                {waypoints.length} planned stop{waypoints.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="rider-section">
            <div className="section-heading">
              <h3>
                Riders <span>{participants.length}</span>
              </h3>
            </div>
            <div className="rider-list">
              {participants.map(p => {
                const freshness = classifyRiderFreshness(p.timestamp, now);
                const lastSeen = formatLastSeenAgo(p.timestamp, now);
                return (
                  <button
                    key={p.user_id}
                    className={'rider-row ' + (selected === p.user_id ? 'selected' : '')}
                    onClick={() => setSelected(p.user_id)}
                  >
                    <span className={'rider-avatar ' + (freshness !== 'live' ? 'is-stale' : '')}>
                      {p.display_name.slice(0, 2).toUpperCase()}
                      <i />
                    </span>
                    <span className="rider-detail">
                      <strong>{p.display_name}</strong>
                      <small>{lastSeen}</small>
                    </span>
                  </button>
                );
              })}
              {!participants.length && (
                <div className="rider-empty">Waiting for rider GPS positions…</div>
              )}
            </div>
          </div>
        </aside>

        <section className="ride-map-area" aria-label="Live spectator map">
          <RideMap
            key={ride.id}
            ride={ride}
            riders={participants}
            selected={selected}
            fitRequest={fitRequest}
            onSelect={setSelected}
            bottomInset={0}
            now={now}
          />
          <div className="map-top-controls">
            <div className="map-label">
              <span className="eyebrow">LIVE SPECTATOR</span>
              <strong>{ride.name}</strong>
            </div>
            <button
              className="map-action"
              onClick={() => {
                setSelected(null);
                setFitRequest(v => v + 1);
              }}
            >
              ⊞ <span>Fit group</span>
            </button>
          </div>
          {connectionError && (
            <div className="ride-notice" role="alert">
              <span>{connectionError} Showing last known positions.</span>
              <button onClick={() => setRetryCount(c => c + 1)}>Retry</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
