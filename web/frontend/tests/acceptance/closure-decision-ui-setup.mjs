import fs from 'node:fs'
import {fixture,check,work,claim,operation,workerCommand} from './harness.mjs'

const a=await fixture({members:3})
await a.ok('team.relations',{teamId:a.team,relations:a.members.map((id,index)=>({id,parentId:a.members[index+1]||'user',expectedRevision:1}))})
const source=(await a.ok('knowledge.save',{title:'本任务采用资料',content:'合成资料第一版'})).id
await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
const root=await work(a,a.members[0],'选择本期资料采用范围')
check((await operation(root.job,'context')).body.knowledge[0].revision===1,'fixture did not observe v1')
await a.ok('knowledge.save',{id:source,expectedRevision:1,title:'本任务采用资料',content:'合成资料第二版'})
const escalation=await workerCommand(root.job,'issue.escalate',{
 problem:'标准冲突，需明确采用哪种范围。',attempts:['已核对两份合成资料'],options:['采用 A，限制在已确认范围','采用 B，等待补证']
})
check(escalation.status===200,'root escalation failed')
await operation(root.job,'finish',{state:'done',result:{}})
for(const [index,opinion] of [[1,'直属上级认为缺少有效依据'],[2,'上一级认为需要用户明确选择']]){
 const job=await claim()
 check(job.payload?.employeeId===a.members[index],'unexpected assessment claimant')
 const response=await workerCommand(job,'decision.respond',{decisionId:escalation.body.id,answer:opinion,resolved:false,escalate:true})
 check(response.status===200,'assessment escalation failed')
 await operation(job,'finish',{state:'done',result:{}})
}
const state=await a.read()
check(state.decisions[escalation.body.id].handlerId==='user','no user decision to inspect')
fs.writeFileSync('/tmp/gill-closure-decision-ui.json',JSON.stringify({username:a.username,password:a.password,token:a.token,teamId:a.team,decisionId:escalation.body.id}),{mode:0o600})
