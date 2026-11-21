import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {startServer} from './v1_server.mjs';

test('two-core join commits atomically even at revision counter limits',()=>{
  const run=spawnSync(resolve('evidence/game-v1/host/v1-host.exe'),['--join-atomic-check'],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);assert.match(run.stdout,/duplicate-limit PASS/);
});

test('loopback HTTP exposes actual C session, role checks, spatial receipts and reboot',async()=>{
  const server=await startServer();
  const get=async(path,token)=>{const r=await fetch(server.baseURL+path,{headers:token?{Authorization:'Bearer '+token}:{}});return{status:r.status,data:await r.json()};};
  const post=async(path,body,token='BTESTSTUDENT07')=>{const r=await fetch(server.baseURL+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  try{
    const initial=await get('/api/session');
    assert.equal(initial.status,200);assert.equal(initial.data.p0.protocol,1);assert.equal(initial.data.world.v,1);assert.equal(initial.data.p0.boot,initial.data.world.boot);
    assert.equal(initial.data.world.positions,'--'.repeat(44));
    assert.equal((await get('/api/session','INVALID')).status,401);
    assert.equal((await get('/api/health','BTESTSTUDENT07')).status,403);
    assert.equal((await get('/api/health')).status,401);
    assert.equal((await post('/api/join',{})).status,200);
    assert.equal((await post('/api/join',{},'BTESTSTUDENT08')).status,200);
    assert.equal((await post('/api/join',{},'BTESTTEACHER')).status,403);
    const joined=(await get('/api/session','BTESTSTUDENT07')).data;
    assert.equal(joined.p0.me.id,7);assert.equal(joined.world.me.joined,true);assert.equal(joined.world.positions.slice(12,16),'7954');
    const request={boot:joined.world.boot,epoch:1,seq:1,op:'start',arg:0};
    assert.equal((await post('/api/world/action',request)).status,403);
    assert.equal((await post('/api/world/action',request,'BTESTTEACHER')).status,200);
    const move={...request,op:'move',arg:134};
    const moved=await post('/api/world/action',move);assert.equal(moved.status,200);assert.equal(moved.data.world.me.x,8);assert.equal(moved.data.world.me.last_op,'move');
    const duplicate=await post('/api/world/action',move);assert.deepEqual(duplicate,moved);
    assert.equal((await post('/api/world/action',{...move,arg:135})).status,409);
    assert.equal((await post('/api/world/action',{...move,seq:2,arg:135})).status,429);
    const seen=(await get('/api/world','BTESTSTUDENT08')).data;assert.equal(seen.positions.slice(12,14),'89');assert.equal(seen.me.id,8);
    const manifest=await get('/api/avatars');assert.equal(manifest.status,200);assert.equal(manifest.data.anchor,'feet-center');
    const atlas=await fetch(server.baseURL+'/avatars.webp');assert.equal(atlas.status,manifest.data.entries.length?200:404);await atlas.arrayBuffer();
    const oldBoot=joined.world.boot;await server.controls.restart('fedcba0987654321');
    const restarted=(await get('/api/session','BTESTSTUDENT07')).data;
    assert.notEqual(restarted.world.boot,oldBoot);assert.equal(restarted.world.me.joined,false);assert.equal(restarted.p0.me.joined,false);
    assert.equal((await post('/api/world/action',move)).status,409);
    assert.ok(!JSON.stringify(server.requests).includes('BTEST'));assert.ok(!JSON.stringify(server.requests).includes('Bearer'));
    console.log('Actual native C /api/session confirmed; recorded API requests='+server.requests.length+'; world bytes='+Buffer.byteLength(JSON.stringify(seen)));
  }finally{await server.close();}
});

test('lost and uncommitted responses reconcile against real C with unchanged request bodies',async()=>{
  const server=await startServer();
  const post=(path,body,token='BTESTTEACHER')=>fetch(server.baseURL+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}).then(async r=>({status:r.status,data:await r.json()}));
  const state=()=>fetch(server.baseURL+'/api/session',{headers:{Authorization:'Bearer BTESTTEACHER'}}).then(r=>r.json());
  try{
    const initial=await state();
    const start={boot:initial.world.boot,epoch:1,seq:1,op:'start',arg:0};
    server.controls.loseNextResponse();
    await assert.rejects(()=>post('/api/world/action',start));
    const committed=await state();assert.equal(committed.world.phase,'open');assert.equal(committed.world.teacher.seq,1);
    const retry=await post('/api/world/action',start);assert.equal(retry.status,200);assert.deepEqual(retry.data,committed);
    const pause={...start,seq:2,op:'pause'};
    server.controls.dropNextBefore();await assert.rejects(()=>post('/api/world/action',pause));
    assert.deepEqual(await state(),committed);
    const applied=await post('/api/world/action',pause);assert.equal(applied.status,200);assert.equal(applied.data.world.phase,'paused');
    const oldEpoch=applied.data.world.epoch,reset={...start,seq:3,op:'reset'};
    server.controls.loseNextResponse();await assert.rejects(()=>post('/api/world/action',reset));
    const resetState=await state();assert.equal(resetState.world.epoch,oldEpoch+1);assert.equal(resetState.world.teacher.seq,0);
    assert.deepEqual((await post('/api/world/action',reset)).data,resetState);
    const actions=server.requests.filter(r=>r.path==='/api/world/action').map(r=>r.body);
    assert.deepEqual(actions[0],actions[1]);assert.deepEqual(actions[2],actions[3]);assert.deepEqual(actions[4],actions[5]);
  }finally{await server.close();}
});

test('HTTP parser negative cases do not mutate native C',async()=>{
  const server=await startServer();
  try{
    const before=await(await fetch(server.baseURL+'/api/session')).json();
    for(const body of ['{"boot":"1234567890abcdef","epoch":1,"seq":1,"op":"start","arg":0,"arg":1}','{"x":{"x":1}}','{"x":1e0}','{"x":1.1}','[]','null','{"x":"\\u0000"}']){
      const r=await fetch(server.baseURL+'/api/world/action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer BTESTTEACHER'},body});assert.equal(r.status,400,body);
    }
    const long=await fetch(server.baseURL+'/api/world/action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer BTESTTEACHER'},body:JSON.stringify({x:'a'.repeat(400)})});assert.equal(long.status,413);
    const badtype=await fetch(server.baseURL+'/api/join',{method:'POST',headers:{'Content-Type':'text/plain',Authorization:'Bearer BTESTSTUDENT07'},body:'{}'});assert.equal(badtype.status,400);
    const after=await(await fetch(server.baseURL+'/api/session')).json();assert.deepEqual(after,before);
  }finally{await server.close();}
});
