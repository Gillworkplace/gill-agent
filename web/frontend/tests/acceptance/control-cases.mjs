import {fixture,test,check,work,claim,operation,workerCommand} from './harness.mjs'

async function escalated(a){
 const {task,job}=await work(a)
 const response=await workerCommand(job,'issue.escalate',{problem:'缺少明确策略，无法决定',attempts:['已核对合成资料'],options:['方案A','方案B']})
 check(response.status===200,'escalation setup failed',response)
 await operation(job,'finish',{state:'done',result:{}})
 const s=await a.read();return{task,job,decision:response.body.id,run:s.tasks[task].runId}
}

await test('B01-multiple-superiors-and-human',['AC-09','AC-10','AC-31'],async()=>{
 const a=await fixture({members:3})
 await a.ok('team.relations',{teamId:a.team,relations:a.members.map((id,i)=>({id,parentId:a.members[i+1]||'user',expectedRevision:1}))})
 const start=await escalated(a),middle=await claim()
 check(middle.payload.employeeId===a.members[1],'first assessment did not follow hierarchy',middle.payload)
 const unclear=await workerCommand(middle,'decision.respond',{decisionId:start.decision,answer:'尚缺依据',resolved:false})
 check(unclear.status===200&&(await a.read()).decisions[start.decision].state==='open','unclear response resolved the decision')
 await workerCommand(middle,'decision.respond',{decisionId:start.decision,answer:'仍无依据，请更高上级评估',resolved:false,escalate:true})
 const waiting=(await a.read()).tasks[middle.payload.taskId]
 check(waiting.state==='blocked','escalated superior continued working',waiting)
 await operation(middle,'finish',{state:'done',result:{}})
 const upper=await claim();check(upper.payload.employeeId===a.members[2],'higher assessment routed incorrectly',upper.payload)
 await workerCommand(upper,'issue.escalate',{problem:'我仍无法决定，请用户选择',attempts:['两级核查'],options:['A','B']})
 await operation(upper,'finish',{state:'done',result:{}})
 const user=await a.read();check(user.decisions[start.decision].handlerId==='user'&&user.decisions[start.decision].state==='open','final escalation did not reach human')
 const notice=Object.values(user.messages).find(m=>m.decisionId===start.decision&&m.mentionUser)
 check(!!notice,'human was not mentioned')
 await a.ok('decision.respond',{decisionId:start.decision,answer:'基于验收规则明确选择A',resolved:true})
 const resumed=await claim();check(resumed.payload?.taskId===start.task,'resolved original task was not scheduled',resumed.payload)
 const context=await operation(resumed,'context');check(context.body.task.decisionAnswer.includes('明确选择A'),'answer not supplied to resumed employee')
 await operation(resumed,'finish',{state:'done',result:{}})
 return {path:user.decisions[start.decision].path,sourceTask:start.task,decision:start.decision,handlerBeforeAnswer:'user'}
})

await test('B02-answer-during-human-pause-then-resume',['AC-07','AC-09','AC-16','AC-31'],async()=>{
 const a=await fixture(),x=await escalated(a)
 await a.ok('run.control',{runId:x.run,operation:'pause'})
 await a.ok('decision.respond',{decisionId:x.decision,answer:'明确选择A，仍保留人工暂停',resolved:true})
 const paused=await a.read(),unexpected=await claim()
 check(paused.runs[x.run].manualPaused===true&&!unexpected.id,'answer removed manual pause',{run:paused.runs[x.run],job:unexpected})
 await a.ok('run.control',{runId:x.run,operation:'resume'})
 const resumed=await claim(),after=await a.read()
 check(resumed.payload?.taskId===x.task,'explicit resume left answered task queued with no executable work',{taskId:x.task,taskState:after.tasks[x.task].state,runState:after.runs[x.run].state,claimedJob:resumed})
 await operation(resumed,'finish',{state:'done',result:{}})
 return {taskId:x.task,resumedJob:resumed.id}
})

await test('B03-stale-decision-cannot-revive-cancelled-task',['AC-10','AC-16','AC-31'],async()=>{
 const a=await fixture(),x=await escalated(a)
 await a.ok('task.update',{taskId:x.task,state:'cancelled',reason:'用户已取消此方案，不再执行'})
 const late=await a.command('decision.respond',{decisionId:x.decision,answer:'旧页面中迟到的确认',resolved:true})
 const after=await a.read(),queued=await claim()
 check(after.tasks[x.task].state==='cancelled'&&!queued.id,'old decision revived cancelled work',{status:late.status,decisionState:after.decisions[x.decision].state,taskState:after.tasks[x.task].state,queuedTask:queued.payload?.taskId,taskId:x.task})
 return {status:late.status,taskState:after.tasks[x.task].state}
})

await test('B04-unknown-actions-fences-and-reconciliation',['AC-05','AC-07','AC-16','AC-32'],async()=>{
 const a=await fixture(),{task,job}=await work(a)
 await operation(job,'action',{requestKey:'unknown-action',kind:'shell',input:{command:'acceptance fixture only; not executed'}})
 await operation(job,'action-result',{requestKey:'unknown-action',state:'unknown',result:{explanation:'synthetic missing receipt; no external command executed'}})
 const ended=await operation(job,'finish',{state:'done',result:{}})
 check(ended.body.state==='needs_reconciliation','unknown external action became done',ended)
 const bypass=await a.command('task.update',{taskId:task,state:'queued'})
 check(bypass.status===400,'unknown side effect was blindly resumed',bypass)
 await a.ok('execution.reconcile',{executionId:job.id,executionStopped:true,resolution:'failed',evidence:'本用例未执行外部命令，模拟Worker已停止；确认没有外部副作用。'})
 const stale=await operation(job,'heartbeat');check(stale.status===409,'stale worker retained authority',stale)
 const late=await operation(job,'late-result',{requestKey:'unknown-action',result:{stdout:'late synthetic observation'}})
 const after=await a.read();check(late.body.state==='recorded-not-applied'&&after.tasks[task].state==='paused','late receipt silently advanced current state',{late,task:after.tasks[task]})
 return {unknownState:ended.body.state,staleStatus:stale.status,lateState:late.body.state,taskState:after.tasks[task].state}
})

await test('B05-review-must-reference-existing-artifact-version',['AC-04','AC-32'],async()=>{
 const a=await fixture(),source=await work(a)
 const artifact=(await workerCommand(source.job,'artifact.save',{title:'分析v1',content:'合成分析',unchecked:'未核验真实数据'})).body.id
 await operation(source.job,'finish',{state:'done',result:{}})
 const peer=await work(a,a.members[1],'核查实际存在的产物版本')
 const invalid=await workerCommand(peer.job,'check.record',{artifactId:artifact,subjectRevision:999,result:'通过',limitations:'模型意见，不是外部工具'})
 await operation(peer.job,'finish',{state:'done',result:{}})
 const s=await a.read()
 check(invalid.status>=400,'platform accepted a review of a nonexistent revision',{status:invalid.status,artifactRevision:s.artifacts[artifact].revision,review:Object.values(s.checks).find(c=>c.artifactId===artifact)})
 return {status:invalid.status}
})

await test('B06-invalid-superior-must-report-configuration-exception',['AC-09','AC-10'],async()=>{
 const a=await fixture()
 await a.ok('employee.update',{id:a.members[0],expectedRevision:1,parentId:a.members[1]})
 const {task,job}=await work(a)
 await a.ok('employee.update',{id:a.members[1],expectedRevision:1,lifecycle:'disabled'})
 const r=await workerCommand(job,'issue.escalate',{problem:'验收中的待决方案',attempts:[],options:['A','B']})
 await operation(job,'finish',{state:'done',result:{}})
 const s=await a.read(),decision=s.decisions[r.body.id],notices=Object.values(s.messages).filter(m=>m.mentionUser)
 check(decision.handlerId==='user','disabled superior swallowed escalation',decision)
 check(notices.some(m=>/配置|失效|禁用|不存在|上级异常|disabled/.test(m.text)),'escalation silently bypassed disabled superior without configuration notice',{taskId:task,disabledSuperior:a.members[1],decision,notices})
 return {decisionId:decision.id}
})
