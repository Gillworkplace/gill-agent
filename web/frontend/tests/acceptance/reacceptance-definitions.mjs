import fs from 'node:fs'
import {fixture,check} from './harness.mjs'
const results=[]
async function scenario(id,run){
 try{results.push({id,status:'passed',at:new Date().toISOString(),details:await run()})}
 catch(error){results.push({id,status:'failed',at:new Date().toISOString(),error:error.message,details:error.details||{}});process.exitCode=1}
 fs.writeFileSync('/tmp/gill-reacceptance-definitions.json',JSON.stringify(results,null,2)+'\n')
 console.log(JSON.stringify(results.at(-1)))
}
await scenario('X01-cross-team-employee-knowledge-bindings-and-new-employee',async()=>{
 const a=await fixture({members:2})
 const other=(await a.ok('team.create',{name:'显式知识跨团队绑定验证'})).id
 const b=(await a.ok('employee.create',{teamId:other,templateId:a.template,name:'B',parentId:'user'})).id
 const source=(await a.ok('knowledge.save',{title:'共享源',content:'合成资料v1'})).id
 for(const employeeId of [a.members[0],b])await a.ok('knowledge.mount',{employeeId,sourceId:source})
 const d=(await a.ok('employee.create',{teamId:a.team,templateId:a.template,name:'新员工D',parentId:'user'})).id
 await a.ok('knowledge.save',{id:source,expectedRevision:1,title:'共享源',content:'合成资料v2'})
 const s=await a.read()
 check(s.employees[a.members[0]].knowledgeIds.includes(source)&&s.employees[b].knowledgeIds.includes(source),'explicit mounted bindings lost')
 check(!s.employees[a.members[1]].knowledgeIds.includes(source)&&!s.employees[d].knowledgeIds.includes(source),'unmounted or new identity inherited knowledge')
 check(s.knowledge[source].revision===2&&s.knowledge[source].versions.length===2,'shared source revision history not retained')
 check(s.employees[b].teamId===other&&s.employees[d].teamId===a.team,'employee identity changed team')
 return {sourceId:source,currentRevision:2,mountedEmployees:[a.members[0],b],unmountedEmployees:[a.members[1],d],sameSourceAcrossDistinctTeams:true,note:'Binding/source projection only; no model or privileged source-read context was invoked.'}
})
await scenario('X02-invalid-organization-batches-are-atomic',async()=>{
 const a=await fixture({members:3}),other=(await a.ok('team.create',{name:'另一个团队'})).id
 const outsider=(await a.ok('employee.create',{teamId:other,templateId:a.template,name:'外队上级',parentId:'user'})).id
 const original=(await a.read()).employees
 const cases=[['self',a.members[0]],['cycle',a.members[1]],['missing','11111111-1111-4111-8111-111111111111'],['other-team',outsider]],observed=[]
 for(const [kind,parentId]of cases){
  const relations=a.members.map(id=>({id,parentId:id===a.members[0]?parentId:kind==='cycle'&&id===a.members[1]?a.members[0]:'user',expectedRevision:original[id].revision}))
  const response=await a.command('team.relations',{teamId:a.team,relations})
  check(response.status>=400&&response.status<500,'invalid organization accepted',{kind,status:response.status})
  const after=(await a.read()).employees
  check(a.members.every(id=>after[id].parentId===original[id].parentId&&after[id].revision===original[id].revision),'rejected batch changed valid relationships',{kind})
  observed.push({kind,status:response.status,error:response.body.error})
 }
 return {rejected:observed,effectiveRelationsUnchanged:true}
})
