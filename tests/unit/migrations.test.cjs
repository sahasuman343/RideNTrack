const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Migrations are named NNN_<name>.sql (three digits, in order, no gaps), never
// with a timestamp, so they sort and read the same everywhere.
test('migration files use sequential NNN_<name>.sql names', () => {
  const files = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  files.forEach((file, i) => {
    assert.match(file, /^\d{3}_[a-z0-9_]+\.sql$/, `${file} should be named NNN_<name>.sql`);
    assert.equal(Number(file.slice(0, 3)), i + 1, `${file} is out of sequence; expected ${String(i + 1).padStart(3, '0')}_…`);
  });
});
