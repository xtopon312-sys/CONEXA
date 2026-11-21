/* 44 logical identities in the real native C core; TWO Chromium clients.
 * Sequential HTTP joins are not 44-device concurrency or ESP32 validation. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {startServer} from './v1_server.mjs';

export async function verifyLogical44(browser,{root=resolve('.'),out=join(root,'evidence/game-v1/logical-44')}={}){
  await mkdir(out,{recursive:true});
  const hash=async()=>createHash('sha256').update(await readFile(join(root,'web/index.html'))).digest('hex');
  const beforeHash=await hash(),host=await startServer({root}),contexts=[],errors=[],external=[],checks=[];
  const post=async(path,body,token)=>{
    const response=await fetch(host.baseURL+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
  };
  const session=async token=>{const response=await fetch(host.baseURL+'/api/session',{headers:token?{Authorization:'Bearer '+token}:{}});assert.equal(response.status,200);return response.json();};
  const check=(name)=>{checks.push({name,status:'PASS'});console.log('PASS '+name);};
  async function client(path,viewport){
    const context=await browser.newContext({viewport,isMobile:viewport.width<900,hasTouch:viewport.width<900,deviceScaleFactor:1});contexts.push(context);context.setDefaultTimeout(8000);
    await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==host.baseURL){external.push(route.request().url());return route.abort();}return route.continue();});
    await context.addInitScript(()=>{
      /* Observation only: record text drawn on the existing scene Canvas. */
      globalThis.__conexaDrawnLabels=new Set();
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...rest){if(this.canvas.id==='iso-world')globalThis.__conexaDrawnLabels.add(String(text));return original.call(this,text,...rest);};
      document.addEventListener('DOMContentLoaded',()=>{const badge=document.createElement('div');badge.id='test-logical-44';badge.textContent='44 IDENTIDADES LÓGICAS · 2 NAVEGADORES · NÚCLEOS C · SEM ESP32';badge.style.cssText='position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:10000;background:#153b43;color:#fff;font:8px/13px system-ui;white-space:nowrap;padding:0 6px;pointer-events:none';document.body.append(badge);});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(host.baseURL+path);
    await page.waitForFunction(()=>document.getElementById('connection').dataset.state==='online',null,{timeout:15000});return page;
  }
  try{
    for(let id=1;id<=44;id++){
      const state=await post('/api/join',{},'BTESTSTUDENT'+String(id).padStart(2,'0'));
      assert.equal(state.me.id,id);assert.equal(state.me.joined,true);assert.equal(state.participants,id);
    }
    const beforeStart=await session('BTESTTEACHER');
    assert.equal(beforeStart.p0.joined,'1'.repeat(44));assert.equal(beforeStart.world.positions.length,88);
    const pairs=beforeStart.world.positions.match(/.{2}/g);assert.equal(new Set(pairs).size,44);assert.ok(pairs.every(pair=>pair!=='--'));
    await post('/api/world/action',{boot:beforeStart.world.boot,epoch:beforeStart.world.epoch,seq:beforeStart.world.teacher.seq+1,op:'start',arg:0},'BTESTTEACHER');
    check('44 sequential authenticated HTTP joins produce 44 distinct native C identities and spawn positions');

    const projector=await client('/projetor',{width:1920,height:1080});
    await projector.waitForFunction(()=>document.getElementById('iso-world').dataset.presenceCount==='44'&&document.getElementById('iso-world').dataset.phase==='open',null,{timeout:12000});
    assert.equal(await projector.locator('#iso-world').getAttribute('data-own-id'),'0');
    assert.equal(await projector.locator('#iso-world').getAttribute('data-positions'),beforeStart.world.positions);
    assert.equal(await projector.locator('form:visible,input:visible').count(),0);
    check('1920x1080 projector renders all 44 confirmed identities without authentication fields');

    const student=await client('/',{width:390,height:844});
    await student.locator('#views-button').click();await student.locator('#profile-button').click();await student.locator('#student-code').fill('BTESTSTUDENT07');await student.locator('#student-login-button').click();
    await student.waitForFunction(()=>document.getElementById('iso-world').dataset.ownId==='7'&&document.getElementById('iso-world').dataset.presenceCount==='44',null,{timeout:15000});
    assert.equal(await student.locator('#student-code').inputValue(),'');await student.locator('#account-dialog [data-close]').click();
    if(await student.locator('#dismiss-button').isVisible())await student.locator('#dismiss-button').click();
    const actual=await session('BTESTSTUDENT07');
    assert.equal(actual.p0.participants,44);assert.equal(actual.world.me.id,7);assert.equal(actual.world.positions.length,88);assert.equal(actual.world.positions,beforeStart.world.positions);
    assert.equal(await student.locator('#iso-world').getAttribute('data-positions'),actual.world.positions);
    assert.equal(await student.locator('#iso-world').getAttribute('data-confirmed'),'7,9');
    check('390x844 student authenticates through UI as ID 7 and receives the same 44-position snapshot');

    const viewports=[];
    for(const [name,page] of [['projector-1920x1080',projector],['mobile-390x844',student]]){
      /* A live poll requests a redraw; inspection is observational, not state injection. */
      await page.waitForTimeout(1200);
      const labels=await page.evaluate(()=>[...globalThis.__conexaDrawnLabels]);
      const numbered=labels.filter(text=>/^(?:Participante\s+)?(?:0?[1-9]|[1-3]\d|4[0-4])$/.test(text));
      assert.equal(numbered.length,0,'Persistent numbered avatar labels: '+JSON.stringify(numbered));
      if(name.startsWith('mobile'))assert.ok(labels.includes('VOCÊ'));
      const layout=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},presenceCount:document.getElementById('iso-world').dataset.presenceCount,ownId:document.getElementById('iso-world').dataset.ownId,zoom:document.getElementById('iso-world').dataset.zoom,scenePositions:document.getElementById('iso-world').dataset.positions,visibleParticipantText:(document.body.innerText.match(/Participante\s+\d{2}/g)||[])}));
      assert.deepEqual(layout.document,layout.viewport);assert.equal(layout.visibleParticipantText.length,0);assert.equal(layout.scenePositions,actual.world.positions);
      await page.screenshot({path:join(out,name+'.png'),scale:'css'});viewports.push({name,...layout,canvasLabels:labels,permanentNumberedAvatarLabels:numbered});
    }
    check('actual scene captures preserve mobile viewport and use local-player highlight without 44 permanent labels');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const afterHash=await hash();assert.equal(afterHash,beforeHash,'HTML changed during evidence capture.');
    const ids=pairs.map((pair,index)=>({id:index+1,x:parseInt(pair[0],16),y:parseInt(pair[1],16)}));assert.equal(new Set(ids.map(p=>p.id)).size,44);
    const report={provenance:'44 synthetic identities joined sequentially via HTTP to production native C cores; two Chromium clients. NO physical ESP32, Wi-Fi load, or 44 simultaneous-device validation.',html_sha256:beforeHash,browser:browser.version(),checks,errors,external_requests:external,logical_identities:44,browser_clients:2,positions:actual.world.positions,positions_length:actual.world.positions.length,unique_ids:44,unique_initial_positions:new Set(pairs).size,ids,viewports,request_counts:{join:host.requests.filter(r=>r.path==='/api/join').length,world_actions:host.requests.filter(r=>r.path==='/api/world/action').length},hardware_tested:false,physical_capacity_validated:false};
    await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));return report;
  }catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors,requests:host.requests},null,2));throw error;}
  finally{for(const context of contexts)await context.close();await host.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const require=createRequire(process.env.CONEXA_PLAYWRIGHT_MODULE||import.meta.url);const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{const report=await verifyLogical44(browser);console.log(JSON.stringify({checks:report.checks.length,identities:report.logical_identities,clients:report.browser_clients,positions_length:report.positions_length,errors:report.errors}));}finally{await browser.close();}
}
