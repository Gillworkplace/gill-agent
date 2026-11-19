import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {account,check,origin,request} from './harness.mjs'

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
  const pending=new Map(),exceptions=[],nativePrompts=[]
 socket.onmessage=e=>{
  const message=JSON.parse(e.data)
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails)
  if(message.method==='Page.javascriptDialogOpening')nativePrompts.push(message.params)
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
 const shot=async (name,date='20261118')=>{
  const image=await cdp('Page.captureScreenshot',{format:'png'})
  await fs.writeFile('gui-test-screenshots/v'+date+'-full-closure-'+name+'.png',Buffer.from(image.data,'base64'))
 }
 const view=(width,height,mobile=false)=>cdp('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1})
 const switchTo=hash=>evalJs('location.hash='+JSON.stringify(hash))
 await cdp('Runtime.enable')
 await view(1440,1040)
 if(process.argv[2]==='--workspace-entry'){
  const a=await account()
  await cdp('Page.navigate',{url:origin+'/#/workbench'})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('!!document.querySelector(".workbench-welcome .team-empty-state")&&!document.querySelector(".team-status-panel")',7)
  await shot('workbench-empty-desktop')
  const openCreate=async selector=>{
   await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus()`)
   await click(selector)
   await ui('document.querySelector(".team-create-dialog")?.open')
   const centered=await evalJs(`(()=>{const {left,top,right,bottom}=document.querySelector('.team-create-dialog').getBoundingClientRect();return left>0&&top>0&&Math.abs(left+right-innerWidth)<=1&&Math.abs(top+bottom-innerHeight)<=1})()`)
   check(centered,'team creation dialog is not centered in the viewport')
   check(await evalJs('document.activeElement.id==="create-team-name"&&document.querySelector(".team-create-dialog [type=submit]").disabled&&!document.querySelector(".team-create-dialog details").open'),'creation does not focus the name or requires optional fields')
  }
  await openCreate('.workbench-welcome .team-entry-primary')
  check(await evalJs('location.hash==="#/workbench"'),'creation left the workbench')
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await ui('!document.querySelector(".team-create-dialog").open&&document.activeElement.classList.contains("team-entry-primary")')
  check(!Object.keys((await a.read()).teams).length,'cancelled form created a team')
  await view(390,844,true)
  await ui('document.documentElement.scrollWidth===390')
  await shot('workbench-empty-mobile')
  await switchTo('#/teams')
  await ui('document.querySelectorAll(".team-directory .team-entry-primary").length===1')
  await openCreate('.team-directory .team-entry-primary')
  await shot('team-create-mobile')
  await view(1440,1040)
  await shot('team-create-desktop')
  await set('#create-team-name','交付示例团队')
  await set('#create-team-description','负责交付示例项目')
  await click('.team-create-dialog summary')
  await set('#create-team-prompt','按分工复核交付结果。')
  await click('.team-create-dialog summary')
  await submit('.team-create')
  await ui('!document.querySelector(".team-create-dialog").open&&document.querySelector(".team-page-head h1")?.textContent==="交付示例团队"')
  const saved=Object.values((await a.read()).teams)[0]
  check(saved.name==='交付示例团队'&&saved.description==='负责交付示例项目'&&saved.prompt==='按分工复核交付结果。','team creation did not persist all fields')
  await switchTo('#/teams')
  await ui('document.querySelector(".team-directory-card")?.textContent.includes("交付示例团队")')
  await switchTo('#/workbench')
  await ui('!!document.querySelector(".team-chat")&&document.querySelector(".team-status-panel")?.textContent.includes("交付示例团队")')
  check(!exceptions.length,'browser error in the team entry flow',exceptions)
  console.log(JSON.stringify({case:'workspace-entry',passed:true,createdTeam:saved.id}))
 }else if(process.argv[2]==='--catalog-layout'){
  const compareCards=async selector=>evalJs(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),card=>{const {x,y,width,height}=card.getBoundingClientRect();return [x,y,width,height]})`)
  const matches=(actual,reference)=>actual.length===reference.length&&actual.every((row,index)=>row.every((value,column)=>Math.abs(value-reference[index][column])<=1))
  await view(1440,960)
  const prototype=pathToFileURL(path.resolve('docs/features/digital-employee-team/prototype/template-library/index.html')).href
  await cdp('Page.navigate',{url:prototype})
  await ui('document.querySelectorAll("#library .card").length===4')
  const approvedDesktop=await compareCards('#library .card')
  await view(390,844,true)
  const approvedMobile=await compareCards('#library .card')
  const a=await account()
  const examples=[
   ['系统设计师','梳理系统边界与约束，输出可评审的技术方案。',['系统设计'],8],
   ['交互设计马仔','把需求做成可点击的原型，明确页面结构与操作路径。',['交互原型'],6],
   ['开发马仔','负责前端页面与后端接口，按已确认的方案完成联调。',['前端开发','Python 后端'],20],
   ['产品马仔','澄清需求，整理产品方案和验收标准。',['需求分析'],4]
  ]
  for(const [name,prompt,names,count] of examples){
   const publicFiles=count===8||count===20?['AGENTS.md','references/hand-off.md']:['AGENTS.md']
   const perSkill=(count-publicFiles.length)/names.length
   const paths=names.flatMap(skill=>[`skills/${skill}/SKILL.md`,`skills/${skill}/references/guide.md`,
    ...Array.from({length:perSkill-2},(_,index)=>`skills/${skill}/references/example-${index+1}.md`)])
   paths.push(...publicFiles)
   const upload=await request('/api/v1/team-workspace/template-files',{files:paths.map(path=>({path,data:Buffer.from(path).toString('base64')}))},a.token)
   check(upload.status===200,'catalog fixture upload rejected',{status:upload.status})
   await a.ok('template.save',{name,prompt,files:upload.body.files.map(file=>({...file,purpose:file.path.endsWith('/SKILL.md')?'skill':'resource'}))})
  }
  await view(1440,960)
  await cdp('Page.navigate',{url:origin+'/#/templates'})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('document.querySelectorAll(".catalog-card").length===4')
  const checkCenteredDialog=async title=>{
   await ui(`document.querySelector('.catalog-form-dialog').open&&document.querySelector('#catalog-editor-title').textContent===${JSON.stringify(title)}`)
   const bounds=await evalJs(`(()=>{const {left,top,right,bottom}=document.querySelector('.catalog-form-dialog').getBoundingClientRect();return {left,top,right,bottom,width:innerWidth,height:innerHeight}})()`)
   check(bounds.left>=14&&bounds.top>=14&&Math.abs(bounds.left+bounds.right-bounds.width)<=1&&Math.abs(bounds.top+bounds.bottom-bounds.height)<=1,
    title+' dialog is not centered in the viewport',bounds)
  }
  const closeForm=async()=>{
   await click('.catalog-form-dialog .catalog-close')
   await ui('!document.querySelector(".catalog-form-dialog").open')
  }
  await click('.catalog-head .catalog-button:first-child')
  await checkCenteredDialog('导入文件夹')
  await shot('catalog-import-dialog-desktop')
  await closeForm()
  await click('.catalog-head .catalog-primary')
  await checkCenteredDialog('新建模板')
  await closeForm()
  const measure=await compareCards('.catalog-card')
  check(matches(measure,approvedDesktop),'desktop cards deviate from the approved prototype',{measure,approvedDesktop})
  await shot('catalog-desktop')
  await set('.catalog-search input','PYTHON')
  await ui('document.querySelectorAll(".catalog-card").length===1&&document.querySelector(".catalog-card").textContent.includes("开发马仔")')
  await set('.catalog-search input','')
  const developmentCard=`[...document.querySelectorAll('.catalog-card')].find(card=>card.textContent.includes('开发马仔'))`
  await evalJs(developmentCard+'.focus()')
  await evalJs(developmentCard+'.click()')
  await ui('document.querySelector(".catalog-drawer").open&&document.querySelectorAll(".catalog-drawer .catalog-skill").length===2')
  check(await evalJs('document.querySelector(".catalog-drawer").getBoundingClientRect().right===innerWidth'),'catalog drawer is detached from the right edge')
  await click('.catalog-skill summary')
  await ui('document.querySelector(".catalog-skill[open]").textContent.includes("references/guide.md")')
  await shot('catalog-detail')
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await ui('!document.querySelector(".catalog-drawer").open&&document.activeElement.classList.contains("catalog-card")')
  await evalJs(developmentCard+'.click()')
  await ui('document.querySelector(".catalog-drawer").open')
  await click('.catalog-drawer .catalog-primary')
  await checkCenteredDialog('编辑模板')
  await closeForm()
  await set('.catalog-search input','无匹配的样例')
  await ui('!!document.querySelector(".catalog-empty")')
  await click('.catalog-empty button')
  await view(390,844,true)
  await ui('document.documentElement.scrollWidth===390&&getComputedStyle(document.querySelector(".catalog-grid")).gridTemplateColumns==="358px"')
  await evalJs('document.activeElement.blur()')
  const mobileMeasure=await compareCards('.catalog-card')
  check(matches(mobileMeasure,approvedMobile),'mobile cards deviate from the approved prototype',{mobileMeasure,approvedMobile})
  await shot('catalog-mobile')
  await click('.catalog-head .catalog-button:first-child')
  await checkCenteredDialog('导入文件夹')
  await shot('catalog-import-dialog-mobile')
  await closeForm()
  await click('.catalog-head .catalog-primary')
  await checkCenteredDialog('新建模板')
  await closeForm()
  await set('.catalog-search input','开发马仔')
  await click('.catalog-card')
  await ui('document.querySelector(".catalog-drawer").open')
  await click('.catalog-drawer .catalog-primary')
  await ui('document.querySelector(".catalog-form-dialog").open&&document.querySelector("#template-name").value==="开发马仔"')
  await checkCenteredDialog('编辑模板')
  await view(390,500,true)
  await checkCenteredDialog('编辑模板')
  check(await evalJs('document.querySelector(".catalog-form-dialog").scrollHeight>document.querySelector(".catalog-form-dialog").clientHeight'),'long editor cannot scroll on a short viewport')
  await evalJs('document.querySelector(".catalog-form-bottom .catalog-primary").focus()')
  check(await evalJs(`(()=>{const dialog=document.querySelector('.catalog-form-dialog');const save=dialog.querySelector('.catalog-form-bottom .catalog-primary');return dialog.scrollTop>0&&save.getBoundingClientRect().bottom<=dialog.getBoundingClientRect().bottom})()`),
   'save action is out of reach on a short viewport')
  await set('#template-name','开发与联调')
  await submit('.template-preview')
  await ui('!document.querySelector(".catalog-form-dialog").open&&document.querySelectorAll(".catalog-card").length===4')
  const saved=Object.values((await a.read()).templates).find(t=>t.name==='开发与联调')
  check(saved?.revision===2&&saved.files.length===20,'catalog editor lost files or failed to save a revision')
  check(!exceptions.length,'browser error when using template catalog',exceptions)
  console.log(JSON.stringify({case:'catalog-layout',passed:true,measure,approvedDesktop,mobileMeasure,approvedMobile,templates:4}))
 }else if(process.argv[2]==='--multiple-skills'){
  const a=await account()
  const writeSkill=async (root,name,marker)=>{
   const folder=path.join(root,name)
   await fs.mkdir(path.join(folder,'references'),{recursive:true})
   await fs.writeFile(path.join(folder,'SKILL.md'),`# ${name}\nRead references/guide.md when using this Skill.`)
   await fs.writeFile(path.join(folder,'references','guide.md'),marker)
   return folder
  }
  const first=await writeSkill(profile,'frontend-engineer','FRONTEND_GUIDE')
  const second=await writeSkill(profile,'test-engineer','TEST_GUIDE')
  const bundle=path.join(profile,'team-template')
  await writeSkill(path.join(bundle,'skills'),'product-manager','PRODUCT_GUIDE')
  await writeSkill(path.join(bundle,'skills'),'system-designer','SYSTEM_GUIDE')
  await fs.writeFile(path.join(bundle,'AGENTS.md'),'Shared template instructions.')
  await cdp('Page.navigate',{url:origin+'/#/templates'})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('!!document.querySelector(".template-start")')
  await click('.template-start-actions button:nth-child(2)')
  await ui('document.querySelector(".catalog-form-dialog").open&&!!document.querySelector(".catalog-import-select")')
  await cdp('DOM.enable')
  const importFolder=async(folder,count)=>{
   const dom=await cdp('DOM.getDocument')
   const input=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[webkitdirectory]'})
   await cdp('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[folder]})
   await ui(`document.querySelectorAll('.template-skill-package').length===${count}`)
  }
  await importFolder(first,1)
  check(await evalJs('document.querySelector("#template-name").value===""'),'first Skill named the template')
  await importFolder(second,2)
  await importFolder(bundle,4)
  await set('#template-name','软件交付团队模板')
  await click('.template-skill-package summary')
  await ui('document.querySelector(".template-skill-package[open]").textContent.includes("references/guide.md")')
  await shot('multiple-skills')
  await view(390,844,true)
  await ui('document.documentElement.scrollWidth===390')
  await shot('multiple-skills-mobile')
  await evalJs(`[...document.querySelectorAll('.template-skill-package summary')].find(summary=>summary.textContent.includes('test-engineer')).click()`)
  await click('[aria-label="移除 Skill test-engineer"]')
  await ui(`document.querySelectorAll('.template-skill-package').length===3&&document.querySelectorAll('.template-file-list li').length===7`)
  await importFolder(second,4)
  await submit('.template-preview')
  await ui('!document.querySelector(".catalog-form-dialog").open&&!!document.querySelector(".catalog-card")')
  const saved=Object.values((await a.read()).templates)[0]
  const names=['frontend-engineer','test-engineer','product-manager','system-designer']
  check(saved.files.length===9&&saved.files.some(f=>f.path==='AGENTS.md'&&f.purpose==='prompt')&&names.every(name=>
   saved.files.some(f=>f.path===`skills/${name}/SKILL.md`&&f.purpose==='skill')&&
   saved.files.some(f=>f.path===`skills/${name}/references/guide.md`&&f.purpose==='resource')),
   'Skill folders or their same-named references were overwritten',saved.files.map(f=>f.path))
  check(new Set(saved.files.filter(f=>f.path.endsWith('guide.md')).map(f=>f.key)).size===4,'Skill references did not keep their original content')
  const team=(await a.ok('team.create',{name:'四项 Skill 验收团队'})).id
  const employee=await a.ok('employee.create',{teamId:team,templateId:saved.id,name:'多 Skill 员工'})
  check((await a.read()).employees[employee.id].files.length===9,'employee did not adopt all Skill files')
  if(process.env.MULTIPLE_SKILLS_RUNTIME_FIXTURE){
   const task=await a.ok('task.assign',{employeeId:employee.id,goal:
    '逐一用 read_template_file 读取四项 Skill 各自 references/guide.md。报告逐项写出 Skill 名及文件的实际标记，注明未验证范围，然后完成任务。'})
   await fs.writeFile(process.env.MULTIPLE_SKILLS_RUNTIME_FIXTURE,JSON.stringify({token:a.token,taskId:task.id}),{mode:0o600})
  }
  check(!exceptions.length,'Chrome raised an exception during Skill imports')
  console.log(JSON.stringify({case:'multiple-skills',passed:true,skills:names.length,files:saved.files.length}))
 }else if(process.argv[2]==='--team-skill-configuration'){
  const a=await account()
  const team=(await a.ok('team.create',{name:'团队配置验收',prompt:'团队流程验收'})).id
  const template=(await a.ok('template.save',{name:'岗位模板',prompt:'既有岗位指令'})).id
  const first=(await a.ok('employee.create',{teamId:team,templateId:template,name:'成员 A'})).id
  const second=(await a.ok('employee.create',{teamId:team,templateId:template,name:'成员 B'})).id
  await cdp('Page.navigate',{url:origin+'/#/teams/'+team})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('document.querySelectorAll(".team-tabs button").length===3')
  await click('.team-tabs button:nth-child(3)')
  await ui('document.querySelectorAll(".skill-preview [data-skill-layer]").length===3')
  await shot('team-skill-flow','20261119')
  await click('.skill-layout [aria-label="团队流程"] header button')
  check(await evalJs('document.querySelector(".team-skill-dialog").open&&!document.querySelector(".team-skill-dialog select")'),'flow editor required a member')
  await set('#team-skill-prompt','取消的流程')
  await click('.team-skill-dialog footer button[type=button]')
  check(!(await a.read()).teams[team].prompt.includes('取消的流程'),'cancel changed the saved flow')
  await click('[data-skill-tab=roles]')
  await click('.skill-layout [aria-label="团队角色"] header button')
  await set('.team-skill-dialog input[maxlength]','复核')
  await set('#team-skill-prompt','角色共用规则 v1')
  const folder=path.join(profile,'角色指令')
  await fs.mkdir(path.join(folder,'review'),{recursive:true})
  await fs.writeFile(path.join(folder,'review','SKILL.md'),'验收角色目录')
  const dom=await cdp('DOM.getDocument')
  const picker=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'.team-skill-dialog input[webkitdirectory]'})
  await cdp('DOM.setFileInputFiles',{nodeId:picker.nodeId,files:[folder]})
  await ui('document.querySelector(".team-skill-dialog").textContent.includes("SKILL.md")')
  await submit('.team-skill-dialog form')
  await ui('!document.querySelector(".team-skill-dialog") && !!document.querySelector(".skill-selection")')
  const role=Object.values((await a.read()).teamRoles)[0]
  check(role.promptFiles[0].purpose==='skill','role directory was not saved')
  await click('[data-skill-tab=members]')
  for(const id of [first,second]){
   await set('#skill-preview-member',id)
   await click('.skill-selection header button')
   await set('.team-skill-dialog select',role.id)
   await submit('.team-skill-dialog form')
   await ui('!document.querySelector(".team-skill-dialog")')
  }
  await set('#skill-preview-member',first)
  const task=(await a.ok('task.assign',{employeeId:first,goal:'配置快照验收'})).id
  await click('[data-skill-tab=roles]')
  await ui('document.querySelectorAll(".skill-adoption button").length===2')
  await click('.skill-selection header button')
  await set('#team-skill-prompt','角色共用规则 v2')
  await submit('.team-skill-dialog form')
  await ui('document.querySelector("[data-skill-layer=roles]")?.textContent.includes("角色共用规则 v2")')
  await click('.skill-segment button:nth-child(2)')
  await ui('document.querySelector("[data-skill-layer=roles]")?.textContent.includes("角色共用规则 v1")')
  check((await a.read()).tasks[task].roleSnapshot.prompt==='角色共用规则 v1','running snapshot was rewritten')
  await click('.skill-segment button:first-child')
  await set('#skill-preview-member',second)
  await ui('document.querySelector("[data-skill-layer=roles]")?.textContent.includes("角色共用规则 v2")')
  await shot('team-skill-roles','20261119')
  await view(390,844,true)
  await click('[data-skill-tab=members]')
  await ui('document.documentElement.scrollWidth===390 && !!document.querySelector(".skill-selection")')
  await evalJs('document.querySelector(".skill-tabs").scrollIntoView({block:"start"})')
  await shot('team-skill-mobile','20261119')
  await click('.skill-selection header button')
  await ui('document.querySelector(".team-skill-dialog").open && document.querySelector(".team-skill-dialog").scrollWidth<=document.querySelector(".team-skill-dialog").clientWidth')
  await set('#team-skill-prompt','成员 B 的独立说明')
  await submit('.team-skill-dialog form')
  await ui('!document.querySelector(".team-skill-dialog")')
  const saved=await a.read()
  check(saved.employees[second].prompt==='成员 B 的独立说明'&&saved.employees[first].prompt==='既有岗位指令','personal edit leaked between members')
  check(!exceptions.length,'Chrome raised an exception during the three-layer configuration')
  console.log(JSON.stringify({case:'team-skill-configuration',passed:true,roleFiles:true,adopters:2,snapshot:true,mobile:true}))
 }else if(process.argv[2]==='--prompt-folders'){
  const a=await account()
  const createFolder=async(name,files)=>{
   const folder=path.join(profile,name)
   for(const [relative,content] of Object.entries(files)){
    const dest=path.join(folder,relative)
    await fs.mkdir(path.dirname(dest),{recursive:true})
    await fs.writeFile(dest,content)
   }
   return folder
  }
  const teamFolder=await createFolder('team-rules',{'workflow.md':'团队流程证据','references/approval.txt':'原始参考'})
  const employeeFolder=await createFolder('employee-rules',{'workflow.md':'员工执行证据'})
  const legacyFolder=await createFolder('personal-rules',{'instructions.md':'个人指令证据'})
  await cdp('DOM.enable')
  async function chooseFolder(selector,folder){
   const dom=await cdp('DOM.getDocument')
   const input=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector})
   check(input.nodeId,'folder picker missing',{selector})
   await cdp('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[folder]})
  }
  await cdp('Page.navigate',{url:origin+'/#/workbench'})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('!!document.querySelector(".workbench-welcome .team-entry-primary")')
  await click('.workbench-welcome .team-entry-primary')
  await ui('document.querySelector(".team-create-dialog").open')
  await set('#create-team-name','目录导入验收团队')
  await click('.team-create-rules > summary')
  await chooseFolder('.team-create-rules input[webkitdirectory]',teamFolder)
  await ui('document.querySelectorAll(".team-create-rules .template-file-list li").length===2')
  await submit('.team-create-dialog form')
  await ui('!!document.querySelector(".team-tabs")')
  const team=Object.values((await a.read()).teams)[0]
  check(team.promptFiles.length===2&&team.promptFiles.some(f=>f.path==='workflow.md'&&f.purpose==='prompt'),'team create did not save the imported flow directory')
  await evalJs('[...document.querySelectorAll(".team-tabs button")].find(b=>b.textContent==="团队配置").click()')
  await ui('!!document.querySelector(".team-skill-config")')
  await click('.skill-layout [aria-label="团队流程"] header button')
  await set('#team-skill-prompt','保留手写的团队指令')
  await chooseFolder('.team-skill-dialog input[webkitdirectory]',employeeFolder)
  await ui('document.querySelector(".team-skill-dialog .prompt-package-field details").open')
  await shot('prompt-flow-desktop','20261119')
  await view(390,844,true)
  await ui('document.documentElement.scrollWidth===390 && document.querySelector(".team-skill-dialog .prompt-folder-button").getBoundingClientRect().right<=390')
  await evalJs('document.querySelector("#team-skill-prompt").scrollIntoView({block:"center"})')
  await shot('prompt-flow-mobile','20261119')
  await click('.team-skill-dialog button[aria-label="移除 references/approval.txt"]')
  await submit('.team-skill-dialog form')
  const saved=await until(async()=>{
   const current=(await a.read()).teams[team.id]
   return current.revision>team.revision&&current
  },'updated folder was not saved')
  check(saved.prompt==='保留手写的团队指令'&&saved.promptFiles.length===1,'text plus directory and removal were lost')
  const template=(await a.ok('template.save',{name:'工作模板',prompt:'遵循指令'})).id
  const employee=(await a.ok('employee.create',{teamId:team.id,templateId:template,name:'目录验收员工'})).id
  await click('.team-tabs button:first-child')
  await ui('!!document.querySelector(".organization-node .text-button")')
  await click('.organization-node .text-button')
  await set('#employee-work-prompt','员工补充说明')
  await chooseFolder('.employee-config input[webkitdirectory]',teamFolder)
  await ui('document.querySelectorAll(".employee-config .template-file-list li").length===2')
  await submit('.employee-config form')
  await ui('!document.querySelector(".employee-config")')
  const updated=(await a.read()).employees[employee]
  check(updated.prompt==='员工补充说明'&&updated.promptFiles.length===2,'employee directory not saved with text')
  const other=await account()
  const forbidden=await other.command('team.create',{name:'外部目录',promptFiles:updated.promptFiles})
  check(forbidden.status===403,'foreign workspace could save private Prompt objects')
  const old=(await a.ok('task.assign',{employeeId:employee,goal:'验收配置快照'})).id
  await a.ok('employee.update',{id:employee,expectedRevision:updated.revision,promptFiles:[]})
  const next=(await a.ok('task.assign',{employeeId:employee,goal:'验收下一版配置'})).id
  const snapshot=await a.read()
  check(snapshot.tasks[old].employeeSnapshot.promptFiles.length===2&&snapshot.tasks[old].teamSnapshot.promptFiles.length===1
      &&snapshot.tasks[next].employeeSnapshot.promptFiles.length===0,'updating files changed an existing task or failed to affect a new one')
  await switchTo('#/legacy')
  await view(1440,1040)
  await ui('!!document.querySelector("aside .tools")')
  await evalJs('[...document.querySelectorAll("aside .tools button")].find(b=>b.textContent.includes("指令")).click()')
  await ui('document.querySelector(".prompt-dialog")?.open')
  await chooseFolder('.prompt-dialog input[webkitdirectory]',legacyFolder)
  await ui('document.querySelector("#prompt-dialog-text").value.includes("personal-rules/instructions.md")')
  await submit('.prompt-dialog form')
  await ui('!document.querySelector(".prompt-dialog")')
  const me=(await request('/api/v1/auth/me',undefined,a.token)).body
  check(me.custom_instructions.includes('个人指令证据'),'legacy instruction was not saved')
  await cdp('Page.enable')
  await evalJs('[...document.querySelectorAll("aside .tools button")].find(b=>b.textContent.includes("扩展")).click()')
  await ui('!!document.querySelector("#ex .bar button.new")')
  const opening=click('#ex .bar button.new')
  for(const value of ['4','prompt-folder-skill','验证技能正文']){
   await until(()=>nativePrompts.shift(),'extension dialog did not open')
   await cdp('Page.handleJavaScriptDialog',{accept:true,promptText:value})
  }
  await opening
  await ui('document.querySelector(".prompt-dialog")?.open')
  await chooseFolder('.prompt-dialog input[webkitdirectory]',legacyFolder)
  await ui('document.querySelector("#prompt-dialog-text").value.includes("个人指令证据")')
  await submit('.prompt-dialog form')
  await ui('document.querySelector("#exList").textContent.includes("prompt-folder-skill")')
  check(!exceptions.length,'Chrome raised an exception during Prompt folder import')
  console.log(JSON.stringify({case:'prompt-folders',passed:true,teamCreate:true,teamUpdate:true,employee:true,legacy:true,legacySkill:true,versions:true,mobile:true}))
 }else if(process.argv[2]==='--template-folder'){
  const a=await account()
  const team=(await a.ok('team.create',{name:'文件夹模板验收团队'})).id
  const source=path.join(profile,'资料核查模板')
  const samples={'AGENTS.md':'回复任务时注明主指令标记 QUARTZ_A。',
   'prompts/quality.md':'报告里注明第二指令标记 MOSS_B。',
   'skills/review/SKILL.md':'核查项目条件时注明标记 REVIEW_C。',
   'references/sample.csv':'status,approved\nmarker,PAPER_D\n','assets/fixture.bin':Buffer.from([0,255,0,42])}
  for(const [name,data] of Object.entries(samples)){
   const dest=path.join(source,name)
   await fs.mkdir(path.dirname(dest),{recursive:true})
   await fs.writeFile(dest,data)
  }
  await cdp('Page.navigate',{url:origin+'/#/templates'})
  await ui('!!document.querySelector("#login input[type=password]")')
  await set('#login input',a.username);await set('#login input[type=password]',a.password);await click('#login .btn')
  await ui('!!document.querySelector(".template-start")&&!document.querySelector(".template-preview")&&!document.querySelector(".template-conversation")')
  await shot('template-empty-desktop')
  await view(390,844,true)
  await ui('document.documentElement.scrollWidth===390 && [...document.querySelectorAll(".template-start button")].some(b=>b.textContent==="导入文件夹")')
  await shot('template-empty-mobile')
  await view(1440,1040)
  await cdp('DOM.enable')
  const dom=await cdp('DOM.getDocument')
  const input=await cdp('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[webkitdirectory]'})
  await cdp('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[source]})
  await ui('document.querySelectorAll(".template-file-list li").length===5',45)
  const listed=await evalJs('[...document.querySelectorAll(".template-file-list li")].map(li=>[li.querySelector("code").title,li.querySelector("select").value])')
  check(Object.keys(samples).every(key=>listed.some(([name])=>name===key)),'import removed nested paths',listed)
  check(listed.some(([n,value])=>n==='skills/review/SKILL.md'&&value==='skill')&&
    listed.filter(([,value])=>value==='prompt').length===2&&listed.some(([n,value])=>n==='assets/fixture.bin'&&value==='resource'),
    'import classification did not match the selected files',listed)
  await shot('template-folder-editor')
  await submit('.template-preview')
  await ui('!document.querySelector(".catalog-form-dialog").open&&!!document.querySelector(".catalog-card")')
  const saved=Object.values((await a.read()).templates)[0]
  check(saved.files.length===5&&saved.prompt===''&&saved.versions[0].files.length===5,'file-only template or revision did not save')
  const second=await account()
  const forbidden=await second.command('template.save',{name:'错误工作区',files:saved.files})
  check(forbidden.status===403,'foreign workspace could adopt private template objects',forbidden)
  const wrong=await a.command('template.save',{name:'错误用途',files:saved.files.map(f=>f.path.endsWith('.bin')?{...f,purpose:'prompt'}:f)})
  check(wrong.status===400,'binary data could be declared as a prompt',wrong)
  const invalidPath=await request('/api/v1/team-workspace/template-files',{files:[{path:'../escape.md',data:'YQ=='}]},a.token)
  check(invalidPath.status===400,'upload accepted an invalid relative path',invalidPath)
  await switchTo('#/teams/'+team)
  await view(390,844,true)
  await ui('!!document.querySelector(".team-inline-form select")')
  await set('.team-inline-form select',saved.id);await set('.team-inline-form input','已采用文件夹模板的员工');await submit('.team-inline-form')
  await ui('document.querySelector(".organization-node")?.textContent.includes("已采用文件夹模板的员工")')
  const employee=Object.values((await a.read()).employees)[0]
  check(employee.files.length===5&&employee.templateRevision===1,'employee did not adopt the package')
  const task=await a.ok('task.assign',{employeeId:employee.id,
   goal:'请读取模板的 references/sample.csv，归档一份报告，将两个工作指令标记、Skill 标记和 CSV 的 marker 值原样列出。只用合成测试资料，注明未验证范围，最后明确完成。'})
  const updated=await request('/api/v1/team-workspace/template-files',{files:[{path:'prompts/quality.md',data:Buffer.from('第二指令新版标记 MOSS_NEW。').toString('base64')}]},a.token)
  check(updated.status===200,'could not upload the updated instruction file',updated)
  const files=saved.files.map(f=>f.path==='prompts/quality.md'?{...updated.body.files[0],purpose:'prompt'}:f)
  const next=await a.ok('template.save',{id:saved.id,expectedRevision:1,name:saved.name,files})
  const state=await a.read()
  check(next.revision===2&&state.tasks[task.id].employeeSnapshot.files.find(f=>f.path==='prompts/quality.md').key!==files.find(f=>f.path==='prompts/quality.md').key,'existing task lost the original file snapshot')
  await fs.writeFile('/tmp/gill-template-folder-fixture.json',JSON.stringify({token:a.token,taskId:task.id,templateId:saved.id,employeeId:employee.id}),{mode:0o600})
  check(!exceptions.length,'Chrome raised an exception during folder import')
  console.log(JSON.stringify({case:'folder-template',passed:true,template:saved.id,task:task.id,files:listed}))
 }else if(process.argv[2]){
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
 await ui('!!document.querySelector(".template-start")')
 await click('.template-start-actions button')
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
 await ui('!document.querySelector(".catalog-form-dialog").open&&!!document.querySelector(".catalog-card")')
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
