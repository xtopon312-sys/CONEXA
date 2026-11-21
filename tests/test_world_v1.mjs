/* Native C -> JSON -> JS plus exact navigation-map parity; no dependencies. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {compileC} from './native_compiler.mjs';

const root=resolve('.'),temporary=mkdtempSync(join(tmpdir(),'conexa-world-v1-'));
const executable=join(temporary,'world-core-tests.exe');
const compiled=compileC([join(root,'tests/world_core_test.c'),join(root,'src/world_core.c'),join(root,'src/game_core.c')],join(root,'include'),executable);
try {
  assert.equal(compiled.status,0,compiled.error?.message||compiled.stdout+'\n'+compiled.stderr);
  const run=(arg=[])=>{const r=spawnSync(executable,arg,{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.error?.message||r.stdout+'\n'+r.stderr);return r.stdout.trim();};
  test('native world rules, 44-player full missions, authorization, idempotence, rates, resets and overflow',()=>{const result=run();console.log(result);assert.match(result,/8 groups, \d+ checks PASS/);});
  test('authoritative C collision map exactly matches production Canvas navigation',()=>{
    const html=readFileSync(join(root,'web/index.html'),'utf8');
    const source=html.split('/* WORLD_CORE_BEGIN */')[1].split('/* WORLD_CORE_END */')[0];
    const context=vm.createContext({});vm.runInContext(source+';this.map=ConexaWorld;',context);
    let map='';for(let y=0;y<14;y++)for(let x=0;x<14;x++)map+=context.map.walkable(x,y)?'1':'0';
    assert.equal(run(['--map']),map);
  });
  test('actual C snapshots parse in JS, preserve IDs, protect individual data and fit fixed budget',()=>{
    const rows=run(['--snapshots']).split(/\r?\n/).map(text=>({text,state:JSON.parse(text)}));
    assert.equal(rows.length,3);
    for(const {text,state} of rows){assert.ok(Buffer.byteLength(text)<3072);assert.equal(state.positions.length,88);assert.deepEqual(state.completed,[44,44,44]);assert.deepEqual(state.decisions,[[14,15,15],[14,15,15],[14,15,15]]);assert.equal(state.phase,'closed');}
    const [visitor,student,teacher]=rows.map(r=>r.state);
    assert.equal(visitor.me,null);assert.equal(visitor.teacher,null);assert.ok(!rows[0].text.includes('last_op'));
    assert.equal(student.me.id,7);assert.equal(student.me.done,7);assert.deepEqual(student.me.clues,[15,15,15]);assert.equal(student.me.last_op,'resolve');assert.equal(student.me.last_arg,8589);assert.equal(student.teacher,null);
    assert.equal(teacher.me,null);assert.equal(teacher.teacher.progress,'fff7'.repeat(44));assert.equal(teacher.teacher.last_op,'finish');
    console.log('Snapshot bytes visitor/student/teacher: '+rows.map(r=>Buffer.byteLength(r.text)).join('/'));
  });
} finally {
  process.on('exit',()=>{
    assert.equal(dirname(resolve(temporary)),resolve(tmpdir()));
    assert.match(basename(temporary),/^conexa-world-v1-/);
    rmSync(temporary,{recursive:true,force:true});
  });
}
