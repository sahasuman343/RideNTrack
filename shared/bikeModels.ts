/*
 * F3 bike model database: popular touring and commuter bikes in India with
 * tank size, real-world mileage and a sensible reserve. Picking one fills the
 * profile so fuel planning works without the rider knowing these numbers.
 * Figures are approximate and the rider can still edit them.
 * The motorcycle_models table is seeded from this list (see migration
 * 20261201000500); a unit test keeps the two in step.
 */

export type BikeCategory = 'adventure' | 'tourer' | 'cruiser' | 'sport' | 'commuter' | 'scooter';

export interface BikeModel {
  id: string;
  make: string;
  model: string;
  category: BikeCategory;
  tankLiters: number;
  mileageKmpl: number;
  reserveLiters: number;
}

type Row = [id: string, make: string, model: string, category: BikeCategory, tank: number, kmpl: number, reserve: number];

const ROWS: Row[] = [
  ['re-himalayan-450', 'Royal Enfield', 'Himalayan 450', 'adventure', 17, 30, 3],
  ['re-himalayan-411', 'Royal Enfield', 'Himalayan 411', 'adventure', 15, 30, 3],
  ['re-classic-350', 'Royal Enfield', 'Classic 350', 'cruiser', 13, 35, 2.5],
  ['re-bullet-350', 'Royal Enfield', 'Bullet 350', 'cruiser', 13, 35, 2.5],
  ['re-meteor-350', 'Royal Enfield', 'Meteor 350', 'cruiser', 15, 35, 3],
  ['re-hunter-350', 'Royal Enfield', 'Hunter 350', 'commuter', 13, 36, 2.5],
  ['re-interceptor-650', 'Royal Enfield', 'Interceptor 650', 'tourer', 13.7, 23, 3],
  ['re-continental-gt-650', 'Royal Enfield', 'Continental GT 650', 'sport', 12.5, 23, 3],
  ['re-super-meteor-650', 'Royal Enfield', 'Super Meteor 650', 'cruiser', 15.7, 22, 3],
  ['re-scram-411', 'Royal Enfield', 'Scram 411', 'adventure', 15, 30, 3],
  ['re-guerrilla-450', 'Royal Enfield', 'Guerrilla 450', 'commuter', 11, 29, 2],
  ['ktm-390-adventure', 'KTM', '390 Adventure', 'adventure', 14.5, 27, 2.5],
  ['ktm-250-adventure', 'KTM', '250 Adventure', 'adventure', 14.5, 30, 2.5],
  ['ktm-390-duke', 'KTM', '390 Duke', 'sport', 15, 28, 2.5],
  ['ktm-200-duke', 'KTM', '200 Duke', 'sport', 13.4, 35, 2],
  ['ktm-rc-390', 'KTM', 'RC 390', 'sport', 13.7, 27, 2.5],
  ['bajaj-dominar-400', 'Bajaj', 'Dominar 400', 'tourer', 13, 27, 3],
  ['bajaj-dominar-250', 'Bajaj', 'Dominar 250', 'tourer', 13, 33, 3],
  ['bajaj-pulsar-ns200', 'Bajaj', 'Pulsar NS200', 'sport', 12, 36, 2],
  ['bajaj-pulsar-n250', 'Bajaj', 'Pulsar N250', 'commuter', 14, 35, 2.5],
  ['bajaj-pulsar-150', 'Bajaj', 'Pulsar 150', 'commuter', 15, 45, 2.5],
  ['bajaj-avenger-220', 'Bajaj', 'Avenger Cruise 220', 'cruiser', 13, 40, 2.5],
  ['hero-xpulse-200-4v', 'Hero', 'XPulse 200 4V', 'adventure', 13, 40, 2],
  ['hero-xpulse-210', 'Hero', 'XPulse 210', 'adventure', 13, 38, 2],
  ['hero-xtreme-160r', 'Hero', 'Xtreme 160R', 'commuter', 12, 45, 2],
  ['hero-splendor-plus', 'Hero', 'Splendor Plus', 'commuter', 9.8, 65, 1.5],
  ['hero-mavrick-440', 'Hero', 'Mavrick 440', 'tourer', 13.5, 30, 2.5],
  ['tvs-apache-rtr-310', 'TVS', 'Apache RTR 310', 'sport', 11, 30, 2],
  ['tvs-apache-rr-310', 'TVS', 'Apache RR 310', 'sport', 11, 30, 2],
  ['tvs-apache-rtr-160-4v', 'TVS', 'Apache RTR 160 4V', 'commuter', 12, 45, 2],
  ['tvs-ronin', 'TVS', 'Ronin', 'cruiser', 14, 40, 2.5],
  ['tvs-jupiter-125', 'TVS', 'Jupiter 125', 'scooter', 5.1, 50, 1],
  ['tvs-ntorq-125', 'TVS', 'Ntorq 125', 'scooter', 5.8, 45, 1],
  ['honda-cb350', 'Honda', 'H\'ness CB350', 'cruiser', 15, 35, 3],
  ['honda-cb350rs', 'Honda', 'CB350RS', 'commuter', 15, 35, 3],
  ['honda-cb200x', 'Honda', 'CB200X', 'adventure', 12, 40, 2],
  ['honda-nx500', 'Honda', 'NX500', 'adventure', 17.5, 27, 3],
  ['honda-shine-125', 'Honda', 'Shine 125', 'commuter', 10.5, 55, 1.5],
  ['honda-activa-6g', 'Honda', 'Activa 6G', 'scooter', 5.3, 50, 1],
  ['yamaha-r15-v4', 'Yamaha', 'R15 V4', 'sport', 11, 40, 2],
  ['yamaha-mt-15', 'Yamaha', 'MT-15', 'sport', 10, 45, 2],
  ['yamaha-fz-s', 'Yamaha', 'FZ-S FI', 'commuter', 13, 45, 2],
  ['suzuki-v-strom-sx', 'Suzuki', 'V-Strom SX 250', 'adventure', 12, 35, 2],
  ['suzuki-gixxer-sf-250', 'Suzuki', 'Gixxer SF 250', 'sport', 12, 35, 2],
  ['suzuki-access-125', 'Suzuki', 'Access 125', 'scooter', 5, 50, 1],
  ['jawa-42', 'Jawa', '42', 'cruiser', 14, 33, 2.5],
  ['yezdi-adventure', 'Yezdi', 'Adventure', 'adventure', 15.5, 30, 3],
  ['triumph-speed-400', 'Triumph', 'Speed 400', 'commuter', 13, 30, 2.5],
  ['triumph-scrambler-400x', 'Triumph', 'Scrambler 400 X', 'adventure', 13, 30, 2.5],
  ['triumph-tiger-900', 'Triumph', 'Tiger 900', 'adventure', 20, 19, 4],
  ['bmw-g310-gs', 'BMW', 'G 310 GS', 'adventure', 11, 30, 2],
  ['bmw-r1250-gs', 'BMW', 'R 1250 GS', 'adventure', 20, 18, 4],
  ['kawasaki-versys-650', 'Kawasaki', 'Versys 650', 'tourer', 21, 20, 4],
  ['kawasaki-z900', 'Kawasaki', 'Z900', 'sport', 17, 17, 3],
  ['harley-x440', 'Harley-Davidson', 'X440', 'cruiser', 13.5, 30, 2.5],
];

export const BIKE_MODELS: BikeModel[] = ROWS.map(([id, make, model, category, tankLiters, mileageKmpl, reserveLiters]) => ({
  id, make, model, category, tankLiters, mileageKmpl, reserveLiters,
}));

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Search by any word of make or model; "hima 450" finds Himalayan 450. */
export function searchBikeModels(query: string, limit = 8): BikeModel[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ bike: BikeModel; score: number }> = [];
  for (const bike of BIKE_MODELS) {
    const hay = norm(`${bike.make} ${bike.model}`);
    const tokens = hay.split(' ');
    if (!words.every(w => hay.includes(w))) continue;
    const score = words.reduce((sum, w) => sum + (tokens.some(t => t.startsWith(w)) ? 2 : 1), 0) + (norm(bike.model).startsWith(words[0]) ? 1 : 0);
    scored.push({ bike, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.bike.model.localeCompare(b.bike.model)).slice(0, limit).map(s => s.bike);
}

/** Match a free-text make and model (older profiles) back to the catalogue. */
export function findBikeModel(make: string | null | undefined, model: string | null | undefined): BikeModel | null {
  const m = norm(model ?? '');
  if (!m) return null;
  const k = norm(make ?? '');
  return BIKE_MODELS.find(b => norm(b.model) === m && (!k || norm(b.make) === k)) ?? null;
}

export function bikeRangeKm(bike: Pick<BikeModel, 'tankLiters' | 'mileageKmpl' | 'reserveLiters'>): number {
  return Math.round((bike.tankLiters - bike.reserveLiters) * bike.mileageKmpl);
}
