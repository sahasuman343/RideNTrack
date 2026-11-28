const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('every English key has a Hindi string with the same placeholders', () => {
  const en = shared.EN_MESSAGES;
  const hi = shared.HI_MESSAGES;
  const missing = Object.keys(en).filter(k => !(k in hi) || !String(hi[k]).trim());
  assert.deepEqual(missing, [], `missing in hi.ts: ${missing.join(', ')}`);
  const extra = Object.keys(hi).filter(k => !(k in en));
  assert.deepEqual(extra, [], `keys in hi.ts that en.ts does not have: ${extra.join(', ')}`);
  for (const k of Object.keys(en)) assert.deepEqual(placeholders(hi[k]), placeholders(en[k]), `placeholders differ for ${k}`);
});

test('translator falls back to English and fills placeholders', () => {
  const t = shared.translator('hi');
  assert.match(t('sos.text_people', { count: 3 }), /3/);
  assert.equal(shared.translator(null)('sos.send'), 'Send SOS');
  assert.equal(shared.translator('xx')('sos.send'), 'Send SOS');
  assert.equal(shared.interpolate('Hi {name}, {missing}', { name: 'Asha' }), 'Hi Asha, {missing}');
});

test('phone language picks the first supported locale', () => {
  assert.equal(shared.pickLocale(['fr-FR', 'hi-IN', 'en-IN']), 'hi');
  assert.equal(shared.pickLocale(['fr-FR']), 'en');
  assert.equal(shared.pickLocale([]), 'en');
  assert.ok(shared.lineHeightFor('hi', 16) > shared.lineHeightFor('en', 16));
});

test('SOS steps and crash countdown speak Hindi when given a Hindi translator', () => {
  const t = shared.translator('hi');
  const steps = shared.sosSteps({ pack: 'queued', composer: 'opened', server: 'off', recipients: [{ name: 'Maa', phone: '+919800000000', role: 'emergency_contact' }] }, t);
  assert.equal(steps[0].status, t('status.waiting_for_signal'));
  assert.match(steps[1].label, /Maa/);
  assert.doesNotMatch(steps[1].label, /Text from/);
  assert.equal(shared.sosPrimaryLabel({ online: false, recipients: 2 }, t), t('sos.offline_text', { count: 2 }));
  const item = shared.crashCountdownAttention(30, new Date().toISOString(), t);
  assert.equal(item.title, t('crash.title'));
  assert.notEqual(item.title, 'Are you OK?');
  // English stays the default for every builder.
  assert.equal(shared.sosPrimaryLabel({ online: true, recipients: 0 }), 'Send SOS');
  assert.equal(shared.crashCountdownAttention(30, new Date().toISOString()).title, 'Are you OK?');
});

test('chat queue summary and delivery text follow the language', () => {
  const t = shared.translator('hi');
  assert.equal(shared.chatQueueSummary([], false, t), t('chat.summary_no_signal'));
  assert.equal(shared.chatDeliveryText({ delivery: 'failed' }, t), t('status.failed'));
  assert.equal(shared.chatDeliveryText({ delivery: 'failed' }), 'Failed');
});

test('road report type keys cover every report type', () => {
  for (const r of shared.ROAD_REPORT_TYPES) assert.ok(`road.type.${r.type}` in shared.EN_MESSAGES, r.type);
});

test('F18: regional languages cover every safety string with the same placeholders', () => {
  const en = shared.EN_MESSAGES;
  const safety = Object.keys(en).filter(k => shared.SAFETY_KEY_PREFIXES.some(p => k.startsWith(p)));
  assert.ok(safety.length >= 30);
  for (const [code, catalog] of Object.entries(shared.REGIONAL_MESSAGES)) {
    const missing = safety.filter(k => !catalog[k] || !String(catalog[k]).trim());
    assert.deepEqual(missing, [], `${code} is missing safety strings: ${missing.join(', ')}`);
    for (const k of Object.keys(catalog)) {
      assert.ok(k in en, `${code} has unknown key ${k}`);
      assert.deepEqual(placeholders(catalog[k]), placeholders(en[k]), `${code} placeholders differ for ${k}`);
    }
    assert.ok(shared.LOCALES.some(l => l.code === code), `${code} not offered in the picker`);
  }
});

test('F18: regional translator falls back to English for untranslated keys', () => {
  const t = shared.translator('ta');
  assert.notEqual(t('sos.send'), 'Send SOS');
  assert.equal(t('road.title'), shared.EN_MESSAGES['road.title']);
  assert.equal(shared.pickLocale(['kn-IN', 'en-IN']), 'kn');
  assert.equal(shared.speechLanguage('ml'), 'ml-IN');
  assert.equal(shared.lineHeightFor('te', 20), 30);
});
