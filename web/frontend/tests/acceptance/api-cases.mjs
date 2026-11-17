import {fixture,account,test,check,work,operation,workerCommand,request} from './harness.mjs'

await test('A01-identities-and-authority',['AC-11','AC-17','AC-26','AC-34'],async()=>{
 const a=await fixture(),other=(await a.ok('team.create',{name:'另一团队'})).id
 const foreign=(await a.ok('employee.create',{teamId:other,templateId:a.template,name:'员工0'})).id
 check(foreign!==a.members[0],'template reuse reused actual employee identity')
 const move=await a.command('employee.update',{id:a.members[0],teamId:other,expectedRevision:1})
 check(move.status===403,'employee was moved across teams',move)
 const {job}=await work(a)
 const attempts=[]
 for(const [kind,payload]of [
  ['knowledge.save',{title:'unauthorized',content:'forbidden'}],
  ['employee.create',{teamId:a.team,templateId:a.template,name:'unauthorized'}],
  ['team.update',{id:a.team,name:'unauthorized',expectedRevision:1}],
  ['message.send',{text:'跨队同名不能误投',mentions:[foreign]}]
 ]){const r=await workerCommand(job,kind,payload);attempts.push({kind,status:r.status});check(r.status===403,'worker bypassed management/team boundary',{kind,...r})}
 const b=await account(),read=await request('/api/v1/team-workspace/executions/'+job.id,undefined,b.token)
 check(read.status===403,'another user read execution',read)
 await operation(job,'finish',{state:'done',result:{}})
 const s=await a.read();check(Object.keys(s.knowledge).length===0,'failed write changed knowledge')
 return {attempts,crossUserStatus:read.status,employeeIds:[...a.members,foreign]}
})

await test('A02-definition-CAS-and-tree',['AC-06','AC-16','AC-30'],async()=>{
 const a=await fixture(),key=crypto.randomUUID(),payload={name:'幂等团队'}
 const first=await a.ok('team.create',payload,key),again=await a.ok('team.create',payload,key)
 check(first.id===again.id,'retry duplicated team')
 const changed=await a.command('team.create',{name:'不同内容'},key);check(changed.status===409,'different request body accepted under same key',changed)
 const saves=await Promise.all(['竞争A','竞争B'].map(name=>a.command('team.update',{id:a.team,expectedRevision:1,name})))
 check(saves.map(x=>x.status).sort().join(',')==='200,409','concurrent stale changes both committed',saves)
 const before=await a.read(),relations=a.members.map((id,i)=>({id,parentId:i?a.members[0]:'user',expectedRevision:before.employees[id].revision}))
 await a.ok('team.relations',{teamId:a.team,relations})
 const valid=await a.read(),cycle=a.members.map((id,i)=>({id,parentId:a.members[1-i],expectedRevision:valid.employees[id].revision}))
 const rejected=await a.command('team.relations',{teamId:a.team,relations:cycle})
 check(rejected.status===400,'cycle was saved',rejected)
 const after=await a.read();check(after.employees[a.members[0]].parentId==='user'&&after.employees[a.members[1]].parentId===a.members[0],'rejected tree changed existing relation')
 return {concurrentStatuses:saves.map(x=>x.status),cycleStatus:rejected.status,teamId:a.team}
})

await test('A03-knowledge-and-task-snapshots',['AC-06','AC-12','AC-26','AC-27','AC-29'],async()=>{
 const a=await fixture({members:3})
 const source=(await a.ok('knowledge.save',{title:'已授权资料',content:'v1：合成样本17份。'})).id
 await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
 const {job}=await work(a),initial=await operation(job,'context')
 check(initial.body.knowledge.length===1&&initial.body.knowledge[0].revision===1,'mounted source unavailable',initial)
 await a.ok('knowledge.save',{id:source,expectedRevision:1,title:'已授权资料',content:'v2：合成样本23份。'})
 await a.ok('employee.update',{id:a.members[0],expectedRevision:1,prompt:'新员工规则'})
 await a.ok('team.update',{id:a.team,expectedRevision:1,name:'验收团队',prompt:'新团队规则'})
 const fresh=await operation(job,'context')
 check(fresh.body.knowledge[0].revision===2,'new source version invisible to mounted employee',fresh)
 check(fresh.body.employee.prompt===initial.body.employee.prompt&&fresh.body.team.prompt===initial.body.team.prompt,'in-flight instructions changed')
 await a.ok('knowledge.unmount',{employeeId:a.members[0],sourceId:source})
 const unmounted=await operation(job,'context')
 check(unmounted.body.knowledge.length===0&&unmounted.body.retainedKnowledge[source].revision===2,'unmount lost already-read source or allowed a new read',unmounted)
 const denied=await workerCommand(job,'knowledge.mount',{employeeId:a.members[1],sourceId:source})
 check(denied.status===403,'employee changed knowledge mount',denied)
 await operation(job,'finish',{state:'done',result:{}})
 const second=await work(a,a.members[1]),unbound=await operation(second.job,'context')
 check(unbound.body.knowledge.length===0,'unmounted teammate inherited knowledge')
 await operation(second.job,'finish',{state:'done',result:{}})
 const s=await a.read();check(s.knowledge[source].versions.length===2&&s.employees[a.members[2]].knowledgeIds.length===0,'source history or third employee isolation incorrect')
 return {source,readRevisions:[initial.body.knowledge[0].revision,fresh.body.knowledge[0].revision],unmountedSources:0,history:2}
})

await test('A04-template-adoption-and-conflict',['AC-19','AC-28','AC-29'],async()=>{
 const a=await fixture(),first=await work(a),old=(await operation(first.job,'context')).body
 await a.ok('template.save',{id:a.template,expectedRevision:1,name:'新版模板',prompt:'模板v2新规则',skills:[{name:'改进',content:'标明依据'}]})
 const fixed=(await operation(first.job,'context')).body
 check(fixed.employee.templateRevision===1&&fixed.employee.prompt===old.employee.prompt,'template hot-replaced active task')
 await operation(first.job,'finish',{state:'done',result:{}})
 const second=await work(a),adopted=(await operation(second.job,'context')).body
 check(adopted.employee.templateRevision===2&&adopted.employee.prompt==='模板v2新规则','new task failed to follow updated template',adopted.employee)
 const s=await a.read();await a.ok('employee.update',{id:a.members[0],expectedRevision:s.employees[a.members[0]].revision,prompt:'保留本员工个性化规则'})
 const revised=await workerCommand(second.job,'template.revise',{id:a.template,expectedRevision:2,name:'自迭代候选',prompt:'模板v3不同规则',skills:[],reason:'发现可改进的工作方式'})
 check(revised.status===200,'self iteration was rejected',revised)
 await operation(second.job,'finish',{state:'done',result:{}})
 const third=await work(a),conflict=(await operation(third.job,'context')).body
 check(conflict.employee.templateRevision===2&&conflict.employee.prompt==='保留本员工个性化规则','conflict overwrote employee customization',conflict.employee)
 await operation(third.job,'finish',{state:'done',result:{}})
 const final=await a.read();check(Object.values(final.messages).some(m=>m.mentionUser&&m.subjectId===a.members[0]),'conflict did not alert manager')
 return {taskVersions:[old.employee.templateRevision,adopted.employee.templateRevision,conflict.employee.templateRevision],templateRevision:final.templates[a.template].revision,iterationSource:final.templates[a.template].versions.at(-1)}
})

await test('A05-project-documents-and-agent-archiving',['AC-22'],async()=>{
 const a=await fixture(),project=(await a.ok('project.save',{teamId:a.team,name:'资料项目'})).id
 const doc=(await a.ok('document.save',{projectId:project,title:'版本文档',content:'A版'})).id
 await a.ok('document.save',{projectId:project,id:doc,expectedRevision:1,title:'版本文档',content:'B版'})
 const s=await a.read();check(s.projects[project].documents[doc].versions.map(x=>x.content).join(',')==='A版,B版','document history was overwritten')
 const {job}=await work(a,a.members[0],'按有效工作规则整理资料并归档项目文档',{projectId:project})
 const archive=await workerCommand(job,'document.save',{projectId:project,title:'员工整理的资料',content:'合成整理结果；未做真实业务核验。'})
 await operation(job,'finish',{state:'done',result:{}})
 check(archive.status===200,'employee cannot archive project document under an authorized task',{status:archive.status,response:archive.body,projectId:project})
 return {project,doc}
})
