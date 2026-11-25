/**
 * Ride attention queue.
 *
 * The live ride screen shows exactly one thing that needs the rider at a time.
 * Every feature that wants the rider's eyes adds an item here, never a banner of
 * its own. This module is pure so the ranking rules are unit-tested and the same
 * order holds on every device.
 */

export type AttentionKind =
  | 'crash_countdown'
  | 'incoming_sos'
  | 'check_in'
  | 'regroup'
  | 'all_through'
  | 'low_battery'
  | 'fuel'
  | 'voice_note'
  | 'hazard'
  | 'info';

/** Higher wins. Gaps leave room for later item types without renumbering. */
export const ATTENTION_PRIORITY: Record<AttentionKind, number> = {
  crash_countdown: 100,
  incoming_sos: 90,
  check_in: 80,
  regroup: 60,
  all_through: 58,
  low_battery: 52,
  fuel: 50,
  hazard: 45,
  voice_note: 30,
  info: 10,
};

export type AttentionTone = 'danger' | 'warning' | 'accent' | 'calm' | 'success';

export const ATTENTION_TONE: Record<AttentionKind, AttentionTone> = {
  crash_countdown: 'danger',
  incoming_sos: 'danger',
  check_in: 'danger',
  regroup: 'accent',
  all_through: 'accent',
  low_battery: 'warning',
  fuel: 'warning',
  hazard: 'warning',
  voice_note: 'calm',
  info: 'calm',
};

/** One haptic pattern per kind so riders can feel the difference without reading. */
export type HapticPattern = 'sos' | 'urgent' | 'nudge' | 'tick' | 'success' | 'none';

export const ATTENTION_HAPTIC: Record<AttentionKind, HapticPattern> = {
  crash_countdown: 'sos',
  incoming_sos: 'sos',
  check_in: 'urgent',
  regroup: 'nudge',
  all_through: 'nudge',
  low_battery: 'nudge',
  fuel: 'nudge',
  hazard: 'nudge',
  voice_note: 'tick',
  info: 'tick',
};

export interface AttentionAction {
  id: string;
  label: string;
  /** primary actions get the large glove-sized button. */
  emphasis?: 'primary' | 'secondary' | 'danger';
}

export interface AttentionItem {
  /** Stable id: the same underlying event must keep the same id across renders. */
  id: string;
  kind: AttentionKind;
  title: string;
  body?: string | null;
  /** ISO time the underlying event happened. Newer wins within the same kind. */
  createdAt: string;
  /** ISO time after which the item disappears on its own. */
  expiresAt?: string | null;
  /** Sticky items cannot be dismissed with the close button (SOS, crash). */
  sticky?: boolean;
  /** Seconds left on a countdown, shown as a large number. */
  countdownSeconds?: number | null;
  actions?: AttentionAction[];
  /** Optional overrides when a kind needs a different priority (e.g. own SOS confirmation). */
  priority?: number;
}

export function attentionPriority(item: Pick<AttentionItem, 'kind' | 'priority'>): number {
  return typeof item.priority === 'number' ? item.priority : ATTENTION_PRIORITY[item.kind];
}

function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Orders what the rider should see. Expired and dismissed items drop out;
 * sticky items ignore dismissal. Within a priority, an incoming SOS keeps the
 * oldest first (the first person who needed help stays on screen), everything
 * else shows the newest first.
 */
export function rankAttention(
  items: AttentionItem[],
  options: { now?: number; dismissedIds?: Iterable<string> } = {},
): AttentionItem[] {
  const now = options.now ?? Date.now();
  const dismissed = new Set(options.dismissedIds ?? []);
  const seen = new Set<string>();
  const live: AttentionItem[] = [];
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    if (!item.sticky && dismissed.has(item.id)) continue;
    if (item.expiresAt && timeOf(item.expiresAt) <= now) continue;
    live.push(item);
  }
  return live.sort((a, b) => {
    const p = attentionPriority(b) - attentionPriority(a);
    if (p !== 0) return p;
    const oldestFirst = a.kind === 'incoming_sos' && b.kind === 'incoming_sos';
    const t = timeOf(a.createdAt) - timeOf(b.createdAt);
    if (t !== 0) return oldestFirst ? t : -t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export interface AttentionView {
  current: AttentionItem | null;
  /** How many other items are waiting behind the current one. */
  waiting: number;
  /** True when the current item should replace the whole screen (crash countdown). */
  fullScreen: boolean;
  tone: AttentionTone;
  haptic: HapticPattern;
}

export function selectAttention(
  items: AttentionItem[],
  options: { now?: number; dismissedIds?: Iterable<string> } = {},
): AttentionView {
  const ranked = rankAttention(items, options);
  const current = ranked[0] ?? null;
  return {
    current,
    waiting: Math.max(0, ranked.length - 1),
    fullScreen: current?.kind === 'crash_countdown',
    tone: current ? ATTENTION_TONE[current.kind] : 'calm',
    haptic: current ? ATTENTION_HAPTIC[current.kind] : 'none',
  };
}

/**
 * Decides whether a change of the top item should buzz the phone. Re-renders
 * with the same item must not vibrate again, and a lower-priority item taking
 * over after a dismissal only gets a light tick.
 */
export function hapticForTransition(previous: AttentionItem | null, next: AttentionItem | null): HapticPattern {
  if (!next) return 'none';
  if (previous && previous.id === next.id) return 'none';
  if (previous && attentionPriority(previous) > attentionPriority(next)) {
    return ATTENTION_HAPTIC[next.kind] === 'none' ? 'none' : 'tick';
  }
  return ATTENTION_HAPTIC[next.kind];
}
