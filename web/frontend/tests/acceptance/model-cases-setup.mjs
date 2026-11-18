import fs from 'node:fs'
import {fixture,work,operation,workerCommand} from './harness.mjs'
const saved=[],pending=[]
const modes=['correct-and-review','review-before-human-decision']
if(process.env.ACCEPTANCE_INCLUDE_GATED_WAIT==='1')modes.push('review-before-human-decision-gated')
for(const mode of modes){
 const a=await fixture({limits:{maxRounds:8,maxSeconds:600}})
 const rule=mode==='correct-and-review'
  ?'按明细事实校核，发现错误通过责任员工修正并再次核查新版本。每位员工登记自己的工作报告并完成自己的任务，不能把派发当成修正已完成。'
  :'本轮不自动改写原报告，发现错误先保存核算依据并上报用户，请用户决定是否修改或发布；用户决定前不要派其他员工或改原产物。'
 await a.ok('team.update',{id:a.team,expectedRevision:1,name:'库存验收-'+mode,prompt:rule,limits:{maxRounds:8,maxSeconds:600}})
 const reviewerPrompt='依据已确认明细独立核查指定产物。发现错误用record_review如实记录其真实版本、@责任员工提出修正请求；保存本轮初审报告并complete_task。收到修正版时核对实际内容和revision，记录新版本复核结果、保存自己的复核报告，再complete_task。遵守当前团队流程，禁止把模型意见说成外部库存系统核验。新建报告省略id。'
 const analystPrompt='收到核查同事的反馈后，按已确认明细计算并修正指定产物。修改须使用实际id和expectedRevision，不能编造ID。将新版本id/revision交回核查同事，并请求复核这个版本，之后complete_task。本轮事实是合成数据，必须保留未验证真实业务的说明。'
 await a.ok('employee.update',{id:a.members[0],expectedRevision:1,prompt:analystPrompt})
 await a.ok('employee.update',{id:a.members[1],expectedRevision:1,prompt:reviewerPrompt})
 const seed=await work(a,a.members[0],'验收输入报告，待核查')
 const artifact=(await workerCommand(seed.job,'artifact.save',{title:'库存汇总（待核查）',content:'已确认明细：期初100件、入库20件、出库30件，没有其他调整项。汇总报告：期末95件。',unchecked:'未独立复核；合成资料未经真实业务核验'})).body.id
 await operation(seed.job,'finish',{state:'stopped',result:{reason:'synthetic input fixture; no model invoked'}})
 const entry={mode,username:a.username,password:a.password,token:a.token,teamId:a.team,members:a.members,templateId:a.template,artifactId:artifact,startedAt:new Date().toISOString()}
 saved.push(entry)
 pending.push({a,entry,requireDispatchApproval:mode==='review-before-human-decision-gated',goal:`请核对库存汇总是否正确，并按团队流程处理。已确认且唯一的事实：期初100、入库20、出库30，没有其他调整项，原报告写期末95件。产物ID ${artifact} revision 1，责任员工 ${a.members[0]}，核查员工为你。仅合成数据，不要求外部业务数据或代码仓库。`})
}
if(!process.env.ACCEPTANCE_INVENTORY_ONLY){
const iteration=await fixture({members:1,limits:{maxRounds:4,maxSeconds:600}})
const task=(await iteration.ok('task.assign',{employeeId:iteration.members[0],goal:'请自迭代你当前采用的模板：保留原工作Prompt，并新增一个通用Skill“核对数据口径”，内容是区分事实、假设和待核实事项，不包含任何业务知识正文。使用revise_template保存真实新版本，明确reason；然后保存改进记录产物（注明尚未验证真实业务效果），最后complete_task。不修改知识、团队流程或创建新员工。'})).id
saved.push({mode:'template-self-iteration',username:iteration.username,password:iteration.password,token:iteration.token,teamId:iteration.team,members:iteration.members,templateId:iteration.template,taskId:task,startedAt:new Date().toISOString()})
}
fs.writeFileSync('/tmp/gill-acceptance-model-cases.json',JSON.stringify(saved),{mode:0o600})
for(const {a,entry,goal,requireDispatchApproval}of pending){entry.taskId=(await a.ok('task.assign',{employeeId:a.members[1],goal,...(requireDispatchApproval?{requireDispatchApproval}:{})})).id;fs.writeFileSync('/tmp/gill-acceptance-model-cases.json',JSON.stringify(saved),{mode:0o600})}
console.log(saved.length+' model scenarios queued: same facts/two workflows'+(process.env.ACCEPTANCE_INVENTORY_ONLY?'':' and real template self-iteration'))
