const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

test('clip path matches the database rule', () => {
  const ride = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const clip = '33333333-3333-4333-8333-333333333333';
  const path = shared.voiceClipPath(ride, user, clip);
  assert.equal(path, `${ride}/${user}/${clip}.m4a`);
  const sql = fs.readFileSync('supabase/migrations/20261201001300_voice_notes.sql', 'utf8');
  assert.match(sql, /'\/\[0-9a-f-\]\{36\}\\\.m4a\$'/);
  assert.match(sql, /voice_duration_ms BETWEEN 300 AND 15500/);
  assert.ok(shared.VOICE_MAX_MS <= 15500);
});

test('durations and mis-taps', () => {
  assert.equal(shared.formatClipDuration(8200), '0:08');
  assert.equal(shared.formatClipDuration(15000), '0:15');
  assert.equal(shared.voiceClipUsable(200), false);
  assert.equal(shared.voiceClipUsable(900), true);
});

test('voice note attention: play, playing, then gone', () => {
  const msg = { id: 'm1', sender_name: 'Ravi', voice_duration_ms: 7000, created_at: '2026-07-01T10:00:00Z' };
  const ready = shared.voiceNoteAttention(msg, 'ready', '2026-07-01T10:00:05Z');
  assert.equal(ready.kind, 'voice_note');
  assert.equal(ready.title, 'Ravi: voice note');
  assert.equal(ready.actions[0].id, 'play_voice');
  assert.equal(shared.voiceNoteAttention(msg, 'playing', '2026-07-01T10:00:05Z').actions[0].id, 'stop_voice');
  assert.equal(shared.voiceNoteAttention(msg, 'played', '2026-07-01T10:00:05Z'), null);
  assert.equal(shared.voiceNoteAttention(msg, 'ready', '2026-07-01T10:06:00Z'), null);
});

test('chat lines carry the clip: local while queued, storage path once sent', () => {
  const lines = shared.buildChatLines({
    server: [{ id: 's', ride_id: 'r', sender_id: 'u2', message_type: 'voice', body: 'Voice note', is_pinned: false, created_at: '2026-07-01T10:00:00Z', voice_path: 'r/u2/x.m4a', voice_duration_ms: 4000 }],
    queued: [{ id: 'q', ride_id: 'r', user_id: 'me', body: 'Voice note', message_type: 'voice', created_at: '2026-07-01T10:01:00Z', voice: { local_uri: 'file:///v/q.m4a', duration_ms: 6000 } }],
    myUserId: 'me', online: false,
  });
  assert.deepEqual(lines.map(l => [l.voice.path, l.voice.localUri, l.voice.durationMs, l.delivery]), [
    ['r/u2/x.m4a', null, 4000, null],
    [null, 'file:///v/q.m4a', 6000, 'waiting_for_signal'],
  ]);
});
