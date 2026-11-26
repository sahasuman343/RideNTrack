'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  calculateExpenseSettlement, EXPENSE_CATEGORY_META,
  type TripExpense, type TripExpenseCategory, type TripExpenseSummary,
} from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

const CATEGORIES = Object.keys(EXPENSE_CATEGORY_META) as TripExpenseCategory[];
const MAX_AMOUNT = 99_999_999.99; // numeric(10, 2) on the server

export interface MoneyRider { user_id: string; display_name: string }

interface Props {
  tripId: string;
  userId: string;
  isLeader: boolean;
  /** Active riders who can share a cost. */
  riders: MoneyRider[];
}

export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    const whole = Math.abs(amount % 1) < 0.005;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Parses "1,250.5" style input. Returns null unless it is a positive amount with at most 2 decimals. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 && value <= MAX_AMOUNT ? value : null;
}

/** Shared trip costs: who paid, everyone's share, and who owes whom. */
export default function TripMoney({ tripId, userId, isLeader, riders }: Props) {
  const [expenses, setExpenses] = useState<TripExpense[] | null>(null);
  const [summary, setSummary] = useState<TripExpenseSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<TripExpense | null>(null);
  const [form, setForm] = useState({ title: '', amount: '', category: 'fuel' as TripExpenseCategory, notes: '', split: [] as string[] });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [list, sum] = await Promise.all([
        supabase.rpc('get_trip_expenses', { p_ride_id: tripId }),
        supabase.rpc('get_trip_expense_summary', { p_ride_id: tripId }),
      ]);
      if (cancelled) return;
      if (list.error || sum.error || !Array.isArray(list.data) || !sum.data || typeof sum.data !== 'object') { setLoadError(true); return; }
      setExpenses(list.data as TripExpense[]);
      setSummary(sum.data as TripExpenseSummary);
      setLoadError(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [tripId, reload]);

  const currency = summary?.currency || 'INR';
  const settlements = useMemo(() => calculateExpenseSettlement(summary?.participant_balances ?? [], currency), [summary, currency]);
  const categories = useMemo(() => {
    const entries = Object.entries(summary?.category_breakdown ?? {}).map(([cat, total]) => ({ cat: cat as TripExpenseCategory, total: Number(total) }));
    return entries.sort((a, b) => b.total - a.total);
  }, [summary]);
  const total = Number(summary?.total_spend ?? 0);

  function openForm() {
    setForm({ title: '', amount: '', category: 'fuel', notes: '', split: riders.map(r => r.user_id) });
    setNotice(null); setAdding(true);
  }

  function toggleSplit(id: string) {
    setForm(f => ({ ...f, split: f.split.includes(id) ? f.split.filter(x => x !== id) : [...f.split, id] }));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const amount = parseAmount(form.amount);
    if (!form.title.trim()) { setNotice({ text: 'Say what the expense was for.', error: true }); return; }
    if (amount == null) { setNotice({ text: 'Enter an amount above zero, with at most two decimals.', error: true }); return; }
    if (form.split.length === 0) { setNotice({ text: 'Pick at least one rider to share it.', error: true }); return; }
    setBusy(true); setNotice(null);
    const { error } = await supabase.rpc('add_trip_expense', {
      p_ride_id: tripId, p_title: form.title.trim(), p_amount: amount, p_category: form.category,
      p_split_user_ids: form.split, p_notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (error) { setNotice({ text: error.message || 'Could not save the expense. Check your connection.', error: true }); return; }
    setAdding(false);
    setNotice({ text: `${form.title.trim()} added and split between ${form.split.length} ${form.split.length === 1 ? 'rider' : 'riders'}.` });
    setReload(v => v + 1);
  }

  async function remove(expense: TripExpense) {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('delete_trip_expense', { p_expense_id: expense.id });
    setBusy(false); setConfirm(null);
    if (error) { setNotice({ text: error.message || 'Could not delete the expense.', error: true }); return; }
    // Drop the row now; the refetch below brings the balances up to date.
    setExpenses(list => list?.filter(x => x.id !== expense.id) ?? list);
    setNotice({ text: `${expense.title} was deleted.` });
    setReload(v => v + 1);
  }

  const net = Number(summary?.net_balance ?? 0);

  return (
    <section aria-labelledby="money-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="money-heading" className="font-display text-xl font-semibold">Money</h2>
        {!adding && <button type="button" onClick={openForm} disabled={!summary} className="btn btn-primary px-3 py-1.5 text-xs">Add expense</button>}
      </div>
      <p className="mt-1 text-xs text-muted">Costs are split equally between the riders you pick. Payments happen outside rideNtrack.</p>

      {notice && <p role={notice.error ? 'alert' : 'status'} className={'notice mt-4 ' + (notice.error ? 'notice-error' : '')}>{notice.text}</p>}

      {adding && (
        <form onSubmit={add} className="panel mt-4 space-y-4 p-5" aria-labelledby="add-expense-title">
          <h3 id="add-expense-title" className="text-sm font-semibold">New expense you paid</h3>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div><label htmlFor="expense-title" className="field-label">What for</label><input id="expense-title" className="field" maxLength={120} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Fuel at Rampur" /></div>
            <div><label htmlFor="expense-amount" className="field-label">Amount ({currency})</label><input id="expense-amount" className="field font-mono" inputMode="decimal" value={form.amount} onChange={e => { setForm(f => ({ ...f, amount: e.target.value })); if (notice?.error) setNotice(null); }} placeholder="0.00" /></div>
          </div>
          <div><label htmlFor="expense-category" className="field-label">Category</label>
            <select id="expense-category" className="field" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as TripExpenseCategory }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{EXPENSE_CATEGORY_META[c].label}</option>)}
            </select></div>
          <fieldset>
            <legend className="field-label">Split between</legend>
            <div className="flex flex-wrap gap-2">
              {riders.map(r => (
                <label key={r.user_id} className={'flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm ' + (form.split.includes(r.user_id) ? 'border-accent text-fg' : 'border-line2 text-muted')}>
                  <input type="checkbox" className="accent-[var(--color-accent)]" checked={form.split.includes(r.user_id)} onChange={() => toggleSplit(r.user_id)} />
                  {r.user_id === userId ? 'You' : r.display_name}
                </label>
              ))}
            </div>
            {form.split.length > 0 && parseAmount(form.amount) != null && (
              <p className="mt-2 text-xs text-muted">About {formatMoney(Math.floor((parseAmount(form.amount)! / form.split.length) * 100) / 100, currency)} each.</p>
            )}
          </fieldset>
          <div><label htmlFor="expense-notes" className="field-label">Notes (optional)</label><input id="expense-notes" className="field" maxLength={500} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Save expense'}</button>
            <button type="button" onClick={() => setAdding(false)} className="btn hover:bg-raise">Cancel</button>
          </div>
        </form>
      )}

      {loadError ? (
        <div role="alert" className="notice notice-error mt-4">Could not load the trip’s expenses. <button className="underline" onClick={() => { setLoadError(false); setReload(v => v + 1); }}>Try again</button></div>
      ) : !summary || !expenses ? (
        <div role="status" aria-label="Loading expenses" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded bg-surface" />)}</div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Trip total" value={formatMoney(total, currency)} />
            <Figure label="You paid" value={formatMoney(Number(summary.my_paid), currency)} />
            <Figure label="Your share" value={formatMoney(Number(summary.my_share), currency)} />
            <Figure label={net > 0.009 ? 'You get back' : net < -0.009 ? 'You owe' : 'Your balance'} value={formatMoney(Math.abs(net), currency)} tone={net > 0.009 ? 'live' : net < -0.009 ? 'danger' : undefined} />
          </dl>

          {expenses.length === 0 ? (
            <p className="notice mt-5">No expenses yet. Add fuel, food, stays or tolls as you go and rideNtrack works out who owes whom.</p>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div>
                <h3 className="eyebrow-label">Settle up</h3>
                {settlements.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Everyone is square.</p>
                ) : (
                  <ul className="mt-2 space-y-2" aria-label="Who owes whom">
                    {settlements.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 rounded border border-line bg-surface px-4 py-3 text-sm">
                        <span className="min-w-0"><span className={s.fromUserId === userId ? 'font-semibold' : ''}>{s.fromUserId === userId ? 'You' : s.fromName}</span> <span className="text-muted">pay{s.fromUserId === userId ? '' : 's'}</span> <span className={s.toUserId === userId ? 'font-semibold' : ''}>{s.toUserId === userId ? 'you' : s.toName}</span></span>
                        <span className="shrink-0 font-mono">{formatMoney(s.amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="eyebrow-label">Where it went</h3>
                <ul className="mt-2 space-y-2" aria-label="Spend by category">
                  {categories.map(c => (
                    <li key={c.cat} className="text-sm">
                      <div className="flex justify-between gap-3"><span>{EXPENSE_CATEGORY_META[c.cat]?.label ?? c.cat}</span><span className="font-mono text-muted">{formatMoney(c.total, currency)}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-raise" aria-hidden="true"><div className="h-full rounded-full bg-accent" style={{ width: `${total > 0 ? Math.max(2, (c.total / total) * 100) : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {expenses.length > 0 && (
            <>
              <h3 className="eyebrow-label mt-8">Expenses</h3>
              <ul className="mt-2 divide-y divide-line rounded border border-line bg-surface" aria-label="Trip expenses">
                {expenses.map(e => {
                  const mine = e.splits.find(s => s.user_id === userId);
                  const canDelete = e.payer_id === userId || isLeader;
                  return (
                    <li key={e.id} className="px-4 py-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{e.title}</span>
                          <span className="block text-xs text-muted">{EXPENSE_CATEGORY_META[e.category]?.label ?? e.category} · paid by {e.payer_id === userId ? 'you' : e.payer_name} · split {e.splits.length} ways{mine ? ` · your share ${formatMoney(Number(mine.amount), e.currency || currency)}` : ''}</span>
                          {e.notes && <span className="mt-1 block text-xs text-faint">{e.notes}</span>}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="font-mono">{formatMoney(Number(e.amount), e.currency || currency)}</span>
                          {canDelete && <button type="button" onClick={() => setConfirm(e)} className="text-xs text-muted underline hover:text-danger" aria-label={'Delete ' + e.title}>Delete</button>}
                        </span>
                      </div>
                      {confirm?.id === e.id && (
                        <div role="alertdialog" aria-labelledby={'del-' + e.id} className="notice notice-error mt-3 p-4">
                          <p id={'del-' + e.id} className="text-sm font-semibold">Delete “{e.title}” for everyone?</p>
                          <p className="mt-1 text-xs text-muted">Balances are worked out again without it.</p>
                          <div className="mt-3 flex gap-3">
                            <button type="button" onClick={() => void remove(e)} disabled={busy} className="btn btn-danger px-3 py-1.5 text-xs">{busy ? 'Deleting…' : 'Delete expense'}</button>
                            <button type="button" onClick={() => setConfirm(null)} className="btn px-3 py-1.5 text-xs hover:bg-raise">Keep it</button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'live' | 'danger' }) {
  return (
    <div className="rounded border border-line bg-surface px-4 py-3">
      <dt className="eyebrow-label text-[10px]">{label}</dt>
      <dd className={'mt-1 font-mono text-base font-semibold ' + (tone === 'live' ? 'text-live' : tone === 'danger' ? 'text-danger' : '')}>{value}</dd>
    </div>
  );
}
