/* Real Chromium UI -> local HTTP -> production C cores. No ESP32 is accessed. */
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {startServer} from './v1_server.mjs';
const require=createRequire(process.env.CONEXA_PLAYWRIGHT_MODULE || import.meta.url);
const {chromium}=require('playwright');
const out=new URL('../evidence/game-v1/browser/',import.meta.url);await mkdir(out,{recursive:true});
const host=await startServer(),browser=await chromium.launch({headless:true});
const report={provenance:'Chromium + loopback HTTP + production C cores; no ESP32',steps:[],errors:[],external:[],captures:[]};
const check=(name,data={})=>{report.steps.push({name,...data});console.log('PASS '+name);};
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
const teacher=await browser.newPage({viewport:{width:1440,height:900}});
const peer=await browser.newPage({viewport:{width:1440,height:900}});
const projector=await browser.newPage({viewport:{width:1920,height:1080}});
for(const p of [page,teacher,peer,projector]){
 p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(e.message));
 await p.route('**/*',async route=>{if(new URL(route.request().url()).origin!==host.baseURL){report.external.push(route.request().url());return route.abort();}return route.continue();});
}
const snap=async(p,name)=>{const path=new URL(name+'.png',out);await p.screenshot({path:fileURLToPath(path)});report.captures.push(name+'.png');};
const closeDialogs=async p=>{while(await p.locator('dialog[open]').count())await p.locator('dialog[open]').last().locator('button').first().click();};
const journal=async()=>{await closeDialogs(page);await page.locator('#views-button').click();await page.locator('#v1-journal-button').click();};
let movementCaptured=false;
const points=[[10,4],[5,5],[6,10],[12,6]];
const go=async(index)=>{await journal();await page.locator('#v1-go-'+index).click();if(!movementCaptured){await page.waitForTimeout(400);assert.equal(await page.locator('#iso-world').getAttribute('data-moving'),'true');await snap(page,'movement-mobile');movementCaptured=true;}await page.waitForFunction(target=>document.querySelector('#iso-world').dataset.confirmed===target,points[index].join(','),{timeout:30000});await page.waitForFunction(()=>document.querySelector('#iso-world').dataset.moving==='false');};
const teacherAction=async op=>{await teacher.locator('#v1-control-'+op).click();if(await teacher.locator('#v1-confirmation').evaluate(e=>e.open))await teacher.locator('#v1-confirmation').getByRole('button',{name:'Confirmar',exact:true}).click();};
const login=async(p,id)=>{await p.goto(host.baseURL+'/');await p.locator('#interact').click();await p.locator('#student-code').fill('BTESTSTUDENT'+String(id).padStart(2,'0'));await p.locator('#student-login-button').click();await p.waitForFunction(()=>document.body.dataset.authenticated==='true');await closeDialogs(p);if(await p.locator('#dismiss-button').isVisible())await p.locator('#dismiss-button').click();};
try{
 await teacher.goto(host.baseURL+'/professor');await teacher.locator('#teacher-key').fill('BTESTTEACHER');await teacher.locator('#teacher-login-button').click();
 await login(page,7);await login(peer,8);await projector.goto(host.baseURL+'/projetor');
 await teacherAction('start');await page.waitForFunction(()=>document.querySelector('#iso-world').dataset.phase==='open');check('student login + teacher start');
 for(const size of [[390,844],[320,740],[844,390]]){await page.setViewportSize({width:size[0],height:size[1]});await page.waitForTimeout(350);assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));await snap(page,'mobile-'+size.join('x'));}await page.setViewportSize({width:390,height:844});
 await snap(peer,'desktop-1440x900');await snap(projector,'projector-1920x1080');
 for(let m=0;m<3;m++){
  for(let i=0;i<4;i++){
   if(i===3)await teacherAction('release');
   await go(i);await page.locator('#interact').click();await page.locator('#v1-collect').click();await page.locator('#v1-conversation .v1-confirmed').waitFor();check('mission '+(m+1)+' clue '+i);
   if(m===0&&i===1)await snap(page,'npc-conversation-mobile');
  }
  await go(0);await journal();
  for(const [i,n] of [[1,2,0,3],[2,0,3,1],[1,3,0,2]][m].entries())await page.locator('#v1-match-'+i).selectOption(String(n));
  await page.locator('#v1-journal input[type=radio]').nth(m).check();await page.locator('#v1-resolve').click();
  await page.waitForFunction(expected=>document.querySelector('#v1-journal-button').dataset.completed===String(expected),(1<<(m+1))-1);await page.locator('#v1-journal .v1-consequence').waitFor();check('mission '+(m+1)+' completed with evidence and consequence');await snap(page,'mission-'+(m+1)+'-complete');
  await closeDialogs(page);await peer.waitForFunction(pos=>document.querySelector('#iso-world').dataset.positions.slice(12,14)===pos,'a4');check('peer sees confirmed position after mission '+(m+1));
  if(m<2){await teacherAction('next');await page.waitForFunction(expected=>document.querySelector('#v1-journal-button').dataset.mission===String(expected),m+1);}
 }
 await teacherAction('finish');await page.waitForFunction(()=>document.querySelector('#iso-world').dataset.phase==='closed');await projector.locator('#projector-results').click();await projector.getByText('O que a comunidade construiu',{exact:true}).waitFor();await snap(projector,'projector-final-results');await snap(teacher,'teacher-session');
 assert.equal(await projector.locator('#student-code:visible,#teacher-key:visible').count(),0);check('teacher finish + public aggregate outcomes without credentials');
 assert.equal(report.errors.length,0);assert.equal(report.external.length,0);check('no page errors or external requests; local-only resources');
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error.stack);report.state=await page.locator('#iso-world').evaluate(e=>({...e.dataset})).catch(()=>null);report.requests=host.requests.slice(-25);await snap(page,'failure').catch(()=>{});console.error(error);process.exitCode=1;}
finally{await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();await host.close();}
