/* C -> JSON -> the browser's real protocol functions. Development test only;
 * compiles a temporary exporter and never starts a notebook/game server. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {compileC} from './native_compiler.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(join(root, 'web/index.html'), 'utf8');
const protocolSource = html.match(/\/\* PROTOCOL_CORE_BEGIN \*\/([\s\S]*?)\/\* PROTOCOL_CORE_END \*\//)?.[1];
assert.ok(protocolSource, 'Load ConexaProtocol directly from the HTML served by the firmware.');
const protocol = vm.runInNewContext(protocolSource + '\nConexaProtocol;');

const temp = mkdtempSync(join(tmpdir(), 'conexa-snapshot-contract-'));
let records;
try {
  const executable = join(temp, process.platform === 'win32' ? 'export-snapshots.exe' : 'export-snapshots');
  const compiled = compileC([join(root, 'tests/export_core_snapshots.c'), join(root, 'src/game_core.c')], join(root, 'include'), executable);
  assert.equal(compiled.status, 0, 'The real C serializer must compile: ' + (compiled.error?.message || compiled.stderr || 'compiler failed'));
  const exported = spawnSync(executable, [], {encoding:'utf8', timeout:10000, shell:false, maxBuffer:1024 * 1024});
  assert.equal(exported.status, 0, 'The core fixture must finish: ' + (exported.error?.message || exported.stderr || 'export failed'));
  assert.ok(exported.stdout.trim(), 'The exporter must produce actual serialized snapshots.');
  records = exported.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
} finally {
  rmSync(temp, {recursive:true, force:true});
}

const viewers = ['visitor', 'student_1', 'student_44', 'teacher'];
const cases = [
  'initial', 'lobby_44', 'open_empty', 'open_voted', 'reconnected',
  'paused', 'paused_retried', 'resumed', 'changed', 'closed',
  'closed_retried', 'reset', 'round_max', 'round_max_voted'
];
const byCase = new Map();
for (const record of records) {
  const key = record.case + '/' + record.viewer;
  assert.ok(!byCase.has(key), 'Fixture labels must be unique: ' + key);
  byCase.set(key, record.snapshot);
}
const state = (name, viewer = 'visitor') => {
  const value = byCase.get(name + '/' + viewer);
  assert.ok(value, 'Missing exported snapshot: ' + name + '/' + viewer);
  return value;
};

test('56 snapshots serialized by the real C core are accepted by the real browser validator', () => {
  assert.equal(records.length, cases.length * viewers.length);
  for (const name of cases) {
    for (const viewer of viewers) {
      const snapshot = state(name, viewer);
      assert.strictEqual(protocol.validateSnapshot(snapshot), snapshot, name + '/' + viewer);
    }
  }
  assert.deepEqual(new Set(records.map(record => record.snapshot.phase)), new Set(['lobby', 'open', 'paused', 'closed']));
});

test('the C JSON contains only the contract fields and limits individual data to the current student', () => {
  const keys = ['protocol', 'boot', 'round', 'revision', 'phase', 'role', 'joined', 'voted', 'participants', 'answer_count', 'totals', 'me'].sort();
  for (const {case:name, viewer, snapshot} of records) {
    assert.deepEqual(Object.keys(snapshot).sort(), keys, name + '/' + viewer);
    if (viewer.startsWith('student_')) {
      assert.equal(snapshot.role, 'student');
      assert.equal(snapshot.me.id, Number(viewer.substring('student_'.length)));
      assert.deepEqual(Object.keys(snapshot.me).sort(), ['choice', 'id', 'joined', 'last_seq']);
    } else {
      assert.equal(snapshot.role, viewer);
      assert.equal(snapshot.me, null, 'Public and teacher snapshots must not include individual choices.');
    }
    if (snapshot.phase !== 'closed') assert.equal(snapshot.totals, null, 'Totals stay hidden before closing.');
  }
  assert.equal(state('closed', 'student_1').me.choice, 2);
  assert.equal(state('closed', 'student_44').me.choice, 1);
});

test('44 real votes, reconnects, repeated writes and changed choices preserve counts across serialization', () => {
  const empty = state('initial');
  assert.equal(empty.participants, 0);
  assert.equal(empty.answer_count, 0);
  assert.equal(empty.joined, '0'.repeat(44));
  const voted = state('open_voted');
  assert.equal(voted.participants, 44);
  assert.equal(voted.answer_count, 44);
  assert.equal(voted.joined, '1'.repeat(44));
  assert.equal(voted.voted, '1'.repeat(44));
  for (const viewer of viewers) {
    assert.deepEqual(state('reconnected', viewer), state('open_voted', viewer));
    assert.deepEqual(state('paused_retried', viewer), state('paused', viewer));
    assert.deepEqual(state('closed_retried', viewer), state('closed', viewer));
  }
  assert.equal(state('changed').answer_count, 44);
  assert.deepEqual(state('closed').totals, [14, 15, 15]);
  assert.equal(state('changed', 'student_1').me.last_seq, 2);
  const originalVote = protocol.buildVote(state('open_empty', 'student_1'), 0);
  assert.equal(protocol.reconcile({kind:'vote', body:originalVote}, state('reconnected', 'student_1')), 'confirmed');
  const lastVote = {boot:voted.boot, round:voted.round, choice:2, seq:2};
  assert.equal(protocol.reconcile({kind:'vote', body:lastVote}, state('closed_retried', 'student_1')), 'confirmed');
});

test('the serialized reset preserves all identities while the browser cancels the previous round action', () => {
  for (const viewer of viewers) {
    const before = state('closed', viewer);
    const after = state('reset', viewer);
    assert.equal(after.boot, before.boot);
    assert.equal(after.round, before.round + 1);
    assert.equal(after.phase, 'lobby');
    assert.equal(after.participants, 44);
    assert.equal(after.joined, '1'.repeat(44));
    assert.equal(after.answer_count, 0);
    assert.equal(after.voted, '0'.repeat(44));
    if (after.me) {
      assert.equal(after.me.joined, true);
      assert.equal(after.me.choice, -1);
      assert.equal(after.me.last_seq, 0);
    }
  }
  const previous = state('closed', 'student_1');
  const pending = {kind:'vote', body:{boot:previous.boot, round:previous.round, choice:2, seq:2}};
  assert.equal(protocol.reconcile(pending, state('reset', 'student_1')), 'session_changed');
  assert.equal(protocol.reconcile({kind:'join', body:{}}, state('reset', 'student_44')), 'confirmed');
});

test('UINT32_MAX round survives C formatting, JSON parsing and browser vote construction', () => {
  for (const name of ['round_max', 'round_max_voted']) {
    for (const viewer of viewers) assert.equal(state(name, viewer).round, 4294967295);
  }
  const next = protocol.buildVote(state('round_max_voted', 'student_44'), 0);
  assert.equal(next.round, 4294967295);
  assert.equal(next.seq, 2);
  assert.equal(next.choice, 0);
  assert.equal(state('round_max_voted').participants, 44);
  assert.equal(state('round_max_voted').answer_count, 1);
});
