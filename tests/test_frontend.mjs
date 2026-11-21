import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const pagePath = fileURLToPath(new URL('../web/index.html', import.meta.url));
const html = readFileSync(pagePath, 'utf8');
const script = html.match(/<script id="conexa-app">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'The self-contained application script must exist.');
new vm.Script(script, {filename:pagePath});
const protocolSource = script.match(/\/\* PROTOCOL_CORE_BEGIN \*\/([\s\S]*?)\/\* PROTOCOL_CORE_END \*\//)?.[1];
assert.ok(protocolSource, 'Test the same protocol functions that the browser uses.');
const protocol = vm.runInNewContext(protocolSource + '\nConexaProtocol;');

function snapshot({phase = 'open', choice = -1, seq = 0, round = 1, boot = '1234567890abcdef', joined = true, role = 'student'} = {}) {
  const voted = choice !== -1;
  const totals = [0, 0, 0];
  if (voted) totals[choice] = 1;
  return {
    protocol:1, boot, round, revision:1, phase, role,
    joined:(joined ? '1' : '0') + '0'.repeat(43),
    voted:(voted ? '1' : '0') + '0'.repeat(43),
    participants:joined ? 1 : 0, answer_count:voted ? 1 : 0,
    totals:phase === 'closed' ? totals : null,
    me:role === 'student' ? {id:1, joined, choice, last_seq:seq} : null
  };
}
const vote = {kind:'vote', body:{boot:'1234567890abcdef', round:1, choice:1, seq:1}};
const control = action => ({kind:'control', body:{boot:'1234567890abcdef', round:1, action}});

test('full inline JavaScript parses and contains no external runtime resource', () => {
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /@import|url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(script, /crypto\.randomUUID|WebSocket|localStorage|sessionStorage/);
  assert.match(script, /headers\.Authorization\s*=\s*'Bearer '/);
  assert.match(script, /model\.busy\) return/);
});

test('the next sequence is derived from the board, including changing an existing answer', () => {
  assert.equal(protocol.buildVote(snapshot(), 1).seq, 1);
  const body = protocol.buildVote(snapshot({choice:0, seq:9}), 2);
  assert.equal(body.seq, 10);
  assert.equal(body.choice, 2);
  assert.equal(body.boot, '1234567890abcdef');
});

test('round accepts the uint32 boundary while vote sequences retain their signed limit', () => {
  assert.equal(protocol.validateSnapshot(snapshot({round:2147483648})).round, 2147483648);
  const finalRound = snapshot({round:4294967295});
  assert.equal(protocol.validateSnapshot(finalRound).round, 4294967295);
  assert.equal(protocol.buildVote(finalRound, 1).round, 4294967295);
  assert.throws(() => protocol.validateSnapshot(snapshot({round:4294967296})));
  assert.throws(() => protocol.validateSnapshot(snapshot({round:0})));
  assert.throws(() => protocol.validateSnapshot(snapshot({choice:1, seq:2147483648})));
});

test('an unconfirmed vote is retried only if it is still the next sequence in an open round', () => {
  assert.equal(protocol.reconcile(vote, snapshot()), 'retry');
  assert.equal(protocol.reconcile(vote, snapshot({phase:'paused'})), 'cancelled');
  assert.equal(protocol.reconcile(vote, snapshot({phase:'closed'})), 'cancelled');
  assert.equal(protocol.reconcile(vote, snapshot({choice:2, seq:1})), 'cancelled');
  assert.equal(protocol.reconcile(vote, snapshot({choice:1, seq:2})), 'cancelled');
  assert.equal(vote.body.seq, 1, 'Reconciling must never mutate the retained payload.');
});

test('a response-lost vote is confirmed from the board even after pausing or closing', () => {
  for (const phase of ['open', 'paused', 'closed']) {
    assert.equal(protocol.reconcile(vote, snapshot({choice:1, seq:1, phase})), 'confirmed');
  }
});

test('boot or round changes cancel stale writes and cannot repeat a reset', () => {
  assert.equal(protocol.reconcile(vote, snapshot({round:2})), 'session_changed');
  assert.equal(protocol.reconcile(vote, snapshot({boot:'fedcba0987654321'})), 'session_changed');
  assert.equal(protocol.reconcile(control('reset'), snapshot({phase:'lobby', round:2})), 'session_changed');
  assert.equal(protocol.reconcile(control('reset'), snapshot({phase:'lobby'})), 'retry');
});

test('teacher controls reconcile against the actual phase instead of fabricating success', () => {
  assert.equal(protocol.reconcile(control('open'), snapshot({phase:'lobby'})), 'retry');
  assert.equal(protocol.reconcile(control('open'), snapshot({phase:'open'})), 'confirmed');
  assert.equal(protocol.reconcile(control('pause'), snapshot({phase:'closed'})), 'cancelled');
  assert.equal(protocol.reconcile(control('resume'), snapshot({phase:'open'})), 'confirmed');
  assert.equal(protocol.reconcile(control('close'), snapshot({phase:'paused'})), 'retry');
  assert.equal(protocol.reconcile(control('close'), snapshot({phase:'closed'})), 'confirmed');
});

test('join recovers a fixed position and never needs a new participant identity', () => {
  const joining = {kind:'join', body:{}};
  assert.equal(protocol.reconcile(joining, snapshot({joined:false})), 'retry');
  assert.equal(protocol.reconcile(joining, snapshot({joined:true})), 'confirmed');
});

test('snapshots cannot leak individual data publicly or totals before closing', () => {
  assert.throws(() => protocol.validateSnapshot({...snapshot(), totals:[0,0,0]}));
  assert.throws(() => protocol.validateSnapshot({...snapshot(), role:'visitor'}));
  assert.throws(() => protocol.validateSnapshot({...snapshot({phase:'closed'}), totals:[0,1,0]}));
  assert.throws(() => protocol.validateSnapshot({...snapshot(), answer_count:1}));
  assert.throws(() => protocol.validateSnapshot({...snapshot(), joined:'0'.repeat(43)}));
  assert.equal(protocol.validateSnapshot(snapshot({role:'visitor'})).role, 'visitor');
});

test('new votes are blocked outside an open phase, before join, and on sequence exhaustion', () => {
  for (const phase of ['lobby', 'paused', 'closed']) assert.throws(() => protocol.buildVote(snapshot({phase}), 1));
  assert.throws(() => protocol.buildVote(snapshot({joined:false}), 1));
  assert.throws(() => protocol.buildVote(snapshot({role:'visitor'}), 1));
  assert.throws(() => protocol.buildVote(snapshot({choice:1, seq:2147483647}), 1));
  assert.throws(() => protocol.buildVote(snapshot(), 3));
});
