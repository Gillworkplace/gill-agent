import fs from 'node:fs'
const [accountsPath,outputPath]=process.argv.slice(2)
if(!accountsPath||!outputPath)throw Error('Provide this test run account file and sanitized output path')
const output=[]
for(const c of JSON.parse(fs.readFileSync(accountsPath,'utf8'))){
 const response=await fetch((process.env.ACCEPTANCE_URL||'http://127.0.0.1:18080')+'/api/v1/team-workspace',{headers:{Authorization:'Bearer '+c.token}})
 if(!response.ok)throw Error('workspace read '+response.status)
 const s=await response.json(),root=s.tasks[c.taskId],run=root?s.runs[root.runId]:null
 const tasks=Object.values(s.tasks||{}).filter(t=>t.runId===run?.id)
 const entry={mode:c.mode,at:new Date().toISOString(),fixture:{teamId:c.teamId,taskId:c.taskId,artifactId:c.artifactId,templateId:c.templateId,projectId:c.projectId,members:c.members},...Object.fromEntries(['runs','tasks','artifacts','decisions','checks','templates','employees','knowledge','messages','projects'].map(k=>[k,Object.values(s[k]||{})]))}
 const source=s.artifacts[c.artifactId],checks=Object.values(s.checks||{}),artifacts=Object.values(s.artifacts||{})
 const open=Object.values(s.decisions||{}).filter(d=>d.taskId===root?.id&&d.state==='open')
 let conditions={}
 if(c.mode==='correct-and-review'){
  const followups=tasks.filter(t=>t.id!==root.id&&t.employeeId===root.employeeId)
  conditions={runCompleted:run.state==='completed',allWorkCompleted:tasks.length>=3&&tasks.every(t=>t.state==='completed'),sourceCorrected:source?.revision===2&&source.content.includes('90')&&source.versions.find(v=>v.revision===source.revision)?.authorId===c.members[0],historicalErrorRetained:source?.versions.some(v=>v.revision===1&&v.content.includes('95')),originalVersionReviewed:checks.some(x=>x.artifactId===source?.id&&x.subjectRevision===1),newVersionReviewed:checks.some(x=>x.artifactId===source?.id&&x.subjectRevision===2&&x.employeeId===root.employeeId),finalReviewReport:artifacts.some(a=>followups.some(t=>t.id===a.taskId)&&a.id!==source?.id&&a.content.includes('90')&&a.unchecked),withinOriginalBudget:run.calls<=8,noOpenDecision:open.length===0}
 }else if(c.mode==='review-before-human-decision'||c.mode==='review-before-human-decision-gated'){
  conditions={actualOpenUserDecision:open.some(d=>d.handlerId==='user'),blockedWork:root.state==='blocked',noExtraTask:tasks.length===1,sourceUnchanged:source?.revision===1&&source.content==='已确认明细：期初100件、入库20件、出库30件，没有其他调整项。汇总报告：期末95件。',calculationSaved:artifacts.some(a=>a.id!==source?.id&&a.content.includes('90')&&a.unchecked),withinOriginalBudget:run.calls<=8}
  if(c.mode.endsWith('-gated')){
   const work=s.workItems[root.workItemId]
   conditions.approvalGatePending=work?.requireDispatchApproval===true&&!work.dispatchApprovalDecisionId&&open.some(d=>d.dispatchApproval===true)
  }
 }else if(c.mode==='template-self-iteration'){
  const template=s.templates[c.templateId],employee=s.employees[c.members[0]]
  conditions={runCompleted:run.state==='completed',actualNewRevision:template.revision===2,oldPromptRetained:template.prompt.includes('核实来源'),oldSkillRetained:template.skills.some(x=>x.name==='证据核查'),newSkill:template.skills.some(x=>x.name==='核对数据口径'),employeeSnapshotUnchanged:employee.templateRevision===1,noNewEmployeeOrKnowledge:Object.keys(s.employees).length===1&&Object.keys(s.knowledge).length===0,withinOriginalBudget:run.calls<=4}
 }else throw Error('Unsupported model fixture mode: '+c.mode)

 const satisfied=Object.values(conditions).every(Boolean),terminal=['completed','waiting','needs_reconciliation','failed','stopped'].includes(run.state)||(root.state==='blocked'&&open.length>0)
 entry.oracle={conditions,preliminaryPassed:satisfied,boundedStatus:satisfied?'passed':terminal?'failed':'pending',note:'Final business judgment also checks semantic content and the post-decision observation window.'}
 output.push(entry)
 console.log(JSON.stringify({mode:c.mode,runId:run?.id,calls:run?.calls,runState:run?.state,taskStates:tasks.map(t=>t.state),oracle:entry.oracle}))
}
fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n')
