import {check,claim,fixture,operation,test,work,workerCommand} from './harness.mjs'

await test('D40-01-cross-turn-notice-and-peer-review', ['AC-09','AC-34'], async()=>{
 const a=await fixture(),root=await work(a)
 const mentions=[a.members[1]]
 const notify=await workerCommand(root.job,'message.send',{text:'请知悉并确认',mentions,requiresResponse:true})
 check(notify.status===200&&notify.body.intent==='notify','old chat flag was not reduced to a notice',notify)
 check(!(await claim()).id,'notice scheduled a recipient')
 const review=await workerCommand(root.job,'message.send',{text:'请独立核查出处',mentions,intent:'review'})
 const reviewJob=await claim()
 const state=await a.read()
 const reviewTask=state.tasks[reviewJob.payload?.taskId]
 check(review.status===200&&reviewTask?.purpose==='review'&&reviewTask.parentTaskId===root.task,'review was not linked as consultation')
 const d=await workerCommand(root.job,'issue.escalate',{problem:'依赖事项需决定'})
 check(d.status===200,'escalation could not follow an earlier review',d)
 const consulted=await operation(reviewJob,'action',{requestKey:'consultation',kind:'model',input:{fixture:true}})
 check(consulted.body.state==='dispatched','consultation should be allowed to collect opinions',consulted)
 await operation(reviewJob,'action-result',{requestKey:'consultation',state:'succeeded',result:{fixture:'protocol only'}})
 const formal=await workerCommand(reviewJob,'task.assign',{employeeId:a.members[0],goal:'开始正式实施'})
 check(formal.body.error?.code==='DEPENDENCY_UNRESOLVED','review bypassed the source decision',formal)
 const reply=await workerCommand(reviewJob,'message.send',{intent:'notify',replyTo:review.body.id,text:'合成核查意见',mentions:[a.members[0]]})
 check(reply.status===200,'peer could not post a scoped opinion',reply)
 const after=await a.read()
 check(Object.keys(after.tasks).length===2&&after.messages[reply.body.id].replyTo===review.body.id,'opinion or task attribution changed')
 return {notice:notify.body.id,review:review.body.id,decision:d.body.id,formalRejection:formal.body.error.code}
})

await test('D40-02-only-explicit-human-approval-unlocks-early-dispatch', ['AC-09','AC-16','AC-34'], async()=>{
 const a=await fixture({members:3}),[lead,superior,peer]=a.members
 await a.ok('employee.update',{id:lead,parentId:superior,expectedRevision:1})
 const root=await work(a,lead,'先准备可核查方案',{requireDispatchApproval:true})
 const context=await operation(root.job,'context')
 check(context.body.dispatchApprovalPending===true,'approval not visible to current employee',context)
 const assign={employeeId:peer,goal:'实施刚拟定的方案',dependsOnTaskIds:[]}
 for(const response of [
  await workerCommand(root.job,'task.assign',assign),
  await a.command('message.send',{teamId:a.team,taskId:root.task,text:'提前派工',mentions:[peer],intent:'assign'}),
  await a.command('task.update',{taskId:root.task,employeeId:peer,state:'queued'}),
  await workerCommand(root.job,'integration.request',{projectId:'unused',sourceRef:'unused',expectedTarget:'unused'})
 ]){
  check(['DISPATCH_APPROVAL_REQUIRED','BUSY'].includes(response.body.error?.code),'unapproved route was not blocked',response)
 }
 const forged=await workerCommand(root.job,'task.assign',{...assign,taskId:''})
 check(forged.status===403,'employee escaped work scope',forged)
 const d=await workerCommand(root.job,'issue.escalate',{problem:'是否可以实施方案',dispatchApproval:true})
 check(d.status===200,'could not request dispatch approval',d)
 await operation(root.job,'finish',{state:'done',result:{}})
 const assessor=await claim()
 check(assessor.payload.employeeId===superior,'approval skipped superior assessment')
 const answer={decisionId:d.body.id,answer:'依据已齐全，建议实施',resolved:true}
 const premature=await a.command('decision.respond',{...answer,approveDispatch:true})
 check(premature.body.error?.code==='DEPENDENCY_UNRESOLVED','approval bypassed the active superior assessment',premature)
 const unauthorized=await workerCommand(assessor,'decision.respond',{...answer,approveDispatch:true})
 check(unauthorized.status===403,'employee approved protected dispatch',unauthorized)
 const advice=await workerCommand(assessor,'decision.respond',answer)
 check(advice.status===200&&advice.body.state==='open','superior recommendation closed human approval',advice)
 await operation(assessor,'finish',{state:'done',result:{}})
 const incomplete=await a.command('decision.respond',answer)
 check(incomplete.status===400&&!(await claim()).id,'plain reply released protected work',incomplete)
 await a.ok('decision.respond',{...answer,answer:'按核查结论实施',approveDispatch:true})
 const resumed=await claim()
 check(resumed.payload.taskId===root.task,'approval did not resume the original task')
 const follow=await workerCommand(resumed,'task.assign',{...assign,decisionId:d.body.id})
 const child=await claim()
 const after=await a.read()
 check(follow.status===200&&child.payload?.taskId===follow.body.id&&after.tasks[child.payload.taskId].dispatchDependencyDecisionId===d.body.id,'approved dispatch missing or unlinked',follow)
 check(after.workItems[after.tasks[root.task].workItemId].dispatchApprovalDecisionId===d.body.id,'permission was not persisted to this work')
 return {decision:d.body.id,task:root.task,dispatched:follow.body.id,deniedActor:unauthorized.status}
})
