/*
 * F6 SMS fallback for SOS. After pressing SOS the rider always knows exactly
 * what happened and what is left to do, in the shared status words.
 * Recipients are cached on the phone when the ride starts, because at SOS time
 * there may be no data at all.
 */
import { normaliseFamilyPhone } from './family';

export type SosRecipientRole = 'emergency_contact' | 'sweep' | 'captain' | 'co-captain';

export interface SosRecipient { name: string; phone: string; role: SosRecipientRole }

const ROLE_ORDER: Record<SosRecipientRole, number> = { emergency_contact: 0, sweep: 1, captain: 2, 'co-captain': 3 };
export const MAX_SOS_RECIPIENTS = 5;

/** Emergency contact first, then sweep, then captain; deduped by number, never the rider's own. */
export function mergeSosRecipients(list: Array<{ name?: string | null; phone?: string | null; role: string }>, ownPhone?: string | null): SosRecipient[] {
  const own = ownPhone ? normaliseFamilyPhone(ownPhone) : null;
  const seen = new Set<string>();
  const out: SosRecipient[] = [];
  const sorted = list
    .map(r => ({ ...r, role: (r.role === 'sweeper' ? 'sweep' : r.role === 'leader' ? 'captain' : r.role) as SosRecipientRole }))
    .filter(r => r.role in ROLE_ORDER)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  for (const r of sorted) {
    const phone = normaliseFamilyPhone(r.phone ?? '');
    if (!phone || phone === own || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: r.name?.trim() || (r.role === 'emergency_contact' ? 'Emergency contact' : r.role === 'sweep' ? 'Sweep' : 'Captain'), phone, role: r.role });
    if (out.length >= MAX_SOS_RECIPIENTS) break;
  }
  return out;
}

/** One composer for several people. Android separates with ";", iOS with ",". */
export function smsComposerUrl(phones: string[], body: string, platform: 'ios' | 'android' | string): string {
  const to = phones.join(platform === 'ios' ? ',' : ';');
  return `sms:${to}${platform === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export type SosStepState = 'pending' | 'sending' | 'sent' | 'sent_by_sms' | 'waiting_for_signal' | 'action_needed' | 'failed' | 'skipped';

export interface SosStep { id: 'pack' | 'texts' | 'server'; label: string; status: string; state: SosStepState }

export function sosPrimaryLabel(input: { online: boolean; recipients: number }): string {
  if (input.online) return 'Send SOS';
  if (input.recipients > 0) return `No signal: tap Send to text ${input.recipients} ${input.recipients === 1 ? 'person' : 'people'}`;
  return 'No signal: save SOS for the pack';
}

export function sosSteps(input: {
  pack: 'pending' | 'sent' | 'queued' | 'failed';
  composer: 'pending' | 'opened' | 'unavailable' | 'no_recipients';
  server: 'off' | 'pending' | 'queued' | 'sent' | 'failed';
  recipients: SosRecipient[];
}): SosStep[] {
  const n = input.recipients.length;
  const who = n ? input.recipients.map(r => r.name).slice(0, 3).join(', ') + (n > 3 ? ` +${n - 3}` : '') : 'nobody yet';
  const steps: SosStep[] = [];
  steps.push({
    id: 'pack',
    label: 'Alert to your pack',
    state: input.pack === 'sent' ? 'sent' : input.pack === 'queued' ? 'waiting_for_signal' : input.pack === 'failed' ? 'failed' : 'sending',
    status: input.pack === 'sent' ? 'Sent' : input.pack === 'queued' ? 'Waiting for signal' : input.pack === 'failed' ? 'Failed' : 'Sending',
  });
  if (input.server !== 'off' && input.server !== 'failed') {
    steps.push({
      id: 'server',
      label: `Text from RideNTrack to ${who}`,
      state: input.server === 'sent' ? 'sent_by_sms' : input.server === 'queued' ? 'sending' : 'pending',
      status: input.server === 'sent' ? 'Sent by SMS' : input.server === 'queued' ? 'Sending' : 'Waiting for signal',
    });
  }
  steps.push({
    id: 'texts',
    label: n ? `Text from your phone to ${who}` : 'Text from your phone',
    state: input.composer === 'opened' ? 'action_needed' : input.composer === 'no_recipients' ? 'skipped' : input.composer === 'unavailable' ? 'failed' : 'pending',
    status: input.composer === 'opened' ? 'Tap Send in Messages' : input.composer === 'no_recipients' ? 'Add an emergency contact' : input.composer === 'unavailable' ? 'Could not open Messages' : 'Next',
  });
  return steps;
}
