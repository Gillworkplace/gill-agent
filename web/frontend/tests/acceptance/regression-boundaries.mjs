import {fixture,test,check,work,claim,operation,workerCommand} from './harness.mjs'

await test('G01-direct-superior-resolves-original-task',['AC-09','AC-10'],async()=>{
 const a=await fixture();await a.ok('employee.update',{id:a.members[0],expectedRevision:1,parentId:a.members[1]})
 const x=await work(a),d=await workerCommand(x.job,'issue.escalate',{problem:'合成资料需要取舍',attempts:['已比较来源'],options:['A','B']})
 await operation(x.job,'finish',{state:'done',result:{}})
 const assessor=await claim();check(assessor.payload.employeeId===a.members[1],'direct superior not scheduled')
 const answer=await workerCommand(assessor,'decision.respond',{decisionId:d.body.id,answer:'上级依据已确认规则选择A',resolved:true})
 check(answer.status===200,'direct superior cannot resolve',answer);await operation(assessor,'finish',{state:'done',result:{}})
 const resumed=await claim(),context=await operation(resumed,'context')
 check(resumed.payload.taskId===x.task&&context.body.task.decisionAnswer.includes('选择A'),'resolution not delivered to original task')
 await operation(resumed,'finish',{state:'stopped',result:{reason:'protocol regression ended; no model called'}})
 return {decision:d.body.id,original:x.task,resumed:resumed.id}
})

await test('G02-reassignment-invalidates-the-old-decision',['AC-16','AC-31'],async()=>{
 const a=await fixture(),x=await work(a),d=await workerCommand(x.job,'issue.escalate',{problem:'旧计划待决',attempts:[],options:['继续']})
 await operation(x.job,'finish',{state:'done',result:{}})
 const next=await a.ok('task.update',{taskId:x.task,state:'queued',employeeId:a.members[1],reason:'明确调整负责人'})
 const late=await a.command('decision.respond',{decisionId:d.body.id,answer:'迟到的旧计划同意',resolved:true})
 const s=await a.read(),job=await claim()
 check(late.status===409&&s.tasks[x.task].state==='cancelled'&&s.decisions[d.body.id].state==='superseded','old decision survived reassignment',{status:late.status,oldTask:s.tasks[x.task].state,decision:s.decisions[d.body.id].state})
 check(job.payload.taskId===next.id&&job.payload.employeeId===a.members[1],'replacement not executable')
 await operation(job,'finish',{state:'stopped',result:{reason:'protocol fixture only'}})
 return {oldTask:x.task,newTask:next.id,lateStatus:late.status}
})

await test('G03-other-task-project-cannot-be-impersonated',['AC-22','AC-11'],async()=>{
 const a=await fixture({members:1}),p=(await a.ok('project.save',{teamId:a.team,name:'当前工作'})).id,q=(await a.ok('project.save',{teamId:a.team,name:'另一工作'})).id
 const x=await work(a,a.members[0],'本项目归档',{projectId:p}),other=(await a.ok('task.assign',{employeeId:a.members[0],goal:'另一独立任务',projectId:q})).id
 const denied=await workerCommand(x.job,'document.save',{taskId:other,projectId:q,title:'冒用另一任务',content:'不能落库'})
 check(denied.status===403,'current execution impersonated another task',denied)
 const saved=await workerCommand(x.job,'document.save',{projectId:p,title:'授权归档',content:'合成资料，未核验真实业务'})
 check(saved.status===200,'legitimate archive rejected',saved)
 const s=await a.read();check(Object.keys(s.projects[q].documents||{}).length===0&&s.projects[p].documents[saved.body.id].taskId===x.task,'document scope/provenance incorrect')
 await operation(x.job,'finish',{state:'done',result:{}})
 return {deniedStatus:denied.status,document:saved.body.id,sourceTask:x.task}
})

await test('G04-dependency-wait-independent-work-and-paused-resolution',['AC-07','AC-09','AC-16','AC-34'],async()=>{
 const a=await fixture({members:3}),root=await work(a)
 const child=(await workerCommand(root.job,'task.assign',{employeeId:a.members[1],goal:'相关核查'})).body.id
 const independent=(await workerCommand(root.job,'task.assign',{employeeId:a.members[2],goal:'预先声明独立整理',dependsOnTaskIds:[]})).body.id
 const dependentJob=await claim(),independentJob=await claim()
 check(dependentJob.payload.taskId===child&&independentJob.payload.taskId===independent,'unexpected fixture queue order')
 const d=(await workerCommand(root.job,'issue.escalate',{problem:'同一事项需用户决定',attempts:[],options:['A','B']})).body.id
 const held=await operation(dependentJob,'action',{requestKey:'held-model',kind:'model',input:{fixture:true}})
 check(held.body.state==='paused','dependent model intent dispatched',held)
 const allowed=await operation(independentJob,'action',{requestKey:'independent-model',kind:'model',input:{fixture:true}})
 check(allowed.body.state==='dispatched','independent work was incorrectly blocked',allowed)
 await operation(independentJob,'action-result',{requestKey:'independent-model',state:'succeeded',result:{fixture:'synthetic protocol receipt; no actual model called'}})
 for(const job of [root.job,dependentJob,independentJob])await operation(job,'finish',{state:'done',result:{}})
 const before=await a.read(),run=before.tasks[root.task].runId;await a.ok('run.control',{runId:run,operation:'pause'})
 await a.ok('decision.respond',{decisionId:d,answer:'用户明确选择A，保留暂停',resolved:true})
 check(!(await claim()).id&&(await a.read()).runs[run].manualPaused===true,'answer bypassed manual pause')
 await a.ok('run.control',{runId:run,operation:'resume'});await a.ok('run.control',{runId:run,operation:'resume'})
 const first=await claim(),second=await claim(),extra=await claim()
 check(new Set([first.payload?.taskId,second.payload?.taskId]).size===2&&[first.payload?.taskId,second.payload?.taskId].every(id=>[root.task,child].includes(id))&&!extra.id,'resume lost or duplicated related work',{first:first.payload,second:second.payload,extra})
 for(const job of [first,second])await operation(job,'finish',{state:'stopped',result:{reason:'protocol regression ended'}})
 return {decision:d,relatedTask:child,independentTask:independent,held:held.body.state,independent:allowed.body.state,resumedTasks:[first.payload.taskId,second.payload.taskId]}
})

await test('G05-higher-superior-disabled-is-reported',['AC-09','AC-31'],async()=>{
 const a=await fixture({members:3});await a.ok('team.relations',{teamId:a.team,relations:a.members.map((id,i)=>({id,parentId:a.members[i+1]||'user',expectedRevision:1}))})
 const x=await work(a),d=(await workerCommand(x.job,'issue.escalate',{problem:'需上级评估',attempts:[],options:[]})).body.id
 await operation(x.job,'finish',{state:'done',result:{}});const middle=await claim(),s=await a.read()
 await a.ok('employee.update',{id:a.members[2],expectedRevision:s.employees[a.members[2]].revision,lifecycle:'disabled'})
 const r=await workerCommand(middle,'decision.respond',{decisionId:d,answer:'仍不确定，需要上级评估',resolved:false,escalate:true})
 check(r.status===200,'higher escalation failed',r);await operation(middle,'finish',{state:'done',result:{}})
 const after=await a.read(),decision=after.decisions[d]
 check(decision.handlerId==='user'&&decision.configurationError?.includes(a.members[2])&&Object.values(after.messages).some(m=>m.mentionUser&&m.text.includes(a.members[2])),'higher supervisor fault was hidden',decision)
 return {decision:d,invalidSuperior:a.members[2],handler:decision.handlerId,configurationError:decision.configurationError}
})

await test('G06-invalid-review-versions-do-not-pollute-history',['AC-04','AC-32'],async()=>{
 const a=await fixture(),x=await work(a),art=(await workerCommand(x.job,'artifact.save',{title:'版本证据',content:'A',unchecked:'合成数据'})).body.id
 await workerCommand(x.job,'check.record',{artifactId:art,subjectRevision:1,result:'A版模型意见通过',limitations:'未执行外部工具'})
 await workerCommand(x.job,'artifact.save',{id:art,expectedRevision:1,title:'版本证据',content:'B',unchecked:'新版未验证'})
 const rejected=[];for(const revision of [0,-1,1.5,999]){const r=await workerCommand(x.job,'check.record',{artifactId:art,subjectRevision:revision,result:'不得落库',limitations:'非法引用'});rejected.push({revision,status:r.status});check(r.status>=400,'invalid version accepted',r)}
 const s=await a.read(),checks=Object.values(s.checks).filter(c=>c.artifactId===art)
 check(s.artifacts[art].revision===2&&checks.length===1&&checks[0].subjectRevision===1,'old evidence/history corrupted',{checks,artifactRevision:s.artifacts[art].revision})
 await operation(x.job,'finish',{state:'done',result:{}})
 return {artifact:art,currentRevision:2,retainedReviewRevision:1,rejected}
})
