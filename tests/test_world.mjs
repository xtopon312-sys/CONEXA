import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const source = html.match(/\/\* WORLD_CORE_BEGIN \*\/([\s\S]*?)\/\* WORLD_CORE_END \*\//)?.[1];
assert.ok(source, 'Test the world functions actually embedded in the offline page.');
const world = vm.runInNewContext(source + '\nConexaWorld;');

test('projection and inverse agree for every tile, independent of viewport scale', () => {
  for (let y=0;y<world.size;y++) for(let x=0;x<world.size;x++) {
    const p=world.project(x,y), tile=world.unproject(p.x,p.y);
    assert.equal(tile.x,x);assert.equal(tile.y,y);
  }
});

test('buildings, trees, fractional coordinates and off-map destinations are blocked', () => {
  for(const [x,y] of [[1,2],[4,4],[10,2],[11,3],[1,9],[-1,7],[14,7],[2.1,5],[NaN,5],[Infinity,0],['5',5]]) assert.equal(world.walkable(x,y),false);
  assert.equal(world.path({x:7,y:9},{x:2,y:3}),null);
  assert.equal(world.path({x:-1,y:0},{x:7,y:9}),null);
});

test('every walkable tile is reachable from spawn by adjacent unobstructed steps', () => {
  const spawn={x:7,y:9};
  for(let y=0;y<world.size;y++) for(let x=0;x<world.size;x++) {
    if(!world.walkable(x,y))continue;
    const route=world.path(spawn,{x,y});assert.ok(route);
    let previous=spawn;
    for(const next of route){assert.ok(world.walkable(next.x,next.y));assert.equal(Math.abs(previous.x-next.x)+Math.abs(previous.y-next.y),1);previous=next;}
    assert.equal(previous.x,x);assert.equal(previous.y,y);
  }
});

test('all named locations have reachable entrances outside the building footprint', () => {
  for(const p of Object.values(world.locations)) assert.ok(world.path({x:7,y:9},p));
  assert.equal(world.path({x:5,y:5},{x:5,y:5}).length,0);
  const around=world.path({x:0,y:3},{x:5,y:3});
  assert.ok(around.length>5,'A straight path through the school must be rejected in favor of a detour.');
});

test('44 illustrative seats are unique, walkable and never occupy the local spawn', () => {
  const keys=new Set();
  for(let id=1;id<=44;id++){const p=world.seat(id);assert.ok(world.walkable(p.x,p.y));assert.notEqual(p.x+','+p.y,'7,9');keys.add(p.x+','+p.y);}
  assert.equal(keys.size,44);assert.equal(world.seat(0),null);assert.equal(world.seat(45),null);
});

test('Canvas navigation stays transport-free while V1 explicitly confirms positions through the session layer', () => {
  const local=html.slice(html.indexOf('/* WORLD_CORE_BEGIN */'),html.indexOf('/* PROTOCOL_CORE_BEGIN */'));
  assert.doesNotMatch(local,/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|Authorization|localStorage|sessionStorage|\/api\//);
  assert.doesNotMatch(html,/\/api\/move|\/api\/sync/);
  // GAME V1 now authorizes spatial synchronization; P2's local-only label is obsolete.
  assert.match(html,/Posições e progresso são confirmados pela placa/);
  assert.match(html,/request\('\/api\/world\/action','POST',action\.body\)/);
});
