import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {account,check,origin} from './harness.mjs'

const profile=await fs.mkdtemp(path.join(os.tmpdir(),'gill-closure-chrome-'))
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'})
const waitMs=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(read,message,seconds=20){
 const deadline=Date.now()+seconds*1000
 while(Date.now()<deadline){
  const result=await read()
  if(result)return result
  await waitMs(500)
 }
 throw Error(message)
}

let socket
try{
 const port=await until(async()=>(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8').catch(()=>''))?.split('\n')[0],'Chrome did not start')
 const tab=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page')
 socket=new WebSocket(tab.webSocketDebuggerUrl)
 await new Promise(resolve=>socket.onopen=resolve)
 let sequence=0
 const pending=new Map(),exceptions=[]
 socket.onmessage=e=>{
  const message=JSON.parse(e.data)
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails)
  if(!message.id)return
  const callbacks=pending.get(message.id)
  pending.delete(message.id)
  if(message.error)callbacks.reject(Error(message.error.message))
  else callbacks.resolve(message.result)
 }
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence
  pending.set(id,{resolve,reject})
  socket.send(JSON.stringify({id,method,params}))
 })
 const evalJs=async expression=>{
  const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||expression)
  return result.result.value
 }
 const click=selector=>evalJs('document.querySelector('+JSON.stringify(selector)+').click()')
 const set=(selector,value)=>evalJs(`(() => {
  const field=document.querySelector(${JSON.stringify(selector)});
  field.value=${JSON.stringify(value)};
  for(const event of ['input','change'])field.dispatchEvent(new Event(event,{bubbles:true}));
 })()`)
 const submit=selector=>evalJs('document.querySelector('+JSON.stringify(selector)+').requestSubmit()')
 const ui=(expression,seconds)=>until(()=>evalJs(expression),expression,seconds)
 const shot=async name=>{
  const image=await cdp('Page.captureScreenshot',{format:'png'})
  await fs.writeFile('gui-test-screenshots/v20261118-full-closure-'+name+'.png',Buffer.from(image.data,'base64'))
 }
 const view=(width,height,mobile=false)=>cdp('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1})
 const switchTo=hash=>evalJs('location.hash='+JSON.stringify(hash))
 await cdp('Runtime.enable')
 await view(1440,1040)
 if(process.argv[2]){
  const fault=JSON.parse(await fs.readFile(process.argv[2],'utf8'))
  await cdp('Page.navigate',{url:origin+'/#/workbench'})
  await ui('location.origin==='+JSON.stringify(origin)+' && document.readyState==="complete"')
  await evalJs('localStorage.setItem("gill_token",'+JSON.stringify(fault.token)+')')
  await cdp('Page.reload')
  if(fault.sourceArtifact){
   await ui('!!document.querySelector(".team-artifacts")')
   await evalJs(`[...document.querySelectorAll(".team-artifacts > details")].forEach(e=>e.open=true)`)
   await ui(`[...document.querySelectorAll(".current-version-checks")].some(e=>e.textContent.includes("v${fault.sourceRevision}") && e.textContent.includes("模型意见"))`)
   await click('.team-chat-feed > details > summary')
   await evalJs(`[...document.querySelectorAll(".team-chat-feed details article")]
     .find(e=>e.querySelector("p")?.textContent.includes("合成对照验证"))
     .querySelector("button.text-button").click()`)
   await ui(`[...document.querySelectorAll(".team-chat-feed article pre")].some(e=>e.textContent.includes("failed") && e.textContent.includes("exitCode"))`)
   await shot('same-version-failed-tool')
   check(!exceptions.length,'Chrome raised an exception during evidence review')
   console.log(JSON.stringify({case:'AC05-32-real-model-and-tool-evidence',task:fault.evidenceTask,artifact:fault.sourceArtifact,passed:true}))
  }else{
  try{
   await ui('document.querySelector(".team-status-card dl dd:nth-of-type(2)")?.textContent.trim()==="结果待核实"')
  }catch(error){
   console.error(await evalJs('document.body?.innerText.slice(0,750)'))
   throw error
  }
  await ui('document.querySelector(".team-availability")?.textContent.includes("等待处理")')
  await click('.team-chat-feed > details > summary')
  await ui('[...document.querySelectorAll(".team-chat-feed button")].find(b=>b.textContent==="明确恢复")?.disabled')
  await ui('!![...document.querySelectorAll(".team-chat-feed form")].find(f=>f.textContent.includes("记录核实结论"))')
  await shot('cloud-unknown')
  await view(390,844,true)
  await click('.team-mobile-toggle')
  await ui('document.documentElement.scrollWidth===390 && document.querySelector(".team-status-panel")?.textContent.includes("结果待核实")')
  await shot('cloud-unknown-mobile')
  check(!exceptions.length,'Chrome raised an exception during the cloud fault')
  console.log(JSON.stringify({case:'AC07-33-browser-cloud-unknown',task:fault.taskId,passed:true}))
  }
 }else{
 const a=await account()
 const team=(await a.ok('team.create',{name:'浏览器两轮模板采用团队'})).id
 await cdp('Page.navigate',{url:origin+'/#/templates'})
 await ui('!!document.querySelector("#login input[type=password]")')
 await set('#login input',a.username)
 await set('#login input[type=password]',a.password)
 await click('#login .btn')
 await ui('!!document.querySelector("#template-chat")')
 await set('#template-chat','生成通用资料核查员工模板。工作指令区分事实与假设，包含名为“证据核查”的 Skill，要求标注出处和局限。')
 await submit('.template-conversation form')
 await ui('document.querySelectorAll(".template-messages article").length===2 && !!document.querySelector("#template-name")?.value',360)
 const first=await a.read()
 const draft=Object.values(first.drafts)[0]
 check(!Object.keys(first.templates).length&&draft.skills.some(x=>x.name==='证据核查'),'first real draft saved or missing requested skill')
 await set('#template-chat','保留证据核查，补充一项名为“冲突上报”的 Skill，指出冲突的两项来源和需要决定的问题。')
 await submit('.template-conversation form')
 await ui('document.querySelectorAll(".template-messages article").length===4 && [...document.querySelectorAll(".skill-editor input")].some(e=>e.value==="冲突上报")',360)
 const second=await a.read()
 check(!Object.keys(second.templates).length&&second.drafts[draft.id].messages.length===4,'second draft lost source or was implicitly saved')
 await shot('two-turns')
 await submit('.template-preview')
 await ui('document.querySelectorAll(".template-list > button").length===1')
 const saved=Object.values((await a.read()).templates)[0]
 check(saved.draftId===draft.id&&saved.skills.some(s=>s.name==='证据核查')&&saved.skills.some(s=>s.name==='冲突上报'),'saved template lost source or skills')
 await switchTo('#/teams/'+team)
 await view(390,844,true)
 await ui('!!document.querySelector(".team-inline-form select")')
 await set('.team-inline-form select',saved.id)
 await set('.team-inline-form input','浏览器采用员工')
 await submit('.team-inline-form')
 await ui('document.querySelector(".organization-node")?.textContent.includes("浏览器采用员工")')
 const adopted=Object.values((await a.read()).employees)[0]
 check(adopted.teamId===team&&adopted.templateId===saved.id&&adopted.templateRevision===saved.revision,'mobile adoption did not persist exact template snapshot')
 await ui('document.documentElement.scrollWidth===390')
 await shot('mobile-adoption')
 check(!exceptions.length,'Chrome raised an exception')
 console.log(JSON.stringify({case:'AC01-real-browser-template-to-adoption',draft:draft.id,template:saved.id,employee:adopted.id,passed:true}))
 }
}finally{
 socket?.close()
 chrome.kill()
 await waitMs(150)
 await fs.rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100})
}
