import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileC} from './native_compiler.mjs';
test('unchanged P0 native suite remains valid in the V1 checkout',()=>{
 const dir=resolve('evidence/game-v1/legacy-core');mkdirSync(dir,{recursive:true});const exe=resolve(dir,'legacy-core.exe');
 const built=compileC([resolve('tests/test_game_core.c'),resolve('src/game_core.c')],resolve('include'),exe);
 assert.equal(built.status,0,built.stdout+built.stderr);
 const ran=spawnSync(exe,[],{encoding:'utf8',timeout:30000});console.log(ran.stdout);assert.equal(ran.status,0,ran.stderr);
});
