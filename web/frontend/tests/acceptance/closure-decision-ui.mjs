import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gill-v04-'));const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});let ws;const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
try{let port;for(let i=0;i<60;i++){try{port=(await fs.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};const click=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).click()`);await sleep(90);};const fill=(id,v)=>ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(v)}`);const submit=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).requestSubmit()`);await sleep(100);};const go=async h=>{await ev(`location.hash=${JSON.stringify(h)}`);await sleep(130);};const check=async(label,e)=>{if(!await ev(e))throw Error(label+' '+JSON.stringify(errors));checks.push(label);};const view=(width,height,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});const shot=async name=>{await sleep(230);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`gui-test-screenshots/${process.env.ACCEPTANCE_SCREENSHOT_PREFIX||"v20261118-completion"}-${name}.png`,Buffer.from(r.data,'base64'));};
await send('Runtime.enable');await view(1440,1040)
const account=JSON.parse(await fs.readFile('/tmp/gill-closure-decision-ui.json','utf8'))
const remote=await import(process.cwd()+'/web/frontend/tests/acceptance/harness.mjs')
const state=async()=>{const r=await remote.request('/api/v1/team-workspace',undefined,account.token);if(r.status!==200)throw Error('state read '+r.status);return r.body}
const command=(kind,payload)=>remote.request('/api/v1/team-workspace/commands',{kind,payload,requestKey:crypto.randomUUID()},account.token)
const set=(q,value)=>ev('(()=>{const e=document.querySelector('+JSON.stringify(q)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()')
const button=async text=>{await ev('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==='+JSON.stringify(text)+').click()');await sleep(120)}
const wait=async expression=>{for(let i=0;i<60;i++){if(await ev(expression))return;await sleep(100)}throw Error('UI condition timed out: '+expression)}
await send('Page.navigate',{url:'http://127.0.0.1:18080/#/workbench'});await sleep(500)
await set('#login input',account.username);await set('#login input[type="password"]',account.password);await click('#login .btn');await wait('!!document.querySelector(".team-nav")')




await wait('!!document.querySelector(".team-chat-header h2")');
await click('.team-chat-feed > details > summary');
await ev('Array.from(document.querySelectorAll(".task-sources")).forEach(e=>e.open=true)');
await check('fixed snapshot and actual v1 read are separate from current v2','Array.from(document.querySelectorAll(".task-sources")).some(e=>["团队流程","采用模板","采用的 Skills","执行器读取 v1","共享源当前 v2"].every(x=>e.innerText.includes(x)))');
await shot('task-configuration-sources');await click('.team-chat-feed > details > summary');
await click('.chat-header-actions [aria-pressed]');await wait('!!document.querySelector(".decision-context")');await click('.decision-context summary');
await check('decision details include scope and both real prior opinions','(()=>{const t=document.querySelector(".decision-context").innerText;return ["选择本期资料采用范围","已核对两份合成资料","采用 A","没有单独记录","直属上级认为缺少有效依据","上一级认为需要用户明确选择"].every(x=>t.includes(x))})()');
if((await state()).decisions[account.decisionId].state!=='open')throw Error('Viewing details resolved the decision');
await shot('decision-context-desktop');await view(390,844,true);
await check('mobile decision context fits without horizontal scrolling','document.documentElement.scrollWidth===390');
await shot('decision-context-mobile');await click('.team-mobile-toggle');
const readText='document.querySelector(".team-status-card small:nth-last-child(2)")?.textContent';const lastRead=await ev(readText);
await send('Network.enable');await send('Network.setBlockedURLs',{urls:['*://127.0.0.1:18080/api/v1/team-workspace']});await button('刷新');
await wait('document.querySelector(".team-status-card").innerText.includes("状态已过期")');
await check('failed refresh does not render idle or advance observation time', '!document.querySelector(".team-availability").innerText.includes("空闲")&&'+readText+'==='+JSON.stringify(lastRead));
await shot('stale-status-mobile');await send('Network.setBlockedURLs',{urls:[]});await button('刷新');
await wait('!document.querySelector(".team-status-card").innerText.includes("状态已过期")');await check('successful refresh restores observed summary','document.querySelector(".team-status-card dd")?.innerText.includes("选择本期资料采用范围")');
if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify({status:'passed',checks,browserExceptions:errors}));
}finally{ws?.close();chrome.kill();await sleep(120);await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
