/** "Sun, 14 Dec" for a club ride date, or a placeholder when none is set. */
export function clubDate(iso: string | null) {
  if (!iso) return 'Date to be set';
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
