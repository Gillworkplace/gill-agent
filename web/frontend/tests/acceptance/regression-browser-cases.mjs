import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gill-v04-'));const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore'});let ws;const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
try{let port;for(let i=0;i<60;i++){try{port=(await fs.readFile(path.join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};const click=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).click()`);await sleep(90);};const fill=(id,v)=>ev(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(v)}`);const submit=async q=>{await ev(`document.querySelector(${JSON.stringify(q)}).requestSubmit()`);await sleep(100);};const go=async h=>{await ev(`location.hash=${JSON.stringify(h)}`);await sleep(130);};const check=async(label,e)=>{if(!await ev(e))throw Error(label+' '+JSON.stringify(errors));checks.push(label);};const view=(width,height,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});const shot=async name=>{await sleep(230);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`gui-test-screenshots/v20261118-regression-${name}.png`,Buffer.from(r.data,'base64'));};
await send('Runtime.enable');await view(1440,1040)
const account=JSON.parse(await fs.readFile('/tmp/gill-acceptance-browser.json','utf8'))
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

await scenario('C01-navigation-and-team-directory',['AC-18','AC-21','AC-25'],async()=>{
 await check('four navigation entries',`document.querySelectorAll('.team-nav nav a').length===4`)
 await go('#/teams');await check('no members on directory',`document.querySelectorAll('.team-directory-card').length===2&&!document.querySelector('.organization-node')`)
 await check('summary has actual project and headcount',`Array.from(document.querySelectorAll('.team-directory-card')).find(x=>x.textContent.includes('验收业务团队')).textContent.includes('3 位员工')&&document.body.textContent.includes('验收资料项目')`)
 await shot('teams')
})
await scenario('C02-tree-drag-select-save-and-mobile',['AC-30'],async()=>{
 await go('#/teams/'+account.teamId);await wait('document.querySelectorAll(".organization-node").length===3')
 const target=account.members[1],subject=account.members[0]
 await ev(`(()=>{const nodes=Array.from(document.querySelectorAll('.organization-node'));const a=nodes.find(n=>n.querySelector('button').textContent.includes('员工0')),b=nodes.find(n=>n.querySelector('button').textContent.includes('员工1')),transfer=new DataTransfer();a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));})()`)
 await sleep(80);await check('drag changes draft',`Array.from(document.querySelectorAll('.organization-node')).find(n=>n.querySelector('button').textContent.includes('员工0')).querySelector('select').value===${JSON.stringify(target)}`)
 ensure((await state()).employees[subject].parentId==='user','unsaved drag changed effective relation')
 await button('重新读取');await ev(`(()=>{const e=Array.from(document.querySelectorAll('.organization-node')).find(n=>n.querySelector('button').textContent.includes('员工0')).querySelector('select');e.value=${JSON.stringify(target)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
 await button('保存层级');ensure((await state()).employees[subject].parentId===target,'select/save did not persist same drag result');await shot('organization')
 await view(390,844,true);await check('mobile navigation reachable',`document.querySelector('.team-nav').getBoundingClientRect().left>=0&&document.documentElement.scrollWidth===390`)
 await ev(`(()=>{const e=Array.from(document.querySelectorAll('.organization-node')).find(n=>n.querySelector('button').textContent.includes('员工0')).querySelector('select');e.value='user';e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
 await button('保存层级');ensure((await state()).employees[subject].parentId==='user','mobile relation save failed');await shot('mobile-tree');await view(1440,1040)
})
await scenario('C03-per-employee-mount',['AC-26','AC-27'],async()=>{
 await ev(`Array.from(document.querySelectorAll('.organization-node button')).find(b=>b.textContent.includes('员工2')).click()`);await wait('!!document.querySelector(".employee-config")')
 await set('.employee-config select',account.sourceId);await button('挂载到此员工')
 ensure((await state()).employees[account.members[2]].knowledgeIds.includes(account.sourceId),'mount did not persist for selected employee')
 await button('卸载');const s=await state();ensure(!s.employees[account.members[2]].knowledgeIds.includes(account.sourceId)&&s.employees[account.members[0]].knowledgeIds.includes(account.sourceId),'unmount affected a different employee')
})
await scenario('C04-template-preview-and-Skills',['AC-01','AC-19','AC-20'],async()=>{
 await go('#/templates');await check('conversation and draft entry',`!!document.querySelector('#template-chat')&&!!document.querySelector('#template-prompt')`)
 await set('#template-name','GUI验收新模板');await set('#template-prompt','核对资料，缺少依据则向上级说明。');await button('＋ 添加 Skill');await set('.skill-editor input','来源核查');await set('.skill-editor textarea','保留资料出处与未验证范围。')
 await submit('.template-preview');await wait('document.querySelector(".template-list").textContent.includes("GUI验收新模板")')
 const created=Object.values((await state()).templates).find(t=>t.name==='GUI验收新模板');ensure(created?.skills[0]?.name==='来源核查','saved Skills not persisted');await shot('templates')
})
await scenario('C05-shared-knowledge-version',['AC-27','AC-29'],async()=>{
 await go('#/knowledge');await click('.knowledge-card');await set('.knowledge-layout form textarea','v2合成库存：期初100、入库20、出库30；新增来源说明。');await submit('.knowledge-layout form');await wait('document.querySelector(".knowledge-layout form").textContent.includes("v2")')
 const k=(await state()).knowledge[account.sourceId];ensure(k.revision===2&&k.versions.length===2,'knowledge version history missing');await shot('knowledge')
})
await scenario('C06-project-doc-CAS-preserves-input',['AC-16','AC-22'],async()=>{
 await go('#/teams/'+account.teamId);await button('项目库');await button('验收资料项目');await ev(`Array.from(document.querySelectorAll('.template-select')).find(b=>b.textContent.includes('需求说明')).click()`);await sleep(80)
 await set('.knowledge-layout form textarea','GUI未保存C版')
 const changed=await command('document.save',{projectId:account.projectId,id:Object.values((await state()).projects[account.projectId].documents)[0].id,expectedRevision:2,title:'需求说明',content:'并发保存D版'})
 ensure(changed.status===200,'concurrent test fixture write failed');await submit('.knowledge-layout form');await wait('!!document.querySelector(".team-error")')
 await check('stale input retained',`document.querySelector('.knowledge-layout form textarea').value==='GUI未保存C版'`)
 ensure(Object.values((await state()).projects[account.projectId].documents)[0].content==='并发保存D版','stale GUI silently overwrote concurrent document');await shot('document-conflict')
})
await scenario('C07-decision-view-is-not-consent',['AC-18','AC-31'],async()=>{
 await send('Page.reload',{ignoreCache:true});await sleep(600);await go('#/workbench');await wait('!!document.querySelector(".team-switch")')
 await ev(`Array.from(document.querySelectorAll('.team-switch')).find(b=>b.textContent.includes('验收业务团队')).click()`);await sleep(80);await click('.team-chat-toolbar button');await wait('!!document.querySelector(".real-decision")')
 await click('.real-decision details summary');const before=await state();ensure(before.decisions[account.decisionId].state==='open','viewing decision gave consent')
 const run=before.tasks[account.taskId].runId;ensure(before.runs[run].manualPaused===true,'viewing decision removed manual pause')
 await shot('decision');await set('.real-decision textarea','仍缺少依据，请继续补证，尚未作出决定。');await button('补充信息，仍未解决')
 const after=await state();ensure(after.decisions[account.decisionId].state==='open'&&after.runs[run].manualPaused,'unresolved reply resolved or resumed work')
 await view(390,844,true);await check('mobile main entries visible',`document.querySelector('.team-nav').getBoundingClientRect().left>=0&&document.documentElement.scrollWidth===390`);await click('.team-mobile-toggle');await check('mobile status on right',`Math.round(document.querySelector('.team-status-panel').getBoundingClientRect().right)===390`);await shot('mobile-decision')
})

await scenario('R-C09-notification-with-mentions-does-not-dispatch',['AC-34'],async()=>{
 await sleep(60000); // Respect the unchanged 60 requests/min/user limit before the next GUI group.
 await view(1440,1040);await send('Page.reload',{ignoreCache:true});await sleep(500);await go('#/workbench');await wait('!!document.querySelector("#message-requires-response")');await chooseMainTeam();
 const before=await state();await ev('document.getElementById("message-requires-response").click()');await set('#team-chat-input','收到本轮结果，仅通知员工，不再派发工作。');
 await ev('(()=>{const e=document.querySelector(".composer-routing select[multiple]");e.options[0].selected=true;e.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await submit('.team-composer');await wait('document.querySelector(".team-chat-feed").textContent.includes("收到本轮结果，仅通知员工")');
 const after=await state();ensure(Object.keys(after.tasks).length===Object.keys(before.tasks).length,'notification spawned a task');
 ensure(Object.values(after.deliveries).some(d=>d.state==='notified'),'directed notification not tracked');await shot('notification');
});
await scenario('R-C10-superseded-decision-is-not-applied',['AC-16','AC-31'],async()=>{
 await command('task.update',{taskId:account.taskId,state:'cancelled',reason:'原方案已取消'});await send('Page.reload',{ignoreCache:true});await sleep(600);await go('#/workbench');await chooseMainTeam();await wait('!!document.querySelector(".real-decision")');
 await check('cancelled decision shows invalid state','document.querySelector(".real-decision").textContent.includes("已失效，未应用")&&!document.querySelector(".real-decision").textContent.includes("已记录并应用决定")');
 ensure(!await ev('!!document.querySelector(".real-decision textarea")'),'stale decision still offers an approval form');await shot('superseded');
});
await scenario('R-C11-review-evidence-stays-on-the-correct-version',['AC-04','AC-32'],async()=>{
 await click('.team-artifacts>details>summary');await check('v1 approval is not current v2 approval','document.querySelector(".current-version-checks").textContent.includes("当前 v2 暂无核查记录")&&!document.querySelector(".current-version-checks").textContent.includes("通过")');
 await click('.team-artifacts>details>details>summary');await check('old review remains in version history','document.querySelector(".team-artifacts").textContent.includes("历史 v1")');await shot('review-versions');
});
await scenario('R-C12-invalid-superior-context-on-desktop-and-mobile',['AC-09','AC-31'],async()=>{
 const s=await state(),member=s.employees[account.members[0]],superior=s.employees[account.members[1]];
 await command('employee.update',{id:member.id,expectedRevision:member.revision,parentId:superior.id});
 const task=(await command('task.assign',{employeeId:member.id,goal:'上级配置异常回归'})).body.id;
 await command('employee.update',{id:superior.id,expectedRevision:superior.revision,lifecycle:'disabled'});
 const job=await remote.claim();ensure(job.payload.taskId===task,'queue not isolated');
 await remote.workerCommand(job,'issue.escalate',{problem:'缺少取舍依据',attempts:[],options:['补充资料']});await remote.operation(job,'finish',{state:'done',result:{}});
 await send('Page.reload',{ignoreCache:true});await sleep(600);await go('#/workbench');await chooseMainTeam();await wait('document.querySelector(".team-chat-feed")?.textContent.includes("上级配置异常")');
 await check('fault includes invalid supervisor id','document.querySelector(".team-chat-feed").textContent.includes('+JSON.stringify(superior.id)+')');await ev('Array.from(document.querySelectorAll(".real-message")).find(x=>x.textContent.includes("上级配置异常")).scrollIntoView({block:"start"})');await shot('superior-fault');
 await view(390,844,true);await check('mobile warning stays reachable','document.documentElement.scrollWidth===390&&document.querySelector(".team-chat-feed").textContent.includes("上级配置异常")');await ev('Array.from(document.querySelectorAll(".real-message")).find(x=>x.textContent.includes("上级配置异常")).scrollIntoView({block:"start"})');await shot('mobile-superior-fault');
});


await scenario('R-C13-follow-up-to-completed-work-creates-a-new-task',['AC-16','AC-34'],async()=>{
 const follow=await remote.fixture({members:1});await view(1440,1040);
 const task=(await follow.ok('task.assign',{employeeId:follow.members[0],goal:'引用回复回归'})).id;
 const job=await remote.claim();ensure(job.payload.taskId===task,'isolated follow-up fixture');
 await remote.workerCommand(job,'artifact.save',{title:'已完成结果',content:'合成结果，仅供引用回复回归',unchecked:'未核验业务'});await remote.workerCommand(job,'run.complete',{});await remote.operation(job,'finish',{state:'done',result:{}});
 await click('.team-nav footer button');await wait('!!document.querySelector("#login input")');
 await set('#login input',follow.username);await set('#login input[type="password"]',follow.password);await click('#login .btn');await wait('!!document.querySelector(".team-switch")');
 await wait('document.querySelector(".team-chat-feed")?.textContent.includes("任务已完成：引用回复回归")');
 const before=await follow.read();await ev('Array.from(document.querySelectorAll(".real-message")).find(x=>x.textContent.includes("任务已完成：引用回复回归")).querySelector(".text-button").click()');
 await set('#team-chat-input','请基于刚才已完成的结果继续补充下一项分析。');await submit('.team-composer');await wait('document.querySelector(".team-chat-feed")?.textContent.includes("请基于刚才已完成的结果继续")');
 const after=await follow.read(),child=Object.values(after.tasks).find(t=>t.parentTaskId===task);ensure(Object.keys(after.tasks).length===Object.keys(before.tasks).length+1&&child?.state==='queued','follow-up did not create queued work');ensure(after.tasks[task].state==='completed'&&after.runs[child.runId].state==='active','old completed task was reopened');await shot('completed-reply');
 const next=await remote.claim();ensure(next.payload.taskId===child.id,'follow-up work not executable');await remote.operation(next,'finish',{state:'stopped',result:{reason:'fixture teardown; no model invoked'}});
});
console.log(JSON.stringify({browserExceptions:errors}))

}finally{ws?.close();chrome.kill();await sleep(120);await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
