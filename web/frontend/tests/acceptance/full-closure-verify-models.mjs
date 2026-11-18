import fs from 'node:fs'
import {check,origin,request} from './harness.mjs'

check(origin==='http://127.0.0.1:18080','model verdicts require the isolated fixture gateway')
const accountFile=process.env.ACCEPTANCE_ACCOUNT_FILE||'/tmp/gill-full-closure-final-accounts.json'
const accounts=JSON.parse(fs.readFileSync(accountFile))
const output=process.env.ACCEPTANCE_MODEL_RESULTS||'/tmp/gill-full-final-models.json'
const read=async account=>(await request('/api/v1/team-workspace',undefined,account.token)).body
const command=(account,kind,payload,requestKey)=>request('/api/v1/team-workspace/commands',{kind,payload,requestKey},account.token)
const earlier=[]
const pending=[]
const started=Date.now()

while(Date.now()-started<650000){
 for(const a of accounts){
  if(earlier.some(x=>x.mode===a.mode))continue
  const s=await read(a),root=s.tasks[a.taskId],run=s.runs[root.runId]
  if(a.mode==='approval-closeout'){
   const children=Object.values(s.tasks).filter(t=>t.runId===run.id)
   const decision=Object.values(s.decisions).find(d=>d.taskId===root.id&&d.dispatchApproval)
   const report=s.artifacts[a.artifactId]
   if(decision?.state==='open'){
    check(children.length===1&&root.state==='blocked'&&report.revision===1,'premature work before actual approval')
    const r=await command(a,'decision.respond',{decisionId:decision.id,expectedRevision:decision.revision,resolved:true,approveDispatch:true,
     answer:'明确许可责任员工将指定合成库存报告修订为90件，保留旧版本，随后由原核查员独立复核并完成。'},'full-accept-'+decision.id)
    check(r.status===200,'fixture approval failed',r)
    pending.push({decision:decision.id,preApprovalCalls:run.calls,preApprovalTasks:children.length,originalRevision:report.revision})
   }
   if(run.state==='completed'){
    const review=Object.values(s.checks).find(x=>x.artifactId===report.id&&x.subjectRevision===2&&x.employeeId===a.members[1])
    const finalReport=Object.values(s.artifacts).find(x=>children.some(t=>t.id===x.taskId&&t.purpose==='review')&&x.content.includes('90')&&x.unchecked)
    check(run.calls<=8&&decision?.dispatchApproved===true&&children.length===3&&children.every(t=>t.state==='completed')&&
     report.revision===2&&report.content.includes('90')&&report.versions[0].content.includes('95')&&review&&finalReport,
     'approval closeout missing actual version, review or complete tasks')
    earlier.push({mode:a.mode,passed:true,run:run.id,calls:run.calls,taskStates:children.map(t=>t.state),
     decision:decision.id,source:report.id,revision:report.revision,review:review.id,finalReport:finalReport.id})
   }
  }
  if(a.mode==='blank-code'){
   const project=s.projects[a.projectId]
   const version=Object.values(s.codeVersions).find(v=>v.taskId===root.id&&v.projectId===project.id)
   const report=Object.values(s.artifacts).find(v=>v.taskId===root.id&&v.unchecked)
   const integration=Object.values(s.integrations).find(i=>i.projectId===project.id)
   if(!integration&&run.state==='completed'&&version){
    const result=await command(a,'integration.request',{taskId:root.id,projectId:project.id,sourceRef:version.commit,
     expectedTarget:project.baselineCommit},'full-blank-integrate-'+root.id)
    check(result.status===200,'positive blank project integration was rejected',result)
   }
   if(integration?.state==='integrated'){
    const successfulShell=root.executedActions?.find(e=>e.kind==='shell'&&e.result.exitCode===0)
    check(root.state==='completed'&&run.state==='completed'&&version&&report&&successfulShell&&
     !project.repositoryUrl&&integration.result.check.exitCode===0&&project.baselineCommit===integration.result.commit,'blank project did not preserve its actual completed result')
    earlier.push({mode:a.mode,passed:true,task:root.id,calls:run.calls,version:version.commit,artifact:report.id,
     integration:integration.id,baseline:project.baselineCommit,actualCheck:integration.result.check.exitCode})
   }
   check(!integration||['queued','integrated'].includes(integration.state),'blank Git integration terminal failure',integration)
  }
  check(!['waiting','needs_reconciliation','failed','stopped'].includes(run.state)&&root.state!=='failed','scenario failed before completing',{mode:a.mode,task:root.id,state:run.state,calls:run.calls})
  fs.writeFileSync(output,JSON.stringify({earlier,pending},null,2)+'\n')
 }
 if(earlier.length===accounts.length)break
 await new Promise(resolve=>setTimeout(resolve,2500))
}
check(earlier.length===accounts.length,'at least one scenario remains open',{completed:earlier.map(x=>x.mode)})
for(const result of earlier)console.log(JSON.stringify(result))
