/* V1 protocol and offline assets: real C JSON, invalid states and lost replies. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {compileC} from './native_compiler.mjs';

const root=resolve('.'),source=readFileSync(join(root,'web/session_v1.js'),'utf8');
const mapSource=readFileSync(join(root,'web/index.html'),'utf8').split('/* WORLD_CORE_BEGIN */')[1].split('/* WORLD_CORE_END */')[0];
const temporary=mkdtempSync(join(tmpdir(),'conexa-protocol-v1-'));
process.on('exit',()=>{assert.equal(dirname(resolve(temporary)),resolve(tmpdir()));rmSync(temporary,{recursive:true,force:true});});
const compilerSources=[join(root,'src/world_core.c'),join(root,'src/game_core.c')];
function compileAndRun(input,name,args=[]){
 const exe=join(temporary,name+'.exe'),build=compileC([input,...compilerSources],join(root,'include'),exe);
 assert.equal(build.status,0,build.error?.message||build.stdout+'\n'+build.stderr);
 const result=spawnSync(exe,args,{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.error?.message||result.stdout+'\n'+result.stderr);
 return result.stdout.trim().split(/\r?\n/).map(JSON.parse);
}
const full=compileAndRun(join(root,'tests/world_core_test.c'),'completed',['--snapshots']);
const initialSource=join(temporary,'initial.c');
writeFileSync(initialSource,`#include "world_core.h"
#include <stdio.h>
static void emit(world_state_t *w){char json[WORLD_SNAPSHOT_CAPACITY];for(int r=0;r<3;r++){if(!world_snapshot_json(w,(game_role_t)r,7u,json,sizeof(json)))return;puts(json);}}
int main(void){world_state_t w;const char*b="0123456789abcdef";
if(world_init(&w,b)!=WORLD_OK||world_join(&w,7u)!=WORLD_OK)return 1;emit(&w);
if(world_apply(&w,GAME_ROLE_TEACHER,0u,b,1u,1u,WORLD_OP_START,0u,0u)!=WORLD_OK)return 2;
if(world_apply(&w,GAME_ROLE_STUDENT,7u,b,1u,1u,WORLD_OP_MOVE,134u,0u)!=WORLD_OK)return 3;emit(&w);
if(world_apply(&w,GAME_ROLE_TEACHER,0u,b,1u,2u,WORLD_OP_RESET,0u,0u)!=WORLD_OK)return 4;emit(&w);return 0;}
`);
const states=compileAndRun(initialSource,'initial');
function context(extra={}){
 const c=vm.createContext({TextDecoder,TextEncoder,Uint8Array,DataView,Blob,AbortController,setTimeout,clearTimeout,...extra});
 vm.runInContext(mapSource+'\n'+source+'\n;this.protocol=ConexaWorldProtocol;this.avatars=ConexaAvatarProtocol;',c);
 return c;
}
const c=context(),P=c.protocol,clone=x=>JSON.parse(JSON.stringify(x));
const pending=(state,op,arg=0)=>({role:state.role,studentId:state.me?.id,body:{boot:state.boot,epoch:state.epoch,seq:(state.me||state.teacher).seq+1,op,arg}});

test('actual C snapshots validate for all roles, full missions, movement and reset',()=>{
 for(const state of [...full,...states])assert.equal(P.validate(state),state);
 assert.equal(full[1].me.done,7);assert.equal(states[4].me.x,8);assert.equal(states[7].epoch,2);
});

test('invalid counters, positions, releases, extra fields and role privacy fail closed',()=>{
 const mutations=[s=>s.epoch=0,s=>s.rev=4294967296,s=>s.boot='x'.repeat(16),s=>s.positions='--'.repeat(43),s=>s.positions='77'+s.positions.slice(2),s=>s.positions='ff'+s.positions.slice(2),s=>s.completed[0]=45,s=>s.released=4,s=>s.mission=3,s=>s.private='unexpected',s=>s.me={id:7},s=>s.teacher={progress:'private'},s=>s.decisions=[[0,0,0],[0,0,0],[0,0,0]]];
 for(const mutate of mutations){const state=clone(states[3]);mutate(state);assert.throws(()=>P.validate(state));}
});

test('student identity, collision map, receipts, masks and own decisions are consistent',()=>{
 const mutations=[s=>s.me.id=45,s=>s.me.id=8,s=>s.me.joined=false,s=>s.me.x=7,s=>s.me.seq=2147483648,s=>s.me.last_op='pause',s=>s.me.last_arg=196,s=>s.me.done=1,s=>s.me.decisions[0]=1,s=>s.me.clues[2]=1,s=>s.me.clues[0]=8,s=>s.teacher={}];
 for(const mutate of mutations){const state=clone(states[4]);mutate(state);assert.throws(()=>P.validate(state));}
 const state=clone(states[1]);state.me.seq=0;state.me.last_arg=1;assert.throws(()=>P.validate(state));
});

test('teacher progress matches joined IDs and aggregate completion without individual choices',()=>{
 for(const mutate of [s=>s.teacher.progress='fff7'.repeat(44),s=>s.teacher.progress='----'.repeat(44),s=>s.teacher.last_arg=1,s=>s.teacher.answer=2,s=>s.decisions[0][0]=1]){
  const state=clone(states[5]);mutate(state);assert.throws(()=>P.validate(state));
 }
 const state=clone(full[2]);state.teacher.progress='0001'+state.teacher.progress.slice(4);assert.throws(()=>P.validate(state));
});

test('lost replies confirm only an exact sequence/op/argument receipt',()=>{
 const state=states[4],body={boot:state.boot,epoch:1,seq:1,op:'move',arg:134};
 assert.equal(P.reconcile({role:'student',studentId:7,body},state),'confirmed');
 assert.equal(P.reconcile({body:{...body,arg:135}},state),'cancelled');
 assert.equal(P.reconcile({body:{...body,op:'inspect',arg:0}},state),'cancelled');
 assert.equal(P.reconcile({studentId:8,body},state),'cancelled');
 assert.equal(P.reconcile({role:'teacher',body},state),'cancelled');
 const newer=clone(state);newer.me.seq=2;newer.me.last_arg=135;newer.me.x=9;newer.positions=newer.positions.slice(0,12)+'99'+newer.positions.slice(14);
 assert.equal(P.reconcile({body},newer),'cancelled');
 const request=pending(state,'move',135);
 assert.equal(P.reconcile(request,state),'retry');
 const paused=clone(state);paused.phase='paused';assert.equal(P.reconcile(request,paused),'cancelled');
 assert.equal(P.reconcile(request,states[7]),'session_changed');
 const reboot=clone(state);reboot.boot='1123456789abcdef';assert.equal(P.reconcile(request,reboot),'session_changed');
 assert.equal(P.reconcile(null,state),'none');
});

test('teacher retries honor transitions and reset never claims another reset as its own',()=>{
 const state=states[5];
 assert.equal(P.reconcile(pending(state,'pause'),state),'retry');
 assert.equal(P.reconcile(pending(state,'resume'),state),'cancelled');
 assert.equal(P.reconcile(pending(state,'next'),state),'cancelled');
 assert.equal(P.reconcile(pending(state,'reset'),states[8]),'session_changed');
 assert.equal(P.reconcile({body:{boot:state.boot,epoch:1,seq:1,op:'start',arg:0}},state),'confirmed');
 assert.equal(P.reconcile(pending(states[2],'start'),states[2]),'retry');
});

const fixture=join(root,'evidence/game-v1/avatar-test');
const manifest=JSON.parse(readFileSync(join(fixture,'avatars.json'),'utf8'));
const imageBytes=new Uint8Array(readFileSync(join(fixture,'avatars.webp')));
const empty={version:1,anchor:'feet-center',logical:{width:62,height:118,pivot:[31,106],footprint:[34,14]},scale:1,atlas:null,entries:[]};
test('generated avatar contract, dimensions and public bounds validate before decoding',()=>{
 assert.equal(c.avatars.validate(manifest),manifest);assert.equal(c.avatars.validate(empty),empty);
 assert.equal(JSON.stringify(c.avatars.dimensions(imageBytes)),JSON.stringify([62,118]));
 const mutations=[m=>m.atlas.url='https://external.invalid/a.webp',m=>m.atlas.width=100000,m=>m.logical.pivot[1]=0,m=>m.entries[0].id=45,m=>m.entries[0].rect[0]=1,m=>m.entries.push(clone(m.entries[0])),m=>m.entries[0].name='private',m=>m.atlas.sha256='invalid'];
 for(const mutate of mutations){const value=clone(manifest);mutate(value);assert.throws(()=>c.avatars.validate(value));}
 const bad=imageBytes.slice();bad[4]=0;assert.throws(()=>c.avatars.dimensions(bad));
});

function avatarContext(data=manifest,bytes=imageBytes){
 const calls=[];let decodes=0;
 const env=context({crypto:webcrypto,fetch:async(url,options)=>{
  calls.push({url,options});const payload=url==='/api/avatars'?new TextEncoder().encode(JSON.stringify(data)):bytes;
  return {ok:true,headers:{get:()=>String(payload.length)},body:null,arrayBuffer:async()=>payload.buffer.slice(payload.byteOffset,payload.byteOffset+payload.byteLength)};
 },createImageBitmap:async()=>{decodes++;return {width:62,height:118,close(){}};}});
 return {env,calls,get decodes(){return decodes;}};
}
test('loader binds ID7 with no credentials; absent cartoons retain procedural fallback',async()=>{
 const fixtureContext=avatarContext();let callbackValue;
 const asset=await fixtureContext.env.loadConexaAvatars(value=>callbackValue=value);
 assert.equal(asset,callbackValue);assert.equal(asset.entries.has(7),true);assert.equal(asset.entries.has(1),false);assert.equal(fixtureContext.decodes,1);
 assert.deepEqual(fixtureContext.calls.map(call=>call.url),['/api/avatars','/avatars.webp']);
 for(const call of fixtureContext.calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');}
 const absent=avatarContext(empty);assert.equal(await absent.env.loadConexaAvatars(),null);assert.equal(absent.decodes,0);assert.equal(absent.calls.length,1);
});

test('loader falls back without image decode on bad hash, oversized body or dimension mismatch',async()=>{
 const badHash=clone(manifest);badHash.atlas.sha256='0'.repeat(64);
 const badSize=clone(manifest);badSize.atlas.width=124;
 for(const scenario of [avatarContext(badHash),avatarContext(badSize),avatarContext(manifest,new Uint8Array(131073)),avatarContext({padding:'x'.repeat(8193)})]){
  assert.equal(await scenario.env.loadConexaAvatars(),null);assert.equal(scenario.decodes,0);
 }
 const failed=context({fetch:async()=>{throw new Error('offline');}});
 assert.equal(await failed.loadConexaAvatars(),null);
});

test('sound starts muted, needs explicit opt-in and limits overlapping event tones',()=>{
 let constructed=0,starts=0;const gains=[];
 class Audio {
  constructor(){constructed++;this.state='running';this.currentTime=1;this.destination={};}
  resume(){return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
  createGain(){const gain={value:0,setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}};gains.push(gain);return {gain,connect(){},disconnect(){}};}
  createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){starts++;},stop(){}};}
 }
 const env=context({AudioContext:Audio}),sound=env.createConexaSound();
 assert.equal(sound.enabled,false);assert.equal(sound.play('clue'),false);assert.equal(constructed,0);
 assert.equal(sound.setEnabled(true),true);assert.equal(constructed,1);assert.equal(sound.play('clue'),true);assert.equal(sound.play('clue'),false);assert.equal(starts,1);
 sound.setEnabled(false);assert.equal(sound.play('complete'),false);assert.equal(gains[0].value,0);sound.close();
 assert.equal(sound.setEnabled(true),true);assert.equal(sound.play('complete'),true);assert.equal(constructed,2);sound.close();
 assert.equal(context().createConexaSound().setEnabled(true),false);
});
