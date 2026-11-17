import fs from 'node:fs'
import {fixture,work,operation,workerCommand} from './harness.mjs'
const a=await fixture({members:3})
await a.ok('team.update',{id:a.team,expectedRevision:1,name:'验收业务团队',description:'负责资料分析项目 · 任意产品或模块说明',prompt:'依事实开展工作，决策向上级逐级反馈。'})
const other=(await a.ok('team.create',{name:'验收内容团队',description:'另一独立工作范围'})).id
await a.ok('employee.create',{teamId:other,templateId:a.template,name:'另一团队成员'})
const source=(await a.ok('knowledge.save',{title:'验收只读知识',content:'合成库存：期初100、入库20、出库30。'})).id
await a.ok('knowledge.mount',{employeeId:a.members[0],sourceId:source})
const project=(await a.ok('project.save',{teamId:a.team,name:'验收资料项目',description:'项目文档归档验收'})).id
const doc=(await a.ok('document.save',{projectId:project,title:'需求说明',content:'版本A：合成资料'})).id
await a.ok('document.save',{projectId:project,id:doc,expectedRevision:1,title:'需求说明',content:'版本B：补充统计口径'})
const root=await work(a,a.members[0],'确认本期资料采用范围',{projectId:project})
const artifact=(await workerCommand(root.job,'artifact.save',{title:'待核查结果',content:'v1：结果90件',unchecked:'未核对真实业务'})).body.id
await workerCommand(root.job,'check.record',{artifactId:artifact,subjectRevision:1,result:'通过（仅模型意见）',limitations:'未执行外部工具'})
await workerCommand(root.job,'artifact.save',{id:artifact,expectedRevision:1,title:'待核查结果',content:'v2：结果95件，待复核',unchecked:'新版尚未检查'})
const decision=(await workerCommand(root.job,'issue.escalate',{problem:'两种方案的资料范围不明确，需用户决定',attempts:['已核对两份合成资料'],options:['只采用核实资料','补证后继续']})).body.id
await operation(root.job,'finish',{state:'done',result:{}})
await a.ok('run.control',{runId:(await a.read()).tasks[root.task].runId,operation:'pause'})
fs.writeFileSync('/tmp/gill-acceptance-browser.json',JSON.stringify({username:a.username,password:a.password,token:a.token,teamId:a.team,otherTeamId:other,members:a.members,projectId:project,sourceId:source,artifactId:artifact,decisionId:decision,taskId:root.task}),{mode:0o600})
console.log('GUI fixtures prepared via real API; model outputs were not fabricated or claimed')
