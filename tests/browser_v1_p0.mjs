/* Chromium -> loopback HTTP -> production native C cores. Synthetic identities.
 * Browser/API regression evidence only, never physical ESP32 capacity proof. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {startServer} from './v1_server.mjs';

export async function verifyV1P0(browser,{root=resolve('.'),out=join(root,'evidence/game-v1/p0-regression')}={}){
  await mkdir(out,{recursive:true});
  const host=await startServer({root}),contexts=[],checks=[],errors=[],external=[],paths=new Set();
  const check=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);};
  const snapshot=async(role=0,id=0)=>host.core(`S ${role} ${id}`);
  const writes=path=>host.requests.filter(r=>r.method==='POST'&&r.path===path);
  const online=p=>p.waitForFunction(()=>document.getElementById('connection')?.dataset.state==='online',null,{timeout:15000});
  /* The compact phase label now belongs to V1; P0 retains its own badge state. */
  const phase=(p,text)=>p.waitForFunction(t=>document.getElementById('phase-badge')?.dataset.phase===t,{'Escolhas abertas':'open','Pausa':'paused','encerrada':'closed','Esperando':'lobby'}[text],{timeout:15000});
  const answer=(p,choice)=>p.waitForFunction(letter=>document.getElementById('answer-status')?.textContent.includes('Escolha '+letter+' confirmada'),'ABC'[choice],{timeout:18000});
  async function closeDialog(p){for(const dialog of await p.locator('dialog[open]').all()){const close=dialog.locator('[data-close],.v1-close');if(await close.count())await close.first().click();else await p.keyboard.press('Escape');}}
  async function dismiss(p){if(await p.locator('#dismiss-button').isVisible())await p.locator('#dismiss-button').click();}
  async function menu(p){if(await p.locator('#view-menu').isHidden())await p.locator('#views-button').click();}
  async function account(p){await closeDialog(p);await menu(p);await p.locator('#profile-button').click();}
  async function login(p,id=7){await account(p);await p.locator('#student-code').fill('BTESTSTUDENT'+String(id).padStart(2,'0'));await p.locator('#student-login-button').click();await p.waitForFunction(i=>document.getElementById('iso-world')?.dataset.ownId===String(i),id,{timeout:15000});assert.equal(await p.locator('#student-code').inputValue(),'');await closeDialog(p);await dismiss(p);}
  async function legacy(p){await closeDialog(p);await menu(p);await p.locator('#legacy-poll').click();await p.locator('#mission-dialog').waitFor({state:'visible'});}
  async function client(route='/',viewport={width:1440,height:900}){
    const context=await browser.newContext({viewport,isMobile:viewport.width<900,hasTouch:viewport.width<900});contexts.push(context);context.setDefaultTimeout(7000);
    await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==host.baseURL){external.push(u.origin);return route.abort();}paths.add(u.pathname);return route.continue();});
    await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const badge=document.createElement('div');badge.textContent='ENSAIO LOCAL · NÚCLEOS C · SEM ESP32';badge.style.cssText='position:fixed;bottom:0;left:50%;transform:translateX(-50%);z-index:10000;background:#153b43;color:white;font:8px/13px system-ui;white-space:nowrap;padding:0 8px;pointer-events:none';document.body.append(badge);for(const dialog of document.querySelectorAll('dialog'))dialog.append(badge.cloneNode(true));}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(host.baseURL+route);await online(page);return page;
  }
  let releaseStale=()=>{},unpoison=()=>{};
  try{
    const student=await client();
    await check('anonymous, invalid code and wrong-role code cannot create student identity',async()=>{
      assert.equal(await student.locator('#iso-world').getAttribute('data-own-id'),'0');
      await account(student);await student.locator('#student-code').fill('INVALID');await student.locator('#student-login-button').click();
      await student.locator('#notice-text').filter({hasText:/Acesso não confirmado/}).waitFor({state:'visible',timeout:12000});await online(student);
      assert.equal(await student.locator('#student-code').inputValue(),'');assert.equal((await snapshot()).p0.participants,0);
      await student.locator('#student-code').fill('BTESTTEACHER');await student.locator('#student-login-button').click();await student.locator('#notice-text').filter({hasText:/não é de aluno/}).waitFor({state:'visible',timeout:12000});await online(student);
      assert.equal((await snapshot()).p0.participants,0);await closeDialog(student);await dismiss(student);
    });
    await check('student join confirms native identity and clears credential input',async()=>{await login(student);const state=await snapshot(1,7);assert.equal(state.p0.me.joined,true);assert.equal(state.world.me.joined,true);assert.equal(state.p0.participants,1);assert.equal(await student.locator('#iso-world').getAttribute('data-own-id'),'7');});
    const teacher=await client('/professor');
    await check('teacher auth retains P0 control and explicit native-only health',async()=>{
      assert.equal(await teacher.locator('#control-open').isDisabled(),true);await teacher.locator('#teacher-key').fill('BTESTTEACHER');await teacher.locator('#teacher-login-button').click();await teacher.locator('#teacher-workspace').waitFor({state:'visible'});assert.equal(await teacher.locator('#teacher-key').inputValue(),'');
      await teacher.locator('#control-open').click();await phase(student,'Escolhas abertas');assert.equal((await snapshot()).p0.phase,'open');
      await teacher.locator('#health-refresh').click();await teacher.locator('#health-grid').waitFor({state:'visible'});assert.match(await teacher.locator('#health-grid').textContent(),/HOST-C-NO-ESP32/);assert.match(await teacher.locator('#health-grid').textContent(),/Não informado/);
    });
    await check('legacy reading poll remains reachable and records exact P0 vote',async()=>{await legacy(student);await student.locator('[data-choice="1"]').click();await answer(student,1);const state=(await snapshot(1,7)).p0;assert.equal(state.me.choice,1);assert.equal(state.me.last_seq,1);assert.equal(state.answer_count,1);await student.screenshot({path:join(out,'p0-choice-confirmed.png'),scale:'css'});});
    await check('lost vote response reconciles committed C state without duplicate write',async()=>{
      const count=writes('/api/vote').length;host.controls.loseNextResponse('/api/vote');await student.locator('[data-choice="2"]').click();await answer(student,2);assert.equal(writes('/api/vote').length,count+1);const state=(await snapshot(1,7)).p0;assert.equal(state.me.last_seq,2);assert.equal(state.answer_count,1);
    });
    await check('pause blocks voting, resume restores controls',async()=>{await teacher.locator('#control-pause').click();await phase(student,'Pausa');assert.equal(await student.locator('[data-choice="0"]').isDisabled(),true);await teacher.locator('#control-resume').click();await phase(student,'Escolhas abertas');await student.locator('[data-choice="0"]').waitFor({state:'visible'});});
    await check('disconnect blocks writes and reconnect retains confirmed vote',async()=>{
      const count=writes('/api/vote').length;host.controls.offline(true);await student.waitForFunction(()=>document.getElementById('connection').dataset.state==='offline',null,{timeout:15000});assert.equal(await student.locator('[data-choice="0"]').isDisabled(),true);assert.equal(writes('/api/vote').length,count);
      host.controls.offline(false);await closeDialog(student);await student.locator('#retry-button').click();await online(student);await online(teacher);await dismiss(student);await legacy(student);await answer(student,2);
    });
    await check('uncommitted P0 vote reads session before identical retry',async()=>{
      const start=host.requests.length,before=(await snapshot(1,7)).p0.me.last_seq;host.controls.dropNextBefore('/api/vote');await student.locator('[data-choice="0"]').click();await answer(student,0);
      const calls=host.requests.slice(start).filter(r=>r.role===1&&r.id===7),votes=calls.filter(r=>r.path==='/api/vote');assert.equal(votes.length,2);assert.deepEqual(votes[0].body,votes[1].body);assert.ok(calls.slice(calls.indexOf(votes[0])+1,calls.indexOf(votes[1])).some(r=>r.path==='/api/session'&&r.method==='GET'));assert.equal((await snapshot(1,7)).p0.me.last_seq,before+1);
    });
    const second=await client();await login(second);await legacy(second);await answer(second,0);
    await check('same-code second tab cannot overwrite a sequence consumed by the first tab',async()=>{
      const raw=await snapshot(1,7),stale={p0:raw.p0,world:raw.world};let frozen=true;releaseStale=()=>{frozen=false;};
      await second.route('**/api/session',async route=>{if(frozen&&route.request().method()==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify(stale)});return route.continue();});
      await student.locator('[data-choice="1"]').click();await answer(student,1);const first=(await snapshot(1,7)).p0;
      const releaseOnVote=request=>{if(new URL(request.url()).pathname==='/api/vote')frozen=false;};second.on('request',releaseOnVote);
      const count=writes('/api/vote').length;await second.locator('[data-choice="2"]').click();await answer(second,1);second.off('request',releaseOnVote);releaseStale();
      assert.equal(writes('/api/vote').length,count+1);assert.equal(writes('/api/vote').at(-1).body.seq,first.me.last_seq);assert.equal((await snapshot(1,7)).p0.me.choice,1);assert.equal((await snapshot(1,7)).p0.me.last_seq,first.me.last_seq);
      await second.locator('[data-choice="2"]').click();await answer(second,2);await answer(student,2);assert.equal((await snapshot(1,7)).p0.me.last_seq,first.me.last_seq+1);assert.equal((await snapshot()).p0.answer_count,1);
    });
    await check('malformed session is rejected, keeps prior state and recovers',async()=>{
      let poison=true;unpoison=()=>{poison=false;};
      await student.route('**/api/session',async route=>{if(!poison)return route.continue();const raw=await snapshot(1,7);raw.p0.participants=44;return route.fulfill({contentType:'application/json',body:JSON.stringify({p0:raw.p0,world:raw.world})});});
      await student.waitForFunction(()=>document.getElementById('connection').dataset.state==='offline',null,{timeout:15000});assert.equal(await student.locator('[data-choice="0"]').isDisabled(),true);assert.equal(await student.locator('#participants-count').textContent(),'1');
      unpoison();await closeDialog(student);await student.locator('#retry-button').click();await online(student);await dismiss(student);await legacy(student);await answer(student,2);
    });
    const projector=await client('/projetor',{width:1920,height:1080});
    await check('projection hides auth and reveals only closed aggregate P0 decisions',async()=>{
      assert.equal(await projector.locator('form:visible,input:visible').count(),0);assert.equal((await snapshot()).p0.totals,null);
      await teacher.locator('#control-close').click();await phase(projector,'encerrada');await legacy(projector);const state=(await snapshot()).p0;
      for(let i=0;i<3;i++)assert.match(await projector.locator('#total-'+i).textContent(),new RegExp('^'+state.totals[i]+' escolha'));
      assert.equal(state.me,null);await projector.screenshot({path:join(out,'p0-projector-closed.png'),scale:'css'});await closeDialog(projector);
    });
    await check('P0 reset cancellation writes nothing; lost reset ACK changes round once and preserves world',async()=>{
      const before=await snapshot(),count=writes('/api/control').length;teacher.once('dialog',d=>d.dismiss());await teacher.locator('#control-reset').click();assert.equal(writes('/api/control').length,count);
      host.controls.loseNextResponse('/api/control');teacher.once('dialog',d=>d.accept());await teacher.locator('#control-reset').click();await phase(teacher,'Esperando');const after=await snapshot();assert.equal(after.p0.round,before.p0.round+1);assert.equal(after.p0.answer_count,0);assert.equal(after.p0.participants,1);assert.deepEqual(after.world,before.world);assert.equal(writes('/api/control').length,count+1);
    });
    await check('reboot during delayed P0 write rejects old boot and restores same identity',async()=>{
      await teacher.locator('#control-open').click();await phase(student,'Escolhas abertas');await legacy(student);
      const start=host.requests.length;host.controls.delayNextWrite(650);await student.locator('[data-choice="0"]').click();
      const deadline=Date.now()+3500;while(!host.requests.slice(start).some(r=>r.path==='/api/vote')){if(Date.now()>deadline)throw Error('Delayed vote did not reach native host.');await new Promise(resolve=>setTimeout(resolve,15));}
      await host.controls.restart('fedcba0987654321');await phase(student,'Esperando');await student.waitForFunction(()=>document.getElementById('iso-world').dataset.ownId==='7',null,{timeout:15000});
      const state=await snapshot(1,7);assert.equal(state.p0.boot,'fedcba0987654321');assert.equal(state.p0.me.choice,-1);assert.equal(state.p0.me.last_seq,0);assert.equal(state.p0.participants,1);assert.equal(state.world.me.joined,true);assert.equal(state.world.me.seq,0);assert.equal(writes('/api/vote').filter(r=>host.requests.indexOf(r)>=start).length,1);
    });
    await check('logout and reload do not persist credentials; same-code entry recovers server identity',async()=>{
      await account(student);await student.locator('#student-logout').click();await student.locator('#student-auth').waitFor({state:'visible'});assert.equal(await student.locator('#iso-world').getAttribute('data-own-id'),'0');await closeDialog(student);
      await student.reload();await online(student);assert.equal(await student.locator('#iso-world').getAttribute('data-own-id'),'0');
      const storage=await student.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));assert.deepEqual(storage,{local:[],session:[]});assert.ok(!student.url().includes('BTEST'));await login(student);assert.equal((await snapshot()).p0.participants,1);
    });
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={provenance:'Chromium and loopback HTTP with actual native game_core/world_core; synthetic codes; no ESP32 or 44-device proof.',browser:browser.version(),checks,errors,external,paths:[...paths],requests:host.requests,hardware_tested:false};
    await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));return report;
  }catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors,requests:host.requests},null,2));throw error;}
  finally{releaseStale();unpoison();host.controls.offline(false);for(const context of contexts)await context.close();await host.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const require=createRequire(process.env.CONEXA_PLAYWRIGHT_MODULE||import.meta.url);
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{const report=await verifyV1P0(browser);console.log(JSON.stringify({checks:report.checks.length,errors:report.errors,external:report.external}));}finally{await browser.close();}
}
