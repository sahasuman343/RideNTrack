'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { searchPlaces, type PlaceResult } from '@ridentrack/shared';
import { MAPBOX_TOKEN } from '@/lib/planner';

interface Props {
  label: string;
  value: PlaceResult | null;
  onChange: (place: PlaceResult | null) => void;
  placeholder?: string;
  proximity?: [number, number] | null;
}

/** A combobox that searches Indian places as the rider types. */
export default function PlaceSearch({ label, value, onChange, placeholder, proximity }: Props) {
  const id = useId();
  const [query, setQuery] = useState(value?.address ?? '');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState('');
  const request = useRef(0);

  const trimmed = query.trim();
  const proximityKey = proximity ? proximity.join(',') : '';
  const searchable = open && !!MAPBOX_TOKEN && trimmed.length >= 2 && trimmed !== value?.address;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const current = ++request.current;
    const timer = setTimeout(() => {
      searchPlaces(trimmed, { token: MAPBOX_TOKEN, proximity: proximityKey ? (proximityKey.split(',').map(Number) as [number, number]) : null, signal: controller.signal }).then(found => {
        if (current !== request.current) return;
        setResults(found); setActive(0);
        setMessage(found.length ? '' : 'No matching places. Try a nearby landmark, town or PIN code.');
      }, error => {
        if (controller.signal.aborted || current !== request.current) return;
        setResults([]); setMessage(error instanceof Error ? error.message : 'Could not search places.');
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchable, trimmed, proximityKey]);

  const shownResults = searchable ? results : [];
  const shownMessage = !MAPBOX_TOKEN && open ? 'Place search needs a Mapbox token.' : searchable ? message : '';

  function choose(place: PlaceResult) {
    onChange(place); setQuery(place.address); setOpen(false); setResults([]);
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} role="combobox" aria-expanded={open && shownResults.length > 0} aria-controls={id + '-list'} aria-autocomplete="list"
        value={query} placeholder={placeholder} autoComplete="off"
        className="field"
        onChange={e => { setQuery(e.target.value); setOpen(true); setMessage(''); if (value) onChange(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!shownResults.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shownResults.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(shownResults[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && shownResults.length > 0 && (
        <ul id={id + '-list'} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-line2 bg-raise py-1 shadow-lg shadow-black/50">
          {shownResults.map((place, index) => (
            <li key={place.id} role="option" aria-selected={index === active}
              className={'cursor-pointer px-4 py-2.5 text-sm ' + (index === active ? 'bg-surface shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-surface')}
              onMouseDown={e => { e.preventDefault(); choose(place); }}>
              <span className="block font-medium text-fg">{place.name}</span>
              <span className="block truncate text-xs text-muted">{place.address}</span>
            </li>
          ))}
        </ul>
      )}
      {open && shownMessage && <p className="mt-1 text-xs text-muted">{shownMessage}</p>}
    </div>
  );
}
