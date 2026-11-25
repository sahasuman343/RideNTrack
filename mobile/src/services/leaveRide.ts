import { supabase } from '../lib/supabase';
import { getQueuedCountForRide } from '../lib/offlineQueue';
import { stopBackgroundLocationUpdates } from './backgroundLocation';
import { syncQueue } from './syncQueue';

/**
 * Leave a ride without losing breadcrumbs. Once leave_ride runs the server no
 * longer accepts this rider's points for the ride, so stop GPS and upload the
 * offline queue first. If points are still unsent (no signal), refuse rather
 * than silently discard the rider's track.
 */
export async function leaveRideSafely(rideId: string, userId: string) {
  await stopBackgroundLocationUpdates(rideId).catch(() => {});
  await syncQueue().catch(() => {});
  const pending = await getQueuedCountForRide(userId, rideId).catch(() => 0);
  if (pending > 0) {
    throw new Error(`${pending} GPS point${pending === 1 ? '' : 's'} from this ride haven't uploaded yet. Connect to the internet, then leave the ride.`);
  }
  const { error } = await supabase.rpc('leave_ride', { p_ride_id: rideId });
  if (error) throw error;
}
