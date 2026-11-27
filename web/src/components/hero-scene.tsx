import SceneTilt from './scene-tilt';

/**
 * The home hero: a slab of terrain seen at an angle, built from stacked
 * contour layers in plain CSS 3D (no WebGL, so it costs phones almost
 * nothing). The group's route winds round the hill and two riders, the lead
 * and the sweep, travel along it. Decorative only, hidden from screen readers.
 */
const SIZE = 600;
export const ROUTE = 'M40 560 C 110 520, 150 440, 130 370 S 110 240, 190 200 S 320 140, 400 180 S 530 260, 545 170 S 520 70, 575 35';

/** A wobbly closed loop around (cx, cy). Fixed phases keep it identical on every render. */
function contour(cx: number, cy: number, r: number, seed: number) {
  const pts: string[] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.13 * Math.sin(3 * a + seed) + 0.07 * Math.sin(5 * a + seed * 2.1) + 0.04 * Math.sin(7 * a + seed * 0.7);
    pts.push(`${(cx + Math.cos(a) * r * k).toFixed(1)} ${(cy + Math.sin(a) * r * k * 0.86).toFixed(1)}`);
  }
  return 'M' + pts.join(' L') + 'Z';
}

const HILLS = [
  { cx: 330, cy: 360, r: 150, layers: 7, seed: 1.3 },
  { cx: 500, cy: 500, r: 70, layers: 4, seed: 4.1 },
  { cx: 120, cy: 110, r: 60, layers: 3, seed: 2.6 },
];

const LAYERS = HILLS.flatMap(h => Array.from({ length: h.layers }, (_, i) => ({
  d: contour(h.cx, h.cy, h.r * (1 - i / (h.layers + 0.6)), h.seed + i * 0.35),
  z: (i + 1) * 9,
  key: `${h.cx}-${i}`,
})));

const PINS = [
  { x: 190, y: 200, label: 'Regroup', tone: 'fg' },
  { x: 400, y: 180, label: 'Fuel', tone: 'accent' },
  { x: 575, y: 35, label: 'Stay', tone: 'fg' },
];

export default function HeroScene() {
  return (
    <div className="scene" aria-hidden>
      <SceneTilt>
        <div className="scene-plane" style={{ width: SIZE, height: SIZE }}>
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="scene-base">
            <defs>
              <pattern id="scene-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#1d1d21" strokeWidth="1" /></pattern>
              <radialGradient id="scene-glow" cx="50%" cy="55%" r="60%"><stop offset="0" stopColor="#ff8a2a" stopOpacity=".16" /><stop offset="1" stopColor="#ff8a2a" stopOpacity="0" /></radialGradient>
            </defs>
            <rect width={SIZE} height={SIZE} fill="#0b0b0d" />
            <rect width={SIZE} height={SIZE} fill="url(#scene-grid)" />
            <rect width={SIZE} height={SIZE} fill="url(#scene-glow)" />
          </svg>
          {LAYERS.map(l => (
            <svg key={l.key} viewBox={`0 0 ${SIZE} ${SIZE}`} className="scene-layer" style={{ transform: `translateZ(${l.z}px)` }}>
              <path d={l.d} />
            </svg>
          ))}
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="scene-route" style={{ transform: 'translateZ(2px)' }}>
            <path d={ROUTE} className="scene-road" />
            <path d={ROUTE} pathLength={1} className="scene-ink" />
          </svg>
          {PINS.map(p => (
            <div key={p.label} className="scene-at" style={{ left: p.x, top: p.y }}>
              <span className={'scene-ring scene-ring-' + p.tone} />
              <span className="scene-bb"><span className={'scene-tag scene-tag-' + p.tone}>{p.label}</span><span className="scene-stem" /></span>
            </div>
          ))}
          {[{ label: 'Lead', cls: 'scene-rider-lead' }, { label: 'Sweep', cls: 'scene-rider-sweep' }].map(r => (
            <div key={r.label} className={'scene-rider ' + r.cls} style={{ offsetPath: `path('${ROUTE}')` }}>
              <span className="scene-dot" />
              <span className="scene-bb"><span className="scene-tag scene-tag-live">{r.label}</span><span className="scene-stem" /></span>
            </div>
          ))}
        </div>
      </SceneTilt>
    </div>
  );
}
