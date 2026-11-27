#!/usr/bin/env node
// Prints the SQL seed for the F10 touring tables from shared/touringSeed.ts.
// Usage: node scripts/touring-seed.cjs > /tmp/seed.sql, then paste between the
// "-- seed:begin" and "-- seed:end" markers of the F10 migration (or pass
// --write to replace them in place).
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

const q = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function seedSql() {
  const { SEED_ROUTES, SEED_POIS, SEED_ADVISORIES } = load(path.resolve(__dirname, '../shared/touringSeed.ts'));
  const lines = [];
  lines.push('INSERT INTO public.touring_routes (id, name, region, line) VALUES');
  lines.push(SEED_ROUTES.map(r => `  (${q(r.id)}, ${q(r.name)}, ${q(r.region)}, ${q(JSON.stringify(r.line))}::jsonb)`).join(',\n'));
  lines.push('ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region, line = EXCLUDED.line;');
  lines.push('INSERT INTO public.route_pois (id, route_id, kind, name, lat, lng, source, note) VALUES');
  lines.push(SEED_POIS.map(p => `  (${q(p.id)}, ${q(p.route_id)}, ${q(p.kind)}, ${q(p.name)}, ${p.lat}, ${p.lng}, ${q(p.source)}, ${q(p.note)})`).join(',\n'));
  lines.push('ON CONFLICT (id) DO UPDATE SET route_id = EXCLUDED.route_id, kind = EXCLUDED.kind, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, source = EXCLUDED.source, note = EXCLUDED.note;');
  lines.push('INSERT INTO public.route_advisories (id, route_id, kind, title, body, season_from, season_to) VALUES');
  lines.push(SEED_ADVISORIES.map(a => `  (${q(a.id)}, ${q(a.route_id)}, ${q(a.kind)}, ${q(a.title)}, ${q(a.body)}, ${q(a.season_from)}, ${q(a.season_to)})`).join(',\n'));
  lines.push('ON CONFLICT (id) DO UPDATE SET route_id = EXCLUDED.route_id, kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body, season_from = EXCLUDED.season_from, season_to = EXCLUDED.season_to;');
  return lines.join('\n');
}

module.exports = { seedSql };

if (require.main === module) {
  const sql = seedSql();
  if (process.argv.includes('--write')) {
    const file = path.resolve(__dirname, '../supabase/migrations/049_touring_knowledge.sql');
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/-- seed:begin\n[\s\S]*?-- seed:end/, `-- seed:begin\n${sql}\n-- seed:end`);
    fs.writeFileSync(file, next);
  } else {
    process.stdout.write(sql + '\n');
  }
}
