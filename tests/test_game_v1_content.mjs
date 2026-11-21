import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/game_v1.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source + '\nglobalThis.content = ConexaMissions;', context);
const missions = context.content;

test('three authored investigations provide four independent sources and three actions', () => {
  assert.equal(missions.length, 3);
  for (const [index, mission] of missions.entries()) {
    assert.equal(mission.id, index);
    assert.equal(mission.clues.length, 4);
    assert.equal(mission.claims.length, 4);
    assert.equal(mission.decisions.length, 3);
    assert.equal(new Set(mission.clues.map(clue => clue.source)).size, 4);
    assert.equal(mission.clues.filter(clue => clue.locked).length, 1);
    assert.equal(mission.clues[3].locked, true);
    for (const clue of mission.clues) {
      assert.ok(clue.dialogue.length > 100 && clue.evidence.length > 60);
      assert.ok(clue.prompt.endsWith('?') || clue.prompt.endsWith('.'));
    }
    assert.ok(mission.facts.length > 100);
    assert.ok(mission.decisions.every(action => action.action.length > 40 && action.consequence.length > 50));
  }
});

test('evidence association byte follows the server contract in pedagogical order', () => {
  const expected = [201, 114, 141];
  for (const mission of missions) {
    assert.equal(new Set(mission.links).size, 4);
    const encoded = mission.links.reduce((value, sourceIndex, claimIndex) => value | (sourceIndex << (claimIndex * 2)), 0);
    assert.equal(encoded, expected[mission.id]);
    for (let claimIndex = 0; claimIndex < 4; claimIndex++) assert.equal((encoded >> (claimIndex * 2)) & 3, mission.links[claimIndex]);
  }
});

test('all investigations use the four agreed world locations without creating new environments', () => {
  const expected = [[10, 4], [5, 5], [6, 10], [12, 6]];
  for (const mission of missions) {
    assert.equal(JSON.stringify(mission.clues.map(clue => [clue.x, clue.y])), JSON.stringify(expected));
    assert.equal(mission.clues.filter(clue => clue.kind === 'npc').length, 3);
    assert.equal(mission.clues[0].kind, 'object');
  }
});

test('content and outcome facts are immutable, independent of vote tallies', () => {
  assert.ok(Object.isFrozen(missions));
  for (const mission of missions) {
    assert.ok(Object.isFrozen(mission));
    assert.ok(Object.isFrozen(mission.links));
    assert.ok(Object.isFrozen(mission.clues));
    for (const clue of mission.clues) assert.ok(Object.isFrozen(clue));
    for (const decision of mission.decisions) assert.ok(Object.isFrozen(decision));
    assert.throws(() => { mission.facts = 'A maioria decide o que aconteceu.'; }, TypeError);
  }
});

test('mission UI has no network, storage, credential or remote asset dependency', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\/|localStorage|sessionStorage|Bearer\s|student_tokens|admin_token/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /send\(op, arg\)/);
  assert.match(source, /world\.me/);
});

test('lesson explicitly avoids student popularity rankings and preserves evidence over majority', () => {
  assert.match(missions[1].teacher, /Não peça avaliações, rankings ou comparações entre os alunos reais/);
  assert.match(missions[2].teacher, /votação sobre como agir nunca altera esses fatos/);
  assert.match(source, /Nenhuma maioria transforma uma afirmação sem evidência em fato/);
});
