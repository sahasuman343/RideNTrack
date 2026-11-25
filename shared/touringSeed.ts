/**
 * F10 seed content: five touring routes with reference lines, the fuel stops
 * riders rely on, and the advisories that catch people out.
 *
 * Everything here is UNVERIFIED (verified_at null) until someone checks it on
 * the ground for the season; the app says so next to each item. Edit this
 * file, then run `node scripts/touring-seed.cjs` to regenerate the SQL in the
 * F10 migration (a unit test keeps the two in step).
 */

import type { RouteAdvisory, RoutePoi, TouringRoute } from './touringKnowledge';

export const SEED_ROUTES: TouringRoute[] = [
  {
    id: 'manali-leh', name: 'Manali to Leh', region: 'Himachal Pradesh, Ladakh',
    line: [
      [77.1892, 32.2432], [77.1600, 32.3160], [77.1235, 32.4806], [76.9759, 32.5457], [77.0322, 32.5713],
      [77.1830, 32.6430], [77.2050, 32.6720], [77.4210, 32.7590], [77.5710, 32.9190], [77.7860, 33.1430],
      [77.7690, 33.5070], [77.8150, 33.8280], [77.7356, 33.9418], [77.5771, 34.1526],
    ],
  },
  {
    id: 'srinagar-leh', name: 'Srinagar to Leh', region: 'Jammu and Kashmir, Ladakh',
    line: [
      [74.7973, 34.0837], [75.2950, 34.3030], [75.4710, 34.2780], [75.7560, 34.4290], [76.1350, 34.5539],
      [76.3600, 34.3810], [76.7740, 34.2830], [76.8820, 34.3200], [77.3330, 34.1910], [77.5771, 34.1526],
    ],
  },
  {
    id: 'spiti-circuit', name: 'Shimla to Manali via Spiti', region: 'Himachal Pradesh',
    line: [
      [77.1734, 31.1048], [77.4600, 31.2560], [77.6330, 31.4500], [78.2700, 31.5390], [78.5800, 31.7600],
      [78.6270, 31.8810], [78.3880, 32.0920], [78.0710, 32.2270], [77.7590, 32.4380], [77.6360, 32.3960],
      [77.6200, 32.3600], [77.4400, 32.3300], [77.3060, 32.3750], [77.1600, 32.3160], [77.1892, 32.2432],
    ],
  },
  {
    id: 'mumbai-goa-nh66', name: 'Mumbai to Goa on NH66', region: 'Maharashtra, Goa',
    line: [
      [73.1175, 18.9894], [73.0850, 18.7370], [73.2700, 18.2360], [73.4170, 18.0830], [73.5150, 17.5310],
      [73.5520, 17.1870], [73.5180, 16.6560], [73.7120, 16.2650], [73.6860, 16.0110], [73.8180, 15.9050],
      [73.7960, 15.7230], [73.8120, 15.5920], [73.8278, 15.4909],
    ],
  },
  {
    id: 'bengaluru-ooty', name: 'Bengaluru to Ooty via Bandipur', region: 'Karnataka, Tamil Nadu',
    line: [
      [77.5946, 12.9716], [77.2800, 12.7200], [76.8950, 12.5220], [76.6394, 12.2958], [76.6830, 12.1170],
      [76.6900, 11.8100], [76.6330, 11.6670], [76.5840, 11.5700], [76.6400, 11.5700], [76.6950, 11.4102],
    ],
  },
];

export const SEED_POIS: RoutePoi[] = [
  { id: 'fuel-manali', route_id: 'manali-leh', kind: 'fuel', name: 'Manali fuel stations', lat: 32.2400, lng: 77.1890, source: 'seed' },
  { id: 'fuel-tandi', route_id: 'manali-leh', kind: 'fuel', name: 'Tandi fuel station', lat: 32.5457, lng: 76.9759, source: 'seed', note: 'Widely known as the last fuel before Karu, over 300 km on.' },
  { id: 'fuel-karu', route_id: 'manali-leh', kind: 'fuel', name: 'Karu fuel station', lat: 33.9418, lng: 77.7356, source: 'seed' },
  { id: 'fuel-leh', route_id: 'manali-leh', kind: 'fuel', name: 'Leh fuel stations', lat: 34.1526, lng: 77.5771, source: 'seed' },
  { id: 'fuel-kargil', route_id: 'srinagar-leh', kind: 'fuel', name: 'Kargil fuel stations', lat: 34.5539, lng: 76.1350, source: 'seed' },
  { id: 'fuel-kaza', route_id: 'spiti-circuit', kind: 'fuel', name: 'Kaza fuel station', lat: 32.2270, lng: 78.0710, source: 'seed', note: 'Next fuel towards Manali is at Manali itself.' },
  { id: 'fuel-reckong-peo', route_id: 'spiti-circuit', kind: 'fuel', name: 'Reckong Peo fuel station', lat: 31.5390, lng: 78.2700, source: 'seed' },
];

export const SEED_ADVISORIES: RouteAdvisory[] = [
  {
    id: 'manali-leh-season', route_id: 'manali-leh', kind: 'pass_window', title: 'Manali–Leh highway',
    body: 'Usually open from about June to mid-October. Opening dates move with snow clearing, so check before you go.',
    season_from: '06-01', season_to: '10-15',
  },
  {
    id: 'rohtang-permit', route_id: 'manali-leh', kind: 'permit', title: 'Rohtang Pass permit',
    body: 'Riding over Rohtang Pass from Manali needs an online permit from Himachal Pradesh. The Atal Tunnel route does not cross Rohtang.',
  },
  {
    id: 'manali-leh-altitude', route_id: 'manali-leh', kind: 'info', title: 'High passes',
    body: 'Baralacha La, Lachulung La and Tanglang La are near or above 5,000 m. Sleep a night at Keylong, Jispa or Sarchu to acclimatise.',
  },
  {
    id: 'zojila-season', route_id: 'srinagar-leh', kind: 'pass_window', title: 'Zoji La',
    body: 'Usually open from about May to November, with one-way traffic slots on some days.',
    season_from: '05-01', season_to: '11-15',
  },
  {
    id: 'ladakh-permit', route_id: 'srinagar-leh', kind: 'permit', title: 'Ladakh side trips',
    body: 'Nubra, Pangong and Tso Moriri need a Ladakh permit and environment fee, available online or in Leh.',
  },
  {
    id: 'kunzum-season', route_id: 'spiti-circuit', kind: 'pass_window', title: 'Kunzum La',
    body: 'Usually open from about mid-June to mid-October. Outside that, Spiti is reached only from the Kinnaur side.',
    season_from: '06-15', season_to: '10-15',
  },
  {
    id: 'kinnaur-ilp', route_id: 'spiti-circuit', kind: 'permit', title: 'Inner Line Permit near the border',
    body: 'Foreign riders need an Inner Line Permit for the Kinnaur–Spiti border stretch, issued in Reckong Peo, Kaza or Shimla.',
  },
  {
    id: 'konkan-monsoon', route_id: 'mumbai-goa-nh66', kind: 'info', title: 'Monsoon on the Konkan coast',
    body: 'Heavy rain from June to September; landslides and road works close stretches of NH66. Ride in daylight.',
    season_from: '06-01', season_to: '09-30',
  },
  {
    id: 'bandipur-night', route_id: 'bengaluru-ooty', kind: 'info', title: 'Bandipur and Mudumalai at night',
    body: 'The forest stretch is closed to traffic from 9 pm to 6 am. Plan to clear it in daylight.',
  },
];
