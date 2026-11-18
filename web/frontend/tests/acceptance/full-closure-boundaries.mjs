import {check,fixture,operation,request,test,work,workerCommand} from './harness.mjs'
import fs from 'node:fs'

if(!process.env.ACCEPTANCE_KNOWLEDGE_ACCOUNT)await test('AC23-same-project-document-edits-stay-attributed', ['AC-16','AC-22','AC-23'], async()=>{
 const a=await fixture()
 const project=(await a.ok('project.save',{teamId:a.team,name:'并行需求归档'})).id
 const doc=(await a.ok('document.save',{projectId:project,title:'统一需求说明',content:'共同基线'})).id
 const first=await work(a,a.members[0],'需求一',{projectId:project})
 const second=await work(a,a.members[1],'需求二',{projectId:project})
 for(const item of [first,second]){
  const context=(await operation(item.job,'context')).body
  check(context.project.documents[doc].revision===1,'both works must start at the same immutable document revision')
 }
 const changes=await Promise.all([first,second].map((item,index)=>
  workerCommand(item.job,'document.save',{projectId:project,id:doc,expectedRevision:1,title:'统一需求说明',content:'需求成果 '+index})))
 const statuses=changes.map(x=>x.status).sort((a,b)=>a-b)
 check(statuses[0]===200&&statuses[1]===409,'concurrent edits overwrote a document or rejected both',changes)
 const one=changes.findIndex(x=>x.status===200),two=1-one
 const items=[first,second]
 const consumer=(await operation(items[two].job,'context')).body
 check(consumer.project.documents[doc].revision===1,'other work silently adopted the revised document',consumer.project.documents[doc])
 await workerCommand(items[two].job,'document.save',{projectId:project,id:doc,expectedRevision:2,title:'统一需求说明',content:'显式复查后合并需求 '+two})
 const s=await a.read(),saved=s.projects[project].documents[doc]
 const versions=saved.versions
 check(versions.length===3&&versions[1].taskId===items[one].task&&versions[2].taskId===items[two].task&&versions[1].workItemId!==versions[2].workItemId,'document history lost independent demand sources',versions)
 return {project,document:doc,sourceTasks:[versions[1].taskId,versions[2].taskId],conflictStatus:409}
})

if(process.env.ACCEPTANCE_KNOWLEDGE_ACCOUNT){
 const account=JSON.parse(fs.readFileSync(process.env.ACCEPTANCE_KNOWLEDGE_ACCOUNT,'utf8')).find(a=>a.mode==='knowledge-derivative')
 const read=async()=>(await request('/api/v1/team-workspace',undefined,account.token)).body
 const command=(kind,payload)=>request('/api/v1/team-workspace/commands',{kind,payload,requestKey:crypto.randomUUID()},account.token)
 const s=await read(),template=s.templates[account.templateId]
 const marker=/潮汐釉|纸鲸|五月静置|乙色路径/
 check(template.revision>1&&template.originTeamId===account.teamId,'actual model iteration did not save a scoped revision')
 check(Object.values(s.artifacts).some(v=>v.taskId===account.taskId&&v.teamId===account.teamId&&marker.test(v.content)),'first team did not create the actual derived summary')
 check(!marker.test(template.prompt)&&!template.skills.some(x=>marker.test(x.content)),'source content was copied into a generic template')
 const unauthorized=await command('employee.create',{teamId:account.targetTeamId,templateId:template.id,name:'试图未授权采用'})
 check(unauthorized.status===403,'cross-team derived template leaked without authorization',unauthorized)
 console.log(JSON.stringify({case:'AC27-28-actual-derived-template-denied',source:account.sourceId,template:template.id,revision:template.revision,status:unauthorized.status}))
}
