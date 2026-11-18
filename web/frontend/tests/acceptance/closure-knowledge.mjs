import {fixture,check,operation,test,work,workerCommand} from './harness.mjs'

await test('Y01-cross-team-knowledge-read-through-leased-context',['AC-26','AC-27','AC-29'],async()=>{
 const a=await fixture({members:2})
 const secondTeam=(await a.ok('team.create',{name:'资料复核二组'})).id
 const second=(await a.ok('employee.create',{teamId:secondTeam,templateId:a.template,name:'第二组复核人'})).id
 const source=(await a.ok('knowledge.save',{title:'共同验收资料',content:'合成资料唯一正文，版本一，计数 17。'})).id
 await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
 await a.ok('knowledge.mount',{employeeId:second,sourceId:source})
 const first=await work(a,a.members[0])
 const firstContext=(await operation(first.job,'context')).body
 check(firstContext.knowledge.length===1&&firstContext.knowledge[0].id===source&&firstContext.knowledge[0].revision===1,'first authorized context missing')
 await a.ok('knowledge.save',{id:source,title:'共同验收资料',expectedRevision:1,content:'合成资料唯一正文，版本二，计数 23。'})
 const current=(await operation(first.job,'context')).body
 check(current.knowledge[0].revision===2,'shared source update hidden')
 await operation(first.job,'finish',{state:'done',result:{}})
 const outside=await work(a,second)
 const other=(await operation(outside.job,'context')).body
 check(other.knowledge.length===1&&other.knowledge[0].id===source&&other.knowledge[0].revision===2,'cross-team mounted context missing v2')
 check(other.teamId===secondTeam&&other.peers.every(p=>p.id!==a.members[0]),'cross-team mounted source leaked employee context')
 await operation(outside.job,'finish',{state:'done',result:{}})
 const unbound=await work(a,a.members[1])
 const denied=(await operation(unbound.job,'context')).body
 check(!denied.knowledge.length&&!Object.hasOwn(denied.retainedKnowledge,source),'unmounted employee obtained the source')
 await operation(unbound.job,'finish',{state:'done',result:{}})
 return {source,firstRead:1,firstAfterUpdate:2,secondTeamRead:2,unmountedSources:0}
})

await test('Y02-derived-template-permission-and-knowledge-copy',['AC-27','AC-28','AC-29'],async()=>{
 const a=await fixture({members:1})
 const secondTeam=(await a.ok('team.create',{name:'需明确授权的团队'})).id
 const peer=(await a.ok('employee.create',{teamId:secondTeam,templateId:a.template,name:'既有员工'})).id
 const content='这是合成受控知识源的完整正文，不应复制进模板。'
 const source=(await a.ok('knowledge.save',{title:'合成受控资料',content})).id
 await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
 const first=await work(a)
 await operation(first.job,'context')
 await a.ok('knowledge.unmount',{employeeId:a.members[0],sourceId:source})
 const revision={id:a.template,expectedRevision:1,name:'可迭代模板',prompt:'只保留任务方法。',skills:[],reason:'合成验收'}
 const blocked=await workerCommand(first.job,'template.revise',{...revision,skills:[{name:'错误派生内容',content}]})
 check(blocked.status>=400&&blocked.status<500&&blocked.body.error?.code==='KNOWLEDGE_COPY_FORBIDDEN','retained source copy was not rejected',blocked)
 const accepted=await workerCommand(first.job,'template.revise',revision)
 check(accepted.status===200,'non-copying template revision failed',accepted)
 await operation(first.job,'finish',{state:'done',result:{}})
 const before=await work(a,peer)
 const beforeContext=(await operation(before.job,'context')).body
 check(beforeContext.employee.templateRevision===1,'cross-team existing employee consumed unauthorized revision')
 await operation(before.job,'finish',{state:'done',result:{}})
 const creation=await a.command('employee.create',{teamId:secondTeam,templateId:a.template,name:'未经授权的采用'})
 check(creation.status===403,'cross-team creation consumed unauthorized revision',creation)
 await a.ok('template.share',{id:a.template,expectedRevision:2,teamIds:[secondTeam]})
 const after=await work(a,peer)
 const permitted=(await operation(after.job,'context')).body
 check(permitted.employee.templateRevision===2&&!permitted.knowledge.length,'explicit adoption failed or inherited knowledge')
 await operation(after.job,'finish',{state:'done',result:{}})
 const state=await a.read()
 check(state.knowledge[source].revision===1&&state.knowledge[source].content===content,'template change altered source')
 return {template:a.template,deniedCopy:blocked.status,deniedCrossTeamCreation:creation.status,crossTeamReadRevisions:[1,2],inheritedKnowledge:0}
})
