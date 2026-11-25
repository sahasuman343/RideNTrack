/**
 * F9 lock-screen emergency card.
 *
 * Opt-in, off by default: it shows medical details to anyone holding the
 * phone. On Android it rides on the ongoing live-ride notification; on iPhone
 * one notification is posted at ride start (Medical ID is the real answer).
 */

export interface LockScreenCardInput {
  riderName: string;
  bloodGroup?: string | null;
  emergencyContact?: string | null;
  captain?: { name: string; phone: string } | null;
}

export interface LockScreenCard {
  title: string;
  body: string;
}

/** Keeps the card readable in a collapsed notification (Android shows ~2 lines). */
export const LOCK_SCREEN_BODY_MAX = 120;

export function lockScreenCard(input: LockScreenCardInput): LockScreenCard | null {
  const parts: string[] = [];
  const blood = input.bloodGroup?.trim().toUpperCase();
  if (blood) parts.push(`Blood ${blood}`);
  const contact = input.emergencyContact?.trim();
  if (contact) parts.push(`ICE ${contact}`);
  if (input.captain?.phone) parts.push(`Ride captain ${input.captain.name.split(' ')[0]} ${input.captain.phone}`);
  if (!parts.length) return null;
  let body = parts.join(' · ');
  if (body.length > LOCK_SCREEN_BODY_MAX) body = body.slice(0, LOCK_SCREEN_BODY_MAX - 1).trimEnd() + '…';
  return { title: `In an emergency: ${input.riderName || 'this rider'}`, body };
}

/** The usual live-ride notification when the card is off or empty. */
export function liveRideNotification(activeRiders: number | null | undefined): LockScreenCard {
  return {
    title: 'RideNTrack · Sharing location',
    body: activeRiders && activeRiders > 0
      ? `Live pack: ${activeRiders} rider${activeRiders === 1 ? '' : 's'} active`
      : 'Your group can see your position.',
  };
}
