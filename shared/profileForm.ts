/**
 * Profile edits shared by the web profile page: the same checks the mobile
 * profile screen makes, so both refuse the same input before it is saved.
 * The database keeps its own constraints; these only give a clear message.
 */

export type ProfileSection = 'rider' | 'emergency' | 'bike';
export type MotorcycleCategory = 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter';

export const MOTORCYCLE_CATEGORIES: { value: MotorcycleCategory; label: string }[] = [
  { value: 'adventure', label: 'Adventure' },
  { value: 'tourer', label: 'Tourer' },
  { value: 'cruiser', label: 'Cruiser' },
  { value: 'sport', label: 'Sport' },
  { value: 'commuter', label: 'Commuter' },
  { value: 'scooter', label: 'Scooter' },
];

export interface ProfileFormInput {
  display_name?: string;
  phone?: string;
  avatar_url?: string;
  emergency_contact?: string;
  blood_group?: string;
  share_ice_with_ride?: boolean;
  share_phone_with_ride?: boolean;
  motorcycle_make?: string;
  motorcycle_model?: string;
  motorcycle_category?: MotorcycleCategory | '';
  fuel_tank_capacity_liters?: string;
  mileage_km_per_liter?: string;
  fuel_reserve_liters?: string;
}

export type ProfileUpdate = Record<string, string | number | boolean | null>;

function num(text: string | undefined): number | null | typeof NaN {
  const t = (text ?? '').trim();
  return t ? Number(t) : null;
}

/** The columns to save for one section, or the first problem in it. */
export function profileUpdateFor(section: ProfileSection, f: ProfileFormInput, opts: { phoneSharing?: boolean } = {}): { ok: true; values: ProfileUpdate } | { ok: false; error: string } {
  if (section === 'rider') {
    const name = (f.display_name ?? '').trim();
    const phone = (f.phone ?? '').trim();
    const avatar = (f.avatar_url ?? '').trim();
    if (!name) return { ok: false, error: 'Enter the name other riders see.' };
    if (name.length > 60) return { ok: false, error: 'Keep your name to 60 characters.' };
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return { ok: false, error: 'Check the phone number. Include the country code if needed.' };
    if (avatar && !/^https:\/\//i.test(avatar)) return { ok: false, error: 'Use a photo link that starts with https://.' };
    return { ok: true, values: { display_name: name, phone: phone || null, avatar_url: avatar || null } };
  }
  if (section === 'emergency') {
    const contact = (f.emergency_contact ?? '').trim();
    const blood = (f.blood_group ?? '').trim().toUpperCase();
    if (contact && !/^\+?[0-9 ()-]{7,25}$/.test(contact)) return { ok: false, error: 'Check the emergency contact number. Include the country code.' };
    if (blood && !/^(A|B|AB|O)[+-]$/.test(blood)) return { ok: false, error: 'Use A, B, AB or O followed by + or -, or leave blood group blank.' };
    return {
      ok: true,
      values: {
        emergency_contact: contact || null,
        blood_group: blood || null,
        share_ice_with_ride: Boolean(f.share_ice_with_ride),
        ...(opts.phoneSharing ? { share_phone_with_ride: Boolean(f.share_phone_with_ride) } : {}),
      },
    };
  }
  const tank = num(f.fuel_tank_capacity_liters);
  const mileage = num(f.mileage_km_per_liter);
  const reserve = num(f.fuel_reserve_liters);
  if (tank != null && (!Number.isFinite(tank) || tank <= 0 || tank > 100)) return { ok: false, error: 'Tank size should be between 1 and 100 litres.' };
  if (mileage != null && (!Number.isFinite(mileage) || mileage <= 0 || mileage > 150)) return { ok: false, error: 'Mileage should be between 1 and 150 km per litre.' };
  if (reserve != null && (!Number.isFinite(reserve) || reserve < 0 || reserve > 30 || (tank != null && reserve >= tank))) return { ok: false, error: 'Reserve should be 0 to 30 litres and less than the tank.' };
  const category = f.motorcycle_category || null;
  if (category && !MOTORCYCLE_CATEGORIES.some(c => c.value === category)) return { ok: false, error: 'Pick a type from the list.' };
  return {
    ok: true,
    values: {
      motorcycle_make: (f.motorcycle_make ?? '').trim() || null,
      motorcycle_model: (f.motorcycle_model ?? '').trim() || null,
      motorcycle_category: category,
      fuel_tank_capacity_liters: tank,
      mileage_km_per_liter: mileage,
      fuel_reserve_liters: reserve,
    },
  };
}

/** Only the columns that differ from what is saved, so an unchanged form writes nothing. */
export function changedProfileValues(values: ProfileUpdate, saved: Record<string, unknown>): ProfileUpdate {
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== ((saved[k] as unknown) ?? null)));
}

/** Range on a full tank, and before dipping into reserve, in whole km. */
export function fuelRangeKm(p: { fuel_tank_capacity_liters?: number | null; mileage_km_per_liter?: number | null; fuel_reserve_liters?: number | null }): { total: number; beforeReserve: number | null } | null {
  const tank = p.fuel_tank_capacity_liters, kmpl = p.mileage_km_per_liter;
  if (!tank || !kmpl) return null;
  const reserve = p.fuel_reserve_liters ?? 0;
  return { total: Math.round(tank * kmpl), beforeReserve: reserve < tank ? Math.round((tank - reserve) * kmpl) : null };
}

/** Saved places take coordinates as typed text; both must be real. */
export function parseCoordinates(lat: string, lng: string): { lat: number; lng: number } | null {
  if (!lat.trim() || !lng.trim()) return null;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
}
