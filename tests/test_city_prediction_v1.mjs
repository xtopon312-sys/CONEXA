/* Regression for rapid reversals before a compact movement packet is confirmed.
 * Uses actual production navigation/animation code and synthetic frame times.
 * Canvas calls are no-op: this is state validation, not a visual screenshot. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const source=html.split('/* WORLD_CORE_BEGIN */')[1].split('/* WORLD_CORE_END */')[0]+'\n'+html.split('/* AVATAR_SCENE_BEGIN */')[1].split('/* AVATAR_SCENE_END */')[0];
function fixture(){
 let nextFrame=null,time=0;
 function canvas(){
  const drawing=new Proxy({createLinearGradient:()=>({addColorStop(){}}),measureText:text=>({width:text.length*7}),getImageData:()=>({data:new Uint8Array([0,0,0,255])})},{get:(o,k)=>k in o?o[k]:()=>{}});
  return {width:390,height:844,clientWidth:390,clientHeight:844,dataset:{},getContext:()=>drawing,addEventListener(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})};
 }
 const surface=canvas(),environment=vm.createContext({console,Uint8Array,devicePixelRatio:1,performance:{now:()=>time},matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>{nextFrame=fn;return 1;},cancelAnimationFrame(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},document:{hidden:false,createElement:canvas,addEventListener(){},dispatchEvent(){}},window:{addEventListener(){}}});
 vm.runInContext(source+';this.makeCity=createCity;',environment);
 const city=environment.makeCity(surface,()=>{},()=>{});
 const world=(x,y)=>({boot:'0123456789abcdef',epoch:1,phase:'open',me:{id:7,joined:true,x,y,done:0},completed:[0,0,0],positions:'--'.repeat(6)+x.toString(16)+y.toString(16)+'--'.repeat(37)});
 city.updateWorld(world(7,9),true);
 function advance(ms=320){for(let elapsed=0;elapsed<ms;elapsed+=40){time+=40;const frame=nextFrame;nextFrame=null;frame(time);}}
 return {city,advance,world};
}

test('confirmation consumes the latest matching point after rapid right-left-right',()=>{
 const {city,advance,world}=fixture();
 for(const [x,y] of [[8,9],[7,9],[8,9]]){assert.equal(city.navigate(x,y),true);advance();}
 assert.equal(city.getState().predicted,3);
 city.updateWorld(world(8,9),true);
 assert.equal(city.getState().predicted,0,'the confirmed endpoint must not leave already-acknowledged reversal steps queued');
 assert.equal(city.getState().tile.x,8);assert.equal(city.getState().tile.y,9);
});

test('a normal confirmation preserves a later unconfirmed tile',()=>{
 const {city,advance,world}=fixture();
 city.navigate(8,9);advance();city.navigate(9,9);advance();
 assert.equal(city.getState().predicted,2);
 city.updateWorld(world(8,9),true);
 assert.equal(city.getState().predicted,1);assert.equal(city.getState().tile.x,9);
 city.updateWorld(world(9,9),true);
 assert.equal(city.getState().predicted,0);
});

test('zero-distance reversals settle locally without dropping the next planned path',()=>{
 const {city,advance}=fixture();
 city.navigate(8,9);advance();city.navigate(7,9);advance();
 assert.equal(city.getState().predicted,2);assert.equal(city.getState().tile.x,7);
 city.navigate(8,9); // The new path exists but has not started its next frame.
 assert.equal(city.getState().moving,true);
 assert.equal(city.settleNoop(),true);assert.equal(city.getState().predicted,0);
 assert.equal(city.getState().moving,true,'settling a loop must preserve the pending route');
 advance();assert.equal(city.getState().tile.x,8);assert.equal(city.getState().predicted,1);
 assert.equal(city.settleNoop(),false,'a changed endpoint still requires a server movement');
});
