const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./loader.cjs');

const bikes = loader()('shared/bikeModels.ts');

test('catalogue has ~50 unique, sane bikes', () => {
  assert.ok(bikes.BIKE_MODELS.length >= 50);
  assert.equal(new Set(bikes.BIKE_MODELS.map(b => b.id)).size, bikes.BIKE_MODELS.length);
  assert.equal(new Set(bikes.BIKE_MODELS.map(b => `${b.make}|${b.model}`)).size, bikes.BIKE_MODELS.length);
  for (const b of bikes.BIKE_MODELS) {
    assert.ok(b.tankLiters > b.reserveLiters && b.reserveLiters >= 0, b.id);
    assert.ok(b.mileageKmpl > 10 && b.mileageKmpl < 100, b.id);
    assert.ok(bikes.bikeRangeKm(b) > 100, `${b.id} range`);
  }
});

test('search finds by partial make and model words', () => {
  assert.equal(bikes.searchBikeModels('hima 450')[0].id, 're-himalayan-450');
  assert.equal(bikes.searchBikeModels('390 adv')[0].id, 'ktm-390-adventure');
  assert.ok(bikes.searchBikeModels('royal').every(b => b.make === 'Royal Enfield'));
  assert.deepEqual(bikes.searchBikeModels('  '), []);
  assert.equal(bikes.findBikeModel('KTM', '390 adventure').id, 'ktm-390-adventure');
  assert.equal(bikes.findBikeModel(null, 'Nonexistent'), null);
});

test('migration seed matches the shared catalogue', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/043_motorcycle_models.sql'), 'utf8');
  for (const b of bikes.BIKE_MODELS) assert.ok(sql.includes(`('${b.id}', `), `missing ${b.id}`);
  assert.equal((sql.match(/^  \('/gm) || []).length, bikes.BIKE_MODELS.length);
});
