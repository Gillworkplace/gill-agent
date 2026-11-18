import fs from 'node:fs'
import {fixture,work,operation,workerCommand,check} from './harness.mjs'

const accountFile=process.env.ACCEPTANCE_ACCOUNT_FILE||'/tmp/gill-full-closure-accounts.json'
const scenarios=[]
function remember(a,mode,values){
 scenarios.push({mode,token:a.token,teamId:a.team,members:a.members,...values})
 fs.writeFileSync(accountFile,JSON.stringify(scenarios,null,2),{mode:0o600})
}

async function gatedRepair(){
 const a=await fixture({limits:{maxRounds:8,maxSeconds:600}})
 const owner=a.members[0],reviewer=a.members[1]
 await a.ok('team.update',{id:a.team,expectedRevision:1,name:'带审批的库存纠错',prompt:'先独立核算并归档，再请求用户许可。拿到许可时明确将修改交给责任员工；责任员工修订后邀请复核，最终核查员提交实际新版核查和最终报告。每个人办理完自己的工作后显式完成，避免只交接而保留自身任务。只用确认的合成资料。'})
 await a.ok('employee.update',{id:owner,expectedRevision:1,prompt:'根据任务给定实际产物ID与revision修正库存。修正回执返回新版本后，邀请原核查员实际复核，保存工作报告并显式结束。'})
 await a.ok('employee.update',{id:reviewer,expectedRevision:1,prompt:'初审先核算并提出许可问题。得到许可后，将具体实施派给原责任员工并完成自己的初审任务。收到对新版的核查邀请时，核对实际版本和内容，记录核查，提交最终报告并结束复核任务。'})
 const seed=await work(a,owner,'合成库存验收初稿')
 const receipt=await workerCommand(seed.job,'artifact.save',{title:'库存汇总',content:'已确认：期初100件，入库20件，出库30件。报告期末95件。',unchecked:'只验证合成资料'})
 check(receipt.status===200,'inventory seed was not saved')
 await operation(seed.job,'finish',{state:'stopped',result:{fixture:'pre-existing input report'}})
 return async()=>{
  const task=(await a.ok('task.assign',{employeeId:reviewer,requireDispatchApproval:true,
   goal:`合成库存报告 ${receipt.body.id} v1 的期末是95件。期初100、入库20、出库30，无额外调整。先核算并申请派工许可。许可后将修正派给责任人 ${owner}，之后独立复核修正版。每个负责环节显式完成，保留版本和报告。`})).id
  remember(a,'approval-closeout',{taskId:task,artifactId:receipt.body.id})
 }
}

async function hierarchy(mode){
 const a=await fixture({members:3,limits:{maxRounds:8,maxSeconds:600}})
 const [analyst,lead,head]=a.members
 await a.ok('team.relations',{teamId:a.team,relations:[{id:analyst,parentId:lead,expectedRevision:1},{id:lead,parentId:head,expectedRevision:1},{id:head,parentId:'user',expectedRevision:1}]})
 const leadPrompt=mode==='direct'?'你拥有此合成批次的书面规则：原材料凭据齐全采用方案A。依据此规则给出明确决定。':'你的职责是检查已知条件，但你缺少决策所需的业务取舍规则。记录已有检查并逐级升级，不替任何人猜测。'
 const headPrompt=mode==='upper'?'你拥有最终书面规则：只采用已核实的资料，选择方案A。说明依据并明确解决。':'你没有委托人的业务取舍标准。给出已知影响，简洁说明仍缺依据并向用户上报。'
 await a.ok('employee.update',{id:lead,expectedRevision:2,prompt:leadPrompt})
 await a.ok('employee.update',{id:head,expectedRevision:2,prompt:headPrompt})
 const task=(await a.ok('task.assign',{employeeId:analyst,goal:'合成资料整理需在方案A只用已核实资料和方案B同时采用待核实资料之间选择。你没有取舍规则，先向直属上级评估，准确记录理由和影响。收到明确结果后用结果完成并归档一份报告。'})).id
 remember(a,'hierarchy-'+mode,{taskId:task})
}

async function blankCode(){
 const a=await fixture({members:1,limits:{maxRounds:8,maxSeconds:900}})
 const projectId=(await a.ok('project.save',{teamId:a.team,name:'从空仓库开始的报价工具',targetBranch:'main',
  checkCommand:'test "$(sh quote.sh 12 3)" = 36 && test "$(sh quote.sh 0 3)" = 0 && ! sh quote.sh bad 3'})).id
 const task=(await a.ok('task.assign',{employeeId:a.members[0],projectId,
  goal:'这是一个全新的空白项目。从零创建 quote.sh，输入单价和数量两个非负整数，输出乘积，非法输入非零退出。用真实 shell 核对 12×3、0×3 和非法输入，再用 save_version 保存实际代码版本，归档检查证据并完成。'})).id
 remember(a,'blank-code',{taskId:task,projectId})
}

async function knowledge(){
 const a=await fixture({members:1,limits:{maxRounds:6,maxSeconds:600}})
 const target=(await a.ok('team.create',{name:'未获分享授权的独立团队'})).id
 const other=(await a.ok('employee.create',{teamId:target,templateId:a.template,name:'独立员工'})).id
 const source=(await a.ok('knowledge.save',{title:'合成路由校验规则',content:'合成内部用例：潮汐釉标记与纸鲸九号批次关联。只有同时达到四档和五月静置期才选乙色路径。该资料只挂载给本队审阅人员。'})).id
 await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
 const task=(await a.ok('task.assign',{employeeId:a.members[0],goal:'检索挂载的合成路由规则，在本队归档用你自己的话写的摘要，并将通用的「核对条件和事实来源」方法加入自己的模板 Skills。按平台规定保留团队边界和原知识。不写入知识库，不把具体内部事实放进通用模板。保存实际产物并完成。'})).id
 remember(a,'knowledge-derivative',{taskId:task,sourceId:source,targetTeamId:target,other,templateId:a.template})
}

const selection=new Set((process.env.ACCEPTANCE_MODEL_CASES||'approval-closeout,hierarchy-direct,hierarchy-upper,hierarchy-human,blank-code,knowledge-derivative').split(','))
if(selection.has('approval-closeout'))await (await gatedRepair())()
for(const mode of ['direct','upper','human'])if(selection.has('hierarchy-'+mode))await hierarchy(mode)
if(selection.has('blank-code'))await blankCode()
if(selection.has('knowledge-derivative'))await knowledge()
console.log(JSON.stringify({queued:scenarios.map(x=>x.mode)}))
