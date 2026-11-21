/* LOOPBACK TEST HARNESS ONLY. Auth codes are synthetic; mutations and snapshots
 * execute the production C cores. Node HTTP is not ESP-IDF/lwIP or hardware. */
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';

const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const validBoot=boot=>typeof boot==='string'&&/^[0-9a-fA-F]{16}$/.test(boot);
const exact=(body,fields)=>Object.keys(body).sort().join(',')===[...fields].sort().join(',');
const worldOps=new Set(['move','inspect','resolve','start','pause','resume','release','next','finish','reset']);
const p0Ops=new Set(['open','pause','resume','close','reset']);

function identity(header){
  if(!header)return{role:0,id:0};
  if(header==='Bearer BTESTTEACHER')return{role:2,id:0};
  const match=/^Bearer BTESTSTUDENT(\d{2})$/.exec(header);
  return match&&Number(match[1])>=1&&Number(match[1])<=44?{role:1,id:Number(match[1])}:null;
}

function parseFlat(text){
  if(text.includes('\0')||text.includes('\\u0000'))throw Error('INVALID_JSON');
  let inString=false,escaped=false,depth=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}
    else if(c==='"')inString=true;
    else if(c==='['||c===']')throw Error('INVALID_JSON');
    else if(c==='{'&&++depth>1)throw Error('INVALID_JSON');
    else if(c==='}'&&--depth<0)throw Error('INVALID_JSON');
    else if(c==='-'||/\d/.test(c)){
      let end=i+(c==='-'?1:0);if(!/\d/.test(text[end]||''))throw Error('INVALID_JSON');
      if(text[end]==='0'&&/\d/.test(text[end+1]||''))throw Error('INVALID_JSON');
      while(/\d/.test(text[end]||''))end++;
      if(/[.eE]/.test(text[end]||''))throw Error('INVALID_JSON');i=end-1;
    }
  }
  const body=JSON.parse(text);
  if(inString||depth!==0||!body||Array.isArray(body)||typeof body!=='object')throw Error('INVALID_JSON');
  /* cJSON exact_fields rejects duplicate keys; preserve that negative path. */
  const keys=[...text.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(m=>JSON.parse(m[1]));
  if(new Set(keys).size!==keys.length)throw Error('INVALID_ARGUMENT');
  return body;
}

async function assets(root,avatarDir){
  if(avatarDir){
    const metadata=(await readFile(join(avatarDir,'avatars.json'),'utf8')).trim();
    const manifest=JSON.parse(metadata),atlas=manifest.atlas?await readFile(join(avatarDir,'avatars.webp')):Buffer.alloc(0);
    return{manifest,atlas,etag:'"'+createHash('sha256').update(metadata).update(atlas).digest('hex').slice(0,24)+'"'};
  }
  const header=await readFile(join(root,'include/avatar_assets.h'),'utf8');
  const literal=header.match(/CONEXA_AVATAR_MANIFEST\[\]\s*=\s*("(?:\\.|[^"\\])*")\s*;/)?.[1];
  if(!literal)throw Error('Generated avatar manifest missing; run tools/prepare_avatars.py.');
  const manifest=JSON.parse(JSON.parse(literal));
  const count=Number(header.match(/CONEXA_AVATAR_ATLAS_LEN\s*=\s*(\d+)u/)?.[1]);
  const hex=header.match(/CONEXA_AVATAR_ATLAS\[\]\s*=\s*\{([\s\S]*?)\};/)?.[1].match(/0x[\da-f]{2}/ig)||[];
  const atlas=Buffer.from(hex.map(v=>Number.parseInt(v.slice(2),16))).subarray(0,count);
  if(!Number.isInteger(count)||atlas.length!==count)throw Error('Invalid generated avatar atlas.');
  const etagLiteral=header.match(/CONEXA_AVATAR_ETAG\[\]\s*=\s*("(?:\\.|[^"\\])*")\s*;/)?.[1];
  return{manifest,atlas,etag:etagLiteral?JSON.parse(etagLiteral):undefined};
}

export async function startServer({root=resolve('.'),avatarDir,port=0}={}){
  root=resolve(root);
  const executable=join(root,'evidence/game-v1/host/v1-host.exe');
  const built=await stat(executable).catch(()=>null);
  if(!built)throw Error('Native host absent: run node tests/build_v1_host.mjs with installed compiler configured.');
  for(const source of ['tests/v1_host_bridge.c','src/game_core.c','src/world_core.c','include/game_core.h','include/world_core.h']){
    if((await stat(join(root,source))).mtimeMs>built.mtimeMs)throw Error('Native host stale: rebuild with node tests/build_v1_host.mjs.');
  }
  const avatar=await assets(root,avatarDir);
  const child=spawn(executable,[],{stdio:['pipe','pipe','pipe']});
  const queue=[],requests=[];
  let closed=false,unavailable=false,writeDelay=0,timeOffset=0,started=performance.now();
  let dropBefore=null,loseAfter=null,hostError='';
  const now=()=>Math.floor(performance.now()-started+timeOffset)>>>0;
  const rejectQueue=error=>{while(queue.length)queue.shift().reject(error);};
  createInterface({input:child.stdout}).on('line',line=>{
    const item=queue.shift();if(!item)return;
    try{item.resolve(JSON.parse(line));}catch(error){item.reject(error);}
  });
  child.stderr.on('data',chunk=>{hostError=(hostError+String(chunk)).slice(-1024);});
  child.stdin.on('error',rejectQueue);
  child.on('error',rejectQueue);
  child.on('exit',code=>rejectQueue(Error('Native C bridge exited '+code+(hostError?' (native stderr available)':''))));
  function core(line){
    if(closed)return Promise.reject(Error('Host is closed.'));
    if(typeof line!=='string'||/[\r\n]/.test(line)||line.length>480)return Promise.reject(Error('Invalid bridge command.'));
    return new Promise((resolve,reject)=>{queue.push({resolve,reject});child.stdin.write(line+'\n');});
  }
  await core('S 0 0');
  const readRoutes=new Set(['/api/state','/api/session','/api/world','/api/health']);
  const writeRoutes=new Set(['/api/join','/api/vote','/api/control','/api/world/action']);
  const worldStatus=result=>result===1?400:result===2||result===3?403:result===9?429:409;
  const p0Errors=['OK','INVALID_ARGUMENT','NOT_JOINED','ROUND_CHANGED','PHASE_CONFLICT','SEQUENCE_CONFLICT','COUNTER_LIMIT'];
  const worldMessages={too_far:'Aproxime seu avatar do local para interagir.',collision:'Escolha um caminho livre na cidade.',evidence_required:'Reúna as quatro pistas e confira as relações entre afirmações e evidências.',not_released:'Aguarde o professor liberar este acontecimento.',phase_conflict:'A exploração aguarda o início ou a retomada pelo professor.',rate_limit:'Aguarde a confirmação do próximo deslocamento.',already_completed:'Esta missão já foi concluída e está registrada.'};
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    const send=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Connection':'close','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});res.end(typeof data==='string'?data:JSON.stringify(data));};
    const error=(status,code,message='Solicitação recusada no ensaio local.')=>send(status,{error:code,message},status===401?{'WWW-Authenticate':'Bearer'}:{});
    const lose=()=>{res.writeHead(200,{'Content-Type':'application/json','Connection':'close'});res.write('{');res.flushHeaders();setImmediate(()=>res.destroy());};
    try{
      if(unavailable){req.socket.destroy();return;}
      if(['/','/professor','/projetor'].includes(path)){
        if(req.method!=='GET'){error(405,'METHOD_NOT_ALLOWED');return;}
        if(Number(req.headers['content-length']||0)!==0){error(400,'UNEXPECTED_BODY');return;}
        send(200,await readFile(join(root,'web/index.html'),'utf8'),{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return;
      }
      if(path==='/favicon.ico'){res.writeHead(204,{'Connection':'close'});res.end();return;}
      if(path==='/api/avatars'||path==='/avatars.webp'){
        if(req.method!=='GET'){error(405,'METHOD_NOT_ALLOWED');return;}
        if(Number(req.headers['content-length']||0)!==0){error(400,'UNEXPECTED_BODY');return;}
        if(path==='/api/avatars'){send(200,avatar.manifest,{'Cache-Control':'no-cache'});return;}
        if(!avatar.atlas.length){error(404,'NO_AVATARS');return;}
        res.writeHead(200,{'Content-Type':'image/webp','Connection':'close','Cache-Control':'public, max-age=0, must-revalidate','ETag':avatar.etag});res.end(avatar.atlas);return;
      }
      if(!readRoutes.has(path)&&!writeRoutes.has(path)){error(404,'NOT_FOUND');return;}
      if((readRoutes.has(path)&&req.method!=='GET')||(writeRoutes.has(path)&&req.method!=='POST')){error(405,'METHOD_NOT_ALLOWED');return;}
      const who=identity(req.headers.authorization);
      if(!who){requests.push({path,method:req.method,role:'invalid',status:401});error(401,'INVALID_TOKEN');return;}
      const {role,id}=who;
      const record={path,method:req.method,role,id};requests.push(record);
      if(req.method==='GET'){
        if(Number(req.headers['content-length']||0)!==0){error(400,'UNEXPECTED_BODY');return;}
        if(path==='/api/health'){
          if(role===0){error(401,'TOKEN_REQUIRED');return;}
          if(role!==2){error(403,'ROLE_FORBIDDEN');return;}
          const state=await core(`S ${role} ${id}`);
          send(200,{version:'GAME-V1-NATIVE-TEST',chip:'HOST-C-NO-ESP32',boot:state.p0.boot,uptime_s:Math.floor(now()/1000),requests:requests.length});return;
        }
        const state=await core(`S ${role} ${id}`);
        send(200,path==='/api/state'?state.p0:path==='/api/world'?state.world:{p0:state.p0,world:state.world});return;
      }
      if(role===0){error(401,'TOKEN_REQUIRED');return;}
      if(path!=='/api/world/action'&&role!==(path==='/api/control'?2:1)){error(403,'ROLE_FORBIDDEN');return;}
      if(Number(req.headers['content-length']||0)>384){error(413,'BODY_TOO_LARGE');return;}
      if(!/^application\/json(?:[\t ]*(?:;.*)?)?$/i.test(req.headers['content-type']||'')){error(400,'JSON_REQUIRED');return;}
      let bytes=0,text='';for await(const chunk of req){bytes+=chunk.length;if(bytes>384){error(413,'BODY_TOO_LARGE');return;}text+=chunk;}
      let body;try{body=parseFlat(text);}catch(e){error(400,e.message==='INVALID_ARGUMENT'?'INVALID_ARGUMENT':'INVALID_JSON');return;}
      let command;
      if(path==='/api/join'&&exact(body,[]))command=`J ${role} ${id}`;
      else if(path==='/api/vote'&&exact(body,['boot','round','choice','seq'])&&validBoot(body.boot)&&integer(body.round,1,0xffffffff)&&integer(body.choice,0,2)&&integer(body.seq,1,0x7fffffff))command=`V ${role} ${id} ${body.boot} ${body.round} ${body.choice} ${body.seq}`;
      else if(path==='/api/control'&&exact(body,['boot','round','action'])&&validBoot(body.boot)&&integer(body.round,1,0xffffffff)&&p0Ops.has(body.action))command=`C ${role} ${id} ${body.action} ${body.boot} ${body.round}`;
      else if(path==='/api/world/action'&&exact(body,['boot','epoch','seq','op','arg'])&&validBoot(body.boot)&&integer(body.epoch,1,0xffffffff)&&integer(body.seq,1,0x7fffffff)&&integer(body.arg,0,0xffffffff)&&worldOps.has(body.op))command=`W ${role} ${id} ${body.boot} ${body.epoch} ${body.seq} ${body.op} ${body.arg}`;
      else{error(400,path==='/api/world/action'?'invalid_argument':'INVALID_ARGUMENT');return;}
      /* Only validated public protocol fields are retained, never headers,
       * malformed string values or authentication credentials. */
      record.body=body;
      if(dropBefore===path){dropBefore=null;lose();return;}
      if(writeDelay){const delay=writeDelay;writeDelay=0;await new Promise(resolve=>setTimeout(resolve,delay));}
      const state=await core(command+(path==='/api/world/action'?' '+now():''));
      if(loseAfter===path){loseAfter=null;lose();return;}
      if(state.world_result!==0){error(worldStatus(state.world_result),state.world_error,worldMessages[state.world_error]||'O estado mudou. Consulte o mundo antes de agir novamente.');return;}
      if(state.result!==0){error(state.result===1?400:state.result===2?403:409,p0Errors[state.result]||'INTERNAL_ERROR');return;}
      send(200,path==='/api/world/action'?{p0:state.p0,world:state.world}:state.p0);
    }catch(e){
      if(!res.headersSent)error(500,'HOST_TEST_ERROR');else res.destroy();
    }
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const baseURL='http://127.0.0.1:'+server.address().port;
  const controls={
    async restart(newBoot=randomBytes(8).toString('hex')){if(!validBoot(newBoot))throw Error('Invalid synthetic boot.');started=performance.now();timeOffset=0;return core(`B 0 0 ${newBoot}`);},
    offline(value){unavailable=Boolean(value);},
    advanceTime(ms){if(!Number.isFinite(ms)||ms<0)throw Error('Nonnegative elapsed time required.');timeOffset+=ms;},
    loseNextResponse(path='/api/world/action'){loseAfter=path;},
    dropNextBefore(path='/api/world/action'){dropBefore=path;},
    delayNextWrite(ms){if(!integer(ms,0,10000))throw Error('Delay must be 0..10000ms.');writeDelay=ms;},
    now
  };
  const faults={offline:controls.offline,loseVote(){controls.loseNextResponse('/api/vote');},loseControl(){controls.loseNextResponse('/api/control');},dropVoteBefore(){controls.dropNextBefore('/api/vote');},delayNextWrite:controls.delayNextWrite};
  return{baseURL,origin:baseURL,core,controls,faults,requests,async close(){
    if(closed)return;
    closed=true;
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    const exited=child.exitCode!==null?Promise.resolve():once(child,'exit');
    child.stdin.end();await exited;
  }};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=await startServer({port:Number(process.env.CONEXA_TEST_PORT||0),avatarDir:process.env.CONEXA_TEST_AVATAR_DIR});
  console.log('LOCAL C TEST HARNESS — NO ESP32 — '+server.baseURL);
  const stop=async()=>{await server.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
