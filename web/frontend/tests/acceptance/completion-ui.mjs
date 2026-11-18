import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gill-v04-'));const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});let ws;const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
try{let port;for(let i=0;i<60;i++){try{port=(await fs.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};const click=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).click()`);await sleep(90);};const fill=(id,v)=>ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(v)}`);const submit=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).requestSubmit()`);await sleep(100);};const go=async h=>{await ev(`location.hash=${JSON.stringify(h)}`);await sleep(130);};const check=async(label,e)=>{if(!await ev(e))throw Error(label+' '+JSON.stringify(errors));checks.push(label);};const view=(width,height,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});const shot=async name=>{await sleep(230);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`gui-test-screenshots/v20261118-completion-${name}.png`,Buffer.from(r.data,'base64'));};
await send('Runtime.enable');await view(1440,1040)
const mode=process.env.COMPLETION_UI_MODE||'correct-and-review';const account=JSON.parse(await fs.readFile('/tmp/gill-acceptance-model-cases.json','utf8')).find(c=>c.mode===mode)
const remote=await import(process.cwd()+'/web/frontend/tests/acceptance/harness.mjs')
const state=async()=>{const r=await remote.request('/api/v1/team-workspace',undefined,account.token);if(r.status!==200)throw Error('state read '+r.status);return r.body}
const command=(kind,payload)=>remote.request('/api/v1/team-workspace/commands',{kind,payload,requestKey:crypto.randomUUID()},account.token)
const set=(q,value)=>ev('(()=>{const e=document.querySelector('+JSON.stringify(q)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()')
const button=async text=>{await ev('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(text)+').click()');await sleep(120)}
const wait=async expression=>{for(let i=0;i<60;i++){if(await ev(expression))return;await sleep(100)}throw Error('UI condition timed out: '+expression)}
async function scenario(id,ac,body){
 let result
 try{await body();result={id,ac,status:'passed'}}
 catch(error){result={id,ac,status:'failed',error:error.message};process.exitCode=1}
 result.at=new Date().toISOString();await fs.appendFile('/tmp/gill-regression-browser-20261118.jsonl',JSON.stringify(result)+'\n');console.log(JSON.stringify(result));await sleep(1000)
}
function ensure(condition,message){if(!condition)throw Error(message)}
async function chooseMainTeam(){await wait('!!document.querySelector(".team-switch")');await ev('Array.from(document.querySelectorAll(".team-switch")).find(b=>b.textContent.includes("验收业务团队")).click()');await wait('document.querySelector(".team-chat-header h2")?.textContent.includes("验收业务团队")')}
await send('Page.navigate',{url:'http://127.0.0.1:18080/#/workbench'});await sleep(500)
await set('#login input',account.username);await set('#login input[type="password"]',account.password);await click('#login .btn');await wait('!!document.querySelector(".team-nav")')


await wait('!!document.querySelector(".team-chat-header h2")');
await check('correct team', 'document.querySelector(".team-chat-header h2").textContent.includes('+JSON.stringify(mode)+')');
if(mode==='correct-and-review'){
 await check('actual completion in right panel', 'document.querySelector(".team-status-panel").textContent.includes("3 项任务已完成")&&document.querySelector(".team-status-panel").textContent.includes("查看成果和未验证范围")');
 await check('real v2 artifact and review present', 'document.querySelector(".team-artifacts").textContent.includes("v2")&&document.querySelector(".team-artifacts").textContent.includes("90")&&Array.from(document.querySelectorAll(".current-version-checks")).some(e=>e.textContent.includes("本版 v2"))');
 await ev('document.querySelectorAll(".team-artifacts > details").forEach(d=>d.open=true);document.querySelector(".team-artifacts").scrollIntoView()');
 await shot('desktop-final-report');
}else{
 await check('open decision awaits user', '!!document.querySelector(".real-decision")&&document.querySelector(".team-nav").textContent.includes("@1")');
 await shot('desktop-waiting');
}
await view(390,844,true);await check('mobile fits viewport','document.documentElement.scrollWidth===390');await click('.team-mobile-toggle');await check('mobile status visible','document.querySelector(".team-status-panel").classList.contains("open")');await shot(mode==='correct-and-review'?'mobile-completed':'mobile-waiting');
if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({mode,status:'passed',checks,browserExceptions:errors}));
}finally{ws?.close();chrome.kill();await sleep(120);await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
