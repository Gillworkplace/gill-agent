import fs from 'node:fs'
import {fixture,account,check} from './harness.mjs'
const accounts=[],observations=[]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const observe=value=>{observations.push({...value,at:new Date().toISOString()});fs.writeFileSync('/tmp/gill-reacceptance-extra-models.json',JSON.stringify(observations,null,2)+'\n');console.log(JSON.stringify({mode:value.mode,status:value.status||'observed'}))}
const credentials=()=>fs.writeFileSync('/tmp/gill-reacceptance-extra-accounts.json',JSON.stringify(accounts),{mode:0o600})
const save=async(a,kind,payload)=>{const r=await a.command(kind,payload);check(r.status===200,'extra model fixture command failed',{kind,...r});return r.body}
const projection=s=>Object.fromEntries(['runs','tasks','artifacts','decisions','checks','projects','templates','drafts','employees','knowledge'].map(k=>[k,Object.values(s[k]||{})]))
async function until(read,ready,seconds){
 const deadline=Date.now()+seconds*1000
 while(Date.now()<deadline){const s=await read();if(ready(s))return s;await sleep(3000)}
 throw Error('Observed execution did not reach its expected terminal boundary before the test deadline')
}
async function archive(){
 const a=await fixture({members:1,limits:{maxRounds:4,maxSeconds:600}})
 const projectId=(await save(a,'project.save',{teamId:a.team,name:'本轮文档归档验收'})).id
 const entry={mode:'archive-document',username:a.username,password:a.password,token:a.token,teamId:a.team,members:a.members,projectId}
 accounts.push(entry);credentials()
 entry.taskId=(await save(a,'task.assign',{employeeId:a.members[0],projectId,goal:'请将一份标题为“归档回归记录”的文档归档到当前任务关联项目库：正文写明这是合成资料、只用于验证当前平台文档归档，不代表真实业务核验。用archive_document实际保存，保留未验证说明，并保存实际归档结果的工作报告，最后complete_task。不得修改项目配置、知识库、团队或员工。'})).id
 credentials();console.log('Archive model task queued')
 const state=await until(()=>a.read(),s=>['completed','waiting','needs_reconciliation'].includes(s.runs[s.tasks[entry.taskId].runId].state)||['failed','needs_reconciliation'].includes(s.tasks[entry.taskId].state),610)
 const root=state.tasks[entry.taskId],run=state.runs[root.runId],docs=Object.values(state.projects[projectId].documents||{})
 const document=docs.find(d=>d.title==='归档回归记录'),version=document?.versions.find(v=>v.revision===document.revision)
 const passed=run.state==='completed'&&document?.revision===1&&document.taskId===root.id&&version?.authorType==='employee'&&version.authorId===a.members[0]&&document.content.includes('合成资料')&&run.calls<=4
 observe({mode:'archive-document',status:passed?'passed':'failed',fixture:{teamId:a.team,projectId,taskId:root.id},...projection(state)})
 if(!passed)process.exitCode=1
}
async function drafting(){
 const a=await account(),entry={mode:'two-turn-template-draft',username:a.username,password:a.password,token:a.token};accounts.push(entry);credentials()
 const first=await save(a,'template.generate',{text:'请通过对话生成一个通用资料核查员工模板，不绑定行业。工作Prompt区分事实、假设和待确认项；包含一个名为“证据核查”的Skill，要求保留引用来源与未验证范围。只生成草稿，不创建员工或正式模板。'})
 entry.draftId=first.id;credentials()
 const one=await until(()=>a.read(),s=>!s.drafts[first.id]?.busy,300)
 check(one.drafts[first.id]?.prompt&&!one.drafts[first.id]?.error,'first actual model draft failed')
 observe({mode:'template-draft-first',status:'observed',draft:one.drafts[first.id],savedTemplateCount:Object.keys(one.templates).length})
 check(Object.keys(one.templates).length===0,'unsaved generated draft became a template')
 const old=one.drafts[first.id]
 await save(a,'template.generate',{id:first.id,text:'继续完善刚才的草稿：保留证据核查能力，再新增名为“冲突上报”的Skill。遇到来源冲突时列明问题、已尝试方法和候选选项，交上级评估。保留合成示例/真实业务未核验的边界，不绑定岗位行业。',draft:{name:old.name,prompt:old.prompt,skills:old.skills}})
 const two=await until(()=>a.read(),s=>!s.drafts[first.id]?.busy,300),draft=two.drafts[first.id]
 check(draft?.prompt&&!draft.error,'second actual model draft failed')
 check(Object.keys(two.templates).length===0,'second unsaved draft became a template')
 const saved=await save(a,'template.save',{name:draft.name,prompt:draft.prompt,skills:draft.skills,draftId:first.id})
 const team=(await save(a,'team.create',{name:'真实对话模板采用团队'})).id
 const member=(await save(a,'employee.create',{teamId:team,templateId:saved.id,name:'从真实草稿创建的员工',parentId:'user'})).id
 const state=await a.read(),template=state.templates[saved.id],employee=state.employees[member]
 const passed=draft.messages.length>=4&&template.draftId===first.id&&template.skills.some(x=>x.name==='证据核查')&&template.skills.some(x=>x.name==='冲突上报')&&employee.templateRevision===template.revision&&employee.teamId===team&&Object.keys(state.templates).length===1
 observe({mode:'two-turn-template-draft',status:passed?'passed':'failed',fixture:{draftId:first.id,templateId:saved.id,employeeId:member,teamId:team},...projection(state)})
 if(!passed)process.exitCode=1
}
for(const [mode,run]of [['archive-document',archive],['two-turn-template-draft',drafting]]){
 try{await run()}catch(error){observe({mode,status:'failed-or-blocked',error:error.message,details:error.details||{}});process.exitCode=1}
}
