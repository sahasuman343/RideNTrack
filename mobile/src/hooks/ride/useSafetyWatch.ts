import { useEffect } from 'react';
import { distanceMeters, distanceToRouteMeters, isStale, type AlertType, type LocationUpdate, type Ride } from '@ridentrack/shared';
import { enqueueAlert, newQueueId } from '../../lib/offlineQueue';

/*
 * Automatic group safety alerts on the live ride: "off the route" for this
 * rider, and "rider behind" (sent only by the leader, so each gap produces one
 * group alert). Both go through the offline alert queue with a cooldown.
 */

const SAFETY_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
// Outside the component so reopening the ride screen cannot re-send the same alert.
const safetyAlertCooldowns = new Map<string, number>();

export function useSafetyWatch(params: {
  rideId: string;
  userId: string | null | undefined;
  active: boolean;
  admin: boolean;
  ride: Ride | null;
  route: Ride['route_geometry'];
  position: LocationUpdate | null;
  participants: LocationUpdate[];
  now: number;
  setRouteDeviation: (meters: number | null) => void;
  setMessage: (m: string | null) => void;
  flushQueue: () => Promise<unknown> | void;
}) {
  const { rideId: id, userId, active, admin, ride, route, position, participants, now, setRouteDeviation, setMessage } = params;

  // Reserve the cooldown synchronously and keep it outside the component so
  // reopening the ride screen cannot re-send the same safety alert.
  const publishSafetyAlert = async (key: string, type: AlertType, lat: number, lng: number, alertMsg: string) => {
    if (!userId) return;
    const cooldownKey = id + ':' + userId + ':' + key;
    const nowMs = Date.now();
    if (nowMs - (safetyAlertCooldowns.get(cooldownKey) || 0) < SAFETY_ALERT_COOLDOWN_MS) return;
    safetyAlertCooldowns.set(cooldownKey, nowMs);
    try {
      await enqueueAlert({ id: await newQueueId(), ride_id: id, user_id: userId, type, lat, lng, message: alertMsg, created_at: new Date(nowMs).toISOString() });
      void params.flushQueue();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not publish a group safety alert.');
    }
  };

  // Route deviation depends only on this rider's own fix; it does not need to
  // rerun on clock ticks or other riders' presence updates.
  useEffect(() => {
    if (!active || !position || !userId || isStale(position.timestamp) || !ride) return;
    const routeCoordinates = route?.geometry?.coordinates;
    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      setRouteDeviation(null);
      return;
    }
    const deviation = distanceToRouteMeters(position, routeCoordinates);
    const limit = ride.route_deviation_threshold_meters || 500;
    setRouteDeviation(deviation);
    if (deviation > limit) {
      void publishSafetyAlert(
        'route-deviation',
        'route_deviation',
        position.lat,
        position.lng,
        'Rider is approximately ' + Math.round(deviation) + ' m from the planned route (threshold ' + limit + ' m).'
      );
    }
  }, [active, position, route, ride?.id, ride?.route_deviation_threshold_meters, userId, id]);

  // Only the leader broadcasts "rider behind" so each gap produces one group
  // alert. It also covers riders whose app is backgrounded. A lagging rider
  // gets a local notice instead of a duplicate broadcast.
  useEffect(() => {
    if (!active || !position || !userId || isStale(position.timestamp, now) || !ride) return;
    const limit = ride.rider_behind_threshold_meters || 1000;
    if (admin) {
      for (const rider of participants) {
        if (rider.user_id === ride.admin_id || rider.user_id === userId || isStale(rider.timestamp, now)) continue;
        if (!Number.isFinite(rider.lat) || !Number.isFinite(rider.lng)) continue;
        const gap = distanceMeters(position, rider);
        if (gap > limit) {
          void publishSafetyAlert(
            'rider-behind-' + rider.user_id,
            'rider_behind',
            rider.lat,
            rider.lng,
            rider.display_name + ' is approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).'
          );
        }
      }
      return;
    }
    const leader = participants.find(point => point.user_id === ride.admin_id && !isStale(point.timestamp, now));
    if (!leader || !Number.isFinite(leader.lat) || !Number.isFinite(leader.lng)) return;
    const gap = distanceMeters(leader, position);
    const cooldownKey = id + ':' + userId + ':rider-behind-self';
    if (gap > limit && now - (safetyAlertCooldowns.get(cooldownKey) || 0) >= SAFETY_ALERT_COOLDOWN_MS) {
      safetyAlertCooldowns.set(cooldownKey, now);
      setMessage('You are approximately ' + Math.round(gap) + ' m from the leader (threshold ' + limit + ' m).');
    }
  }, [active, position, participants, ride?.id, ride?.admin_id, ride?.rider_behind_threshold_meters, admin, userId, id, now]);
}
