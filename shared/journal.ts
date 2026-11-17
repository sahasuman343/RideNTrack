/**
 * Ride Journal, Photos, Shareable Cards & Rider Analytics
 */

export interface JournalPhoto {
  url: string;
  caption?: string;
  taken_at?: string;
  latitude?: number;
  longitude?: number;
}

export interface TripJournalEntry {
  id?: string;
  ride_id: string;
  user_id: string;
  title: string;
  notes?: string | null;
  highlights?: string | null;
  rating?: number | null;
  photos: JournalPhoto[];
  created_at?: string;
  updated_at?: string;
}

export interface RiderMilestone {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface RiderAnalytics {
  total_distance_km: number;
  total_hours: number;
  completed_trips: number;
  active_trips: number;
  milestones: RiderMilestone[];
}

export interface ShareableRideCardData {
  tripName: string;
  riderName: string;
  machine?: string | null;
  distanceKm: number;
  origin: string;
  destination: string;
  stopsCount: number;
  rating?: number | null;
  highlights?: string | null;
}

export function formatShareableRideCard(data: ShareableRideCardData): string {
  const stars = data.rating ? ' ' + '★'.repeat(Math.max(1, Math.min(5, data.rating))) + '☆'.repeat(Math.max(0, 5 - Math.max(1, Math.min(5, data.rating)))) : '';
  const bike = data.machine ? `\n🏍️ Machine: ${data.machine}` : '';
  const highlights = data.highlights ? `\n✨ Highlights: ${data.highlights}` : '';
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🏍️ RIDEN TRACK JOURNEY CARD`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🗺️ Trip: ${data.tripName}${stars}`,
    `👤 Rider: ${data.riderName}${bike}`,
    `📍 Route: ${data.origin} → ${data.destination}`,
    `📏 Distance: ${data.distanceKm} km · ${data.stopsCount} stops`,
    highlights,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Preserve memories & track your motorcycle tours on RideNTrack.`,
  ].filter(Boolean).join('\n');
}
