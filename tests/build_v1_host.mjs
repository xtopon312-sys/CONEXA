/* Build-only host fixture. Uses an installed compiler, never downloads or flashes. */
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {compileC} from './native_compiler.mjs';
const root=resolve('.'),out=join(root,'evidence/game-v1/host');
mkdirSync(out,{recursive:true});
const executable=join(out,'v1-host.exe');
const result=compileC([join(root,'tests/v1_host_bridge.c'),join(root,'src/game_core.c'),join(root,'src/world_core.c')],join(root,'include'),executable);
assert.equal(result.status,0,result.error?.message||result.stdout+'\n'+result.stderr);
console.log('Compiled native game_core.c + world_core.c: '+executable);
