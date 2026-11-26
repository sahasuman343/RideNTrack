'use client';
import { useEffect, useMemo, useState } from 'react';
import { CHECKLIST_CATEGORY_LABELS, type TripChecklistCategory, type TripChecklistItem } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';
import { friendlyTripError } from '@/lib/planner';

const ORDER = Object.keys(CHECKLIST_CATEGORY_LABELS) as TripChecklistCategory[];

interface Props {
  tripId: string;
  userId: string;
  isLeader: boolean;
  /** user_id → display name, for "claimed by". */
  names: Record<string, string>;
}

/** Each rider's pre-ride checklist, plus shared gear someone can claim. */
export default function TripChecklist({ tripId, userId, isLeader, names }: Props) {
  const [items, setItems] = useState<TripChecklistItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const first = await supabase.rpc('get_trip_checklists', { p_ride_id: tripId });
      if (cancelled) return;
      // Never seed over a failed read: same rule as the app.
      if (first.error) { setLoadError(true); return; }
      let list = Array.isArray(first.data) ? first.data as TripChecklistItem[] : [];
      if (list.length === 0 && isLeader) {
        await supabase.rpc('seed_default_trip_checklists', { p_ride_id: tripId });
        const again = await supabase.rpc('get_trip_checklists', { p_ride_id: tripId });
        if (cancelled) return;
        if (Array.isArray(again.data)) list = again.data as TripChecklistItem[];
      }
      setItems(list); setLoadError(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [tripId, isLeader, retry]);

  const groups = useMemo(() => ORDER.map(cat => ({ cat, list: (items ?? []).filter(i => i.category === cat) })).filter(g => g.list.length), [items]);
  const done = items?.filter(i => i.my_completed).length ?? 0;
  const total = items?.length ?? 0;
  const mandatoryLeft = items?.filter(i => i.is_mandatory && !i.my_completed).length ?? 0;

  async function toggle(item: TripChecklistItem) {
    if (pending) return;
    const next = !item.my_completed;
    setPending(item.id); setError(null);
    setItems(list => list?.map(i => i.id === item.id ? { ...i, my_completed: next, completed_count: i.completed_count + (next ? 1 : -1) } : i) ?? list);
    const { error: rpcError } = await supabase.rpc('toggle_trip_checklist_item', { p_checklist_id: item.id, p_completed: next });
    setPending(null);
    if (rpcError) {
      setItems(list => list?.map(i => i.id === item.id ? item : i) ?? list);
      setError(friendlyTripError(rpcError, 'Could not save that tick. Check your connection.'));
    }
  }

  async function claim(item: TripChecklistItem) {
    if (pending) return;
    const self = item.assigned_to_user_id !== userId;
    setPending(item.id); setError(null);
    const { error: rpcError } = await supabase.rpc('claim_trip_checklist_item', { p_checklist_id: item.id, p_assign_to_self: self });
    setPending(null);
    if (rpcError) { setError(friendlyTripError(rpcError, 'Could not update who is bringing it.')); return; }
    setItems(list => list?.map(i => i.id === item.id ? { ...i, assigned_to_user_id: self ? userId : null } : i) ?? list);
  }

  return (
    <section className="mt-10" aria-labelledby="checklist-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="checklist-heading" className="font-display text-xl font-semibold">Pre-ride checklist</h2>
        {items && total > 0 && <span className="font-mono text-sm"><span className={done === total ? 'text-live' : 'text-accent'}>{done}</span><span className="text-muted">/{total} ready</span></span>}
      </div>
      {items && total > 0 && (
        <>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-raise" role="progressbar" aria-label="Your checklist progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className={'h-full transition-[width] duration-300 ' + (done === total ? 'bg-live' : 'bg-accent')} style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{done === total ? 'You are ready to ride.' : mandatoryLeft ? `${mandatoryLeft} must-do ${mandatoryLeft === 1 ? 'item' : 'items'} left. Ticks are yours; the counts show the whole pack.` : 'Only optional items left.'}</p>
        </>
      )}
      {error && <p role="alert" className="notice notice-error mt-4">{error}</p>}

      {loadError ? (
        <div role="alert" className="notice notice-error mt-4">Could not load the checklist. <button className="underline" onClick={() => { setLoadError(false); setRetry(v => v + 1); }}>Try again</button></div>
      ) : !items ? (
        <div role="status" aria-label="Loading checklist" className="mt-4 space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-11 animate-pulse rounded bg-surface" />)}</div>
      ) : total === 0 ? (
        <p className="notice mt-4">The trip leader has not set up a checklist yet.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map(({ cat, list }) => (
            <fieldset key={cat}>
              <legend className="field-label">{CHECKLIST_CATEGORY_LABELS[cat].title}</legend>
              <ul className="divide-y divide-line rounded border border-line bg-surface">
                {list.map(item => {
                  const claimedBy = item.assigned_to_user_id ? (item.assigned_to_user_id === userId ? 'you' : names[item.assigned_to_user_id] || 'a rider') : null;
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <input id={'chk-' + item.id} type="checkbox" checked={item.my_completed} disabled={pending === item.id} onChange={() => void toggle(item)}
                        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)]" aria-describedby={'chk-meta-' + item.id} />
                      <span className="min-w-0 flex-1">
                        <label htmlFor={'chk-' + item.id} className="block cursor-pointer text-sm font-medium">
                          <span className={item.my_completed ? 'text-muted line-through decoration-line2' : ''}>{item.title}</span>{item.is_mandatory && <span className="ml-2 align-middle font-mono text-[10px] uppercase tracking-wider text-accent">Must do</span>}
                        </label>
                        {item.description && <span className="mt-0.5 block text-xs text-muted">{item.description}</span>}
                        <span id={'chk-meta-' + item.id} className="mt-1 block font-mono text-[11px] text-faint">{item.completed_count} {item.completed_count === 1 ? 'rider' : 'riders'} ticked{claimedBy ? ` · bringing it: ${claimedBy}` : ''}</span>
                      </span>
                      <button type="button" disabled={pending === item.id} onClick={() => void claim(item)} className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:bg-raise hover:text-fg">
                        {item.assigned_to_user_id === userId ? 'Not me' : 'I’ll bring it'}<span className="sr-only">: {item.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}
