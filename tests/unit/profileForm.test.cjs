const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');
const p = loader()('shared/profileForm.ts');

test('rider section: name required, phone and photo link checked', () => {
  assert.deepEqual(p.profileUpdateFor('rider', { display_name: '  ' }), { ok: false, error: 'Enter the name other riders see.' });
  assert.equal(p.profileUpdateFor('rider', { display_name: 'Suman', phone: 'call me' }).ok, false);
  assert.equal(p.profileUpdateFor('rider', { display_name: 'Suman', avatar_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(p.profileUpdateFor('rider', { display_name: 'Suman', avatar_url: 'http://x.test/a.jpg' }).ok, false);
  assert.deepEqual(p.profileUpdateFor('rider', { display_name: ' Suman ', phone: '+91 98765 43210', avatar_url: '' }),
    { ok: true, values: { display_name: 'Suman', phone: '+91 98765 43210', avatar_url: null } });
});

test('emergency section: blood group upper-cased; phone sharing only when the flag is on', () => {
  assert.equal(p.profileUpdateFor('emergency', { blood_group: 'C+' }).ok, false);
  const off = p.profileUpdateFor('emergency', { blood_group: 'o+', share_ice_with_ride: true, share_phone_with_ride: true });
  assert.deepEqual(off.values, { emergency_contact: null, blood_group: 'O+', share_ice_with_ride: true });
  const on = p.profileUpdateFor('emergency', { share_phone_with_ride: true }, { phoneSharing: true });
  assert.equal(on.values.share_phone_with_ride, true);
});

test('bike section: numbers in range, reserve below the tank', () => {
  assert.equal(p.profileUpdateFor('bike', { fuel_tank_capacity_liters: '0' }).ok, false);
  assert.equal(p.profileUpdateFor('bike', { fuel_tank_capacity_liters: 'lots' }).ok, false);
  assert.equal(p.profileUpdateFor('bike', { fuel_tank_capacity_liters: '15', fuel_reserve_liters: '15' }).ok, false);
  assert.equal(p.profileUpdateFor('bike', { motorcycle_category: 'tractor' }).ok, false);
  assert.deepEqual(p.profileUpdateFor('bike', { motorcycle_make: 'Royal Enfield', motorcycle_model: 'Himalayan 450', motorcycle_category: 'adventure', fuel_tank_capacity_liters: '17', mileage_km_per_liter: '30', fuel_reserve_liters: '' }).values,
    { motorcycle_make: 'Royal Enfield', motorcycle_model: 'Himalayan 450', motorcycle_category: 'adventure', fuel_tank_capacity_liters: 17, mileage_km_per_liter: 30, fuel_reserve_liters: null });
});

test('only changed columns are written; range and coordinates', () => {
  assert.deepEqual(p.changedProfileValues({ display_name: 'Suman', phone: null }, { display_name: 'Suman', phone: undefined }), {});
  assert.deepEqual(p.changedProfileValues({ display_name: 'S' }, { display_name: 'Suman' }), { display_name: 'S' });
  assert.deepEqual(p.fuelRangeKm({ fuel_tank_capacity_liters: 17, mileage_km_per_liter: 30, fuel_reserve_liters: 3 }), { total: 510, beforeReserve: 420 });
  assert.equal(p.fuelRangeKm({ fuel_tank_capacity_liters: 17 }), null);
  assert.deepEqual(p.parseCoordinates('32.2', '78.07'), { lat: 32.2, lng: 78.07 });
  assert.equal(p.parseCoordinates('95', '78'), null);
  assert.equal(p.parseCoordinates('', '78'), null);
});
