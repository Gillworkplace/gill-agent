import fs from 'node:fs'
import {check,fixture,request} from './harness.mjs'

const output='/tmp/gill-full-adoption-accounts.json'
const command=(account,kind,payload)=>request('/api/v1/team-workspace/commands',{kind,payload,requestKey:crypto.randomUUID()},account.token)
const read=async a=>(await request('/api/v1/team-workspace',undefined,a.token)).body
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function propose(){
 const a=await fixture({limits:{maxRounds:8,maxSeconds:600}})
 await a.ok('employee.update',{id:a.members[1],expectedRevision:1,prompt:'接到核查请求后，只以原始标记核对可用证据。保存一份明确结论并完成自己的任务。'})
 const task=(await a.ok('task.assign',{employeeId:a.members[0],goal:`原计划同时采用两个资料来源。收到最新事实：第二来源的唯一凭据撤回，调整为以第一份资料为主。动态安排 ${a.members[1]} 独立核查撤回影响，保留验证边界。建议团队今后在交付时列出被排除来源，记录为建议供用户决定。不要直接修改团队或人员配置。先保存建议与本次调整说明，再结束自己的任务。`})).id
 return {mode:'authority-replan',token:a.token,teamId:a.team,taskId:task,peerId:a.members[1]}
}

async function otherTeam(){
 const a=JSON.parse(fs.readFileSync('/tmp/gill-full-closure-accounts.json','utf8')).find(r=>r.mode==='knowledge-derivative')
 const s=await read(a),old=s.employees[a.other],current=s.templates[a.templateId]
 check(old.templateRevision<current.revision,'the other team already adopted the derived revision')
 const reply=await command(a,'task.assign',{employeeId:a.other,goal:'只使用自己实际授权的资料。先调用 search_knowledge 查询「合成路由校验规则」，记录返回的授权状态和来源，没有资料请解释并结束。'})
 check(reply.status===200,'could not start cross-team isolation check',reply)
 return {...a,mode:'no-cross-team-derivative',taskId:reply.body.id,oldRevision:old.templateRevision}
}

async function finish(a){
 const deadline=Date.now()+600000
 while(Date.now()<deadline){
  const s=await read(a),root=s.tasks[a.taskId],run=s.runs[root.runId]
  if(run.state==='completed')return s
  if(['waiting','needs_reconciliation','failed','stopped'].includes(run.state)||root.state==='failed')
   throw Error(a.mode+' did not finish: '+root.state+'/'+run.state)
  await pause(3500)
 }
 throw Error(a.mode+' live deadline expired')
}

if(process.argv[2]==='start'){
 const cases=[await propose(),await otherTeam()]
 fs.writeFileSync(output,JSON.stringify(cases),{mode:0o600})
 console.log(JSON.stringify({queued:cases.map(x=>x.mode)}))
}else{
 const [proposal,peer]=JSON.parse(fs.readFileSync(output))
 const approved=await finish(proposal)
 const root=approved.tasks[proposal.taskId],run=approved.runs[root.runId]
 const child=Object.values(approved.tasks).find(t=>t.parentTaskId===root.id&&t.employeeId===proposal.peerId)
 const report=Object.values(approved.artifacts).find(a=>a.taskId===root.id&&a.content.includes('建议'))
 check(child?.state==='completed'&&report,'real replan did not complete the independently assigned check')
 const team=approved.teams[proposal.teamId]
 check(team.revision===1&&!team.prompt.includes('被排除来源'),'employee applied a proposal without a decision')
 const adopted=await command(proposal,'team.update',{id:team.id,expectedRevision:1,name:team.name,
  prompt:team.prompt+'\n交付时列出被排除来源，依据建议产物 '+report.id})
 check(adopted.status===200&&adopted.body.revision===2,'manager adoption did not produce an audited revision',adopted)
 const kept=await finish(peer)
 const recipient=kept.tasks[peer.taskId],receipt=await request('/api/v1/team-workspace/executions/'+recipient.executionId,undefined,peer.token)
 const modelCalls=receipt.body.actions.filter(x=>x.kind==='model').map(x=>JSON.parse(x.result))
 check(modelCalls.some(x=>x.toolCalls?.some(c=>c.function.name==='search_knowledge')),'recipient did not actually attempt lookup')
 const owned=Object.values(kept.artifacts).filter(x=>x.taskId===recipient.id)
 check(owned.some(x=>/未挂载|无挂载|no_mounted_sources|未授权|授权来源数.*0/.test(x.content)),'recipient did not report real absence of access')
 check(owned.every(x=>!/纸鲸|潮汐釉|乙色路径|五月静置/.test(x.content)),'cross-team summary was exposed')
 check(recipient.employeeSnapshot.templateRevision===peer.oldRevision&&!recipient.retainedKnowledge?.[peer.sourceId],
  'the unrelated worker obtained unapproved template revision or source')
 console.log(JSON.stringify({case:'AC11-15-real-authority-and-replan',task:root.id,child:child.id,
  report:report.id,calls:run.calls,adoptedRevision:adopted.body.revision,passed:true}))
 console.log(JSON.stringify({case:'AC27-28-real-foreign-model-denied',task:recipient.id,
  report:owned[0].id,retainedTemplateRevision:peer.oldRevision,passed:true}))
}
