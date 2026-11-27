const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('slugs match the database rule', () => {
  assert.equal(shared.slugifyClubName('Deccan Dawn Riders!'), 'deccan-dawn-riders');
  assert.equal(shared.slugifyClubName('  Café   Racers -- Pune '), 'cafe-racers-pune');
  assert.ok(shared.isValidClubSlug('deccan-dawn'));
  assert.ok(!shared.isValidClubSlug('ab'));
  assert.ok(!shared.isValidClubSlug('bad--slug'));
  const sql = fs.readFileSync('supabase/migrations/056_clubs.sql', 'utf8');
  assert.ok(sql.includes(shared.CLUB_SLUG_PATTERN.source.replace(/^\^|\$$/g, '')), 'slug pattern matches the migration');
});

test('recurrence rules parse, describe and round-trip', () => {
  assert.equal(shared.describeRecurrence('FREQ=WEEKLY;BYDAY=SU'), 'Every Sunday');
  assert.equal(shared.describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA'), 'Every other Saturday');
  assert.equal(shared.describeRecurrence('FREQ=MONTHLY;BYDAY=1SU'), 'First Sunday of the month');
  assert.equal(shared.describeRecurrence('FREQ=MONTHLY;BYDAY=-1SA'), 'Last Saturday of the month');
  assert.equal(shared.parseRecurrenceRule('FREQ=WEEKLY;BYDAY=2SU'), null);
  assert.equal(shared.parseRecurrenceRule('FREQ=DAILY'), null);
  for (const rule of ['FREQ=WEEKLY;BYDAY=SU', 'FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR']) {
    assert.equal(shared.buildRecurrenceRule(shared.parseRecurrenceRule(rule)), rule);
  }
});

test('next occurrences', () => {
  // 2027-06-01 is a Tuesday.
  assert.deepEqual(shared.nextOccurrences('FREQ=WEEKLY;BYDAY=SU', '2027-06-01', 3), ['2027-06-06', '2027-06-13', '2027-06-20']);
  assert.deepEqual(shared.nextOccurrences('FREQ=WEEKLY;BYDAY=TU', '2027-06-01', 1), ['2027-06-01']);
  assert.deepEqual(shared.nextOccurrences('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', '2027-06-01', 2, '2027-05-30'), ['2027-06-13', '2027-06-27']);
  assert.deepEqual(shared.nextOccurrences('FREQ=MONTHLY;BYDAY=1SU', '2027-06-01', 3), ['2027-06-06', '2027-07-04', '2027-08-01']);
  assert.deepEqual(shared.nextOccurrences('FREQ=MONTHLY;BYDAY=-1SA', '2027-06-01', 2), ['2027-06-26', '2027-07-31']);
  assert.equal(shared.nextUnplannedDate({ recurrence_rule: 'FREQ=WEEKLY;BYDAY=SU', planned_dates: ['2027-06-06'] }, '2027-06-01'), '2027-06-13');
});

test('roster text', () => {
  assert.equal(shared.memberHistoryText({ rides: 12, km: 1480, joined_at: '2027-01-02T00:00:00Z' }), '12 club rides · 1,480 km');
  assert.match(shared.memberHistoryText({ rides: 0, km: 0, joined_at: '2027-03-02T00:00:00Z' }), /^Joined March 2027/);
  assert.ok(shared.canManageClub('admin'));
  assert.ok(!shared.canManageClub('member'));
});
