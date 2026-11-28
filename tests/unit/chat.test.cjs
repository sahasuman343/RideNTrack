const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./loader.cjs');

const shared = loader()('shared/types.ts');

const server = (id, sender, body, created, extra = {}) => ({
  id, ride_id: 'r', sender_id: sender, sender_name: sender === 'me' ? 'Me' : 'Ravi', message_type: 'text',
  body, is_pinned: false, created_at: created, ...extra,
});
const queued = (id, body, created) => ({ id, ride_id: 'r', user_id: 'me', body, message_type: 'text', created_at: created });

test('queued messages show where they are, in the shared words', () => {
  const lines = shared.buildChatLines({
    server: [server('s1', 'u2', 'Fuel at the next pump', '2026-11-25T10:00:00Z')],
    queued: [queued('q1', 'Copy', '2026-11-25T10:01:00Z'), queued('q2', 'Stopping', '2026-11-25T10:02:00Z')],
    failedIds: ['q2'],
    myUserId: 'me',
    online: false,
  });
  assert.deepEqual(lines.map(l => [l.body, l.delivery]), [
    ['Fuel at the next pump', null],
    ['Copy', 'waiting_for_signal'],
    ['Stopping', 'failed'],
  ]);
  assert.equal(shared.chatDeliveryText(lines[1]), 'Waiting for signal');
  assert.match(shared.chatQueueSummary(lines, false), /could not be sent/);
});

test('a queued message the server already has shows once, as sent', () => {
  const lines = shared.buildChatLines({
    server: [server('s9', 'me', 'Copy', '2026-11-25T10:05:00Z', { client_id: 'q1', client_created_at: '2026-11-25T10:01:00Z' })],
    queued: [queued('q1', 'Copy', '2026-11-25T10:01:00Z')],
    myUserId: 'me',
    online: true,
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].delivery, 'sent');
  // Ordered and timed by when it was written, and labelled late.
  assert.equal(lines[0].writtenAt, '2026-11-25T10:01:00Z');
  assert.match(lines[0].lateNote, /^Written \d\d:\d\d, arrived \d\d:\d\d$/);
});

test('acknowledged before the echo arrives reads as Sent, not Sending', () => {
  const lines = shared.buildChatLines({ server: [], queued: [queued('q1', 'Copy', '2026-11-25T10:01:00Z')], sentIds: ['q1'], myUserId: 'me', online: true });
  assert.equal(lines[0].delivery, 'sent');
});

test('late arrivals sort by writing time, not arrival', () => {
  const lines = shared.buildChatLines({
    server: [
      server('a', 'u2', 'Second', '2026-11-25T10:03:00Z'),
      server('b', 'u3', 'First (from the dead zone)', '2026-11-25T10:20:00Z', { client_created_at: '2026-11-25T10:01:00Z' }),
    ],
    queued: [], myUserId: 'me', online: true,
  });
  assert.deepEqual(lines.map(l => l.body), ['First (from the dead zone)', 'Second']);
  assert.ok(lines[0].lateNote);
  assert.equal(lines[1].lateNote, null);
});

test('summary sentences', () => {
  assert.equal(shared.chatQueueSummary([], true), null);
  assert.match(shared.chatQueueSummary([], false), /No signal/);
  const waiting = [{ delivery: 'waiting_for_signal' }, { delivery: 'waiting_for_signal' }];
  assert.equal(shared.chatQueueSummary(waiting, false), '2 messages waiting for signal. They go on their own.');
  assert.equal(shared.normaliseChatBody('  hi \n there  '), 'hi there');
  assert.equal(shared.normaliseChatBody('   '), null);
  assert.equal(shared.normaliseChatBody('x'.repeat(1200)).length, 1000);
});
