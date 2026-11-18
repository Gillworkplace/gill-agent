import fs from 'node:fs'
import crypto from 'node:crypto'

export const origin=process.env.ACCEPTANCE_URL||'http://127.0.0.1:18080'
export const results=process.env.ACCEPTANCE_RESULTS||'/tmp/gill-acceptance-results.jsonl'
const values={}
for(const line of fs.readFileSync('deploy/.env','utf8').split('\n')){
 const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
 if(m)values[m[1]]=m[2].replace(/^["']|["']$/g,'')
}
const workerId='acceptance-protocol'
const activeJobs=new Map()
export function check(condition,message,details={}){
 if(!condition){const error=new Error(message);error.details=details;throw error}
}
export async function request(path,body,token,secret){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',
  headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(secret?{'X-Team-Worker-Secret':secret}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
 return {status:response.status,body:await response.json().catch(()=>({}))}
}
export async function account(){
 const username='acc_'+Date.now()+'_'+crypto.randomBytes(3).toString('hex'),password=crypto.randomBytes(16).toString('hex')
 const registered=await request('/api/v1/auth/register',{username,password})
 check(registered.status===200,'test account registration',registered)
 const login=await request('/api/v1/auth/login',{username,password})
 check(login.status===200&&login.body.token,'test login failed',{status:login.status})
 const token=login.body.token
 return {username,password,token,
  async read(){const r=await request('/api/v1/team-workspace',undefined,token);check(r.status===200,'workspace read failed',r);return r.body},
  command(kind,payload,key=crypto.randomUUID()){return request('/api/v1/team-workspace/commands',{kind,payload,requestKey:key},token)},
  async ok(kind,payload,key){const r=await this.command(kind,payload,key);check(r.status===200,kind+' unexpectedly failed',r);return r.body}
 }
}
export async function fixture({members=2,limits}={}){
 const a=await account()
 a.team=(await a.ok('team.create',{name:'验收团队',description:'合成资料验收',prompt:'根据事实自主协作，不确定逐级升级。',...(limits?{limits}:{})})).id
 a.template=(await a.ok('template.save',{name:'开放能力模板',prompt:'核实来源并标明未验证事项。',skills:[{name:'证据核查',content:'区分来源事实与推断。'}]})).id
 a.members=[]
 for(let i=0;i<members;i++)a.members.push((await a.ok('employee.create',{teamId:a.team,templateId:a.template,name:'员工'+i,parentId:'user'})).id)
 return a
}
export async function claim(){
 if(origin!=='http://127.0.0.1:18080')throw Error('Simulated claims are restricted to the dedicated acceptance instance')
 const r=await request('/internal/team-worker/claim',{workerId},undefined,values.GILL_TEAM_WORKER_SECRET)
 check(r.status===200,'claim failed',r)
 const job=r.body;if(typeof job.payload==='string')job.payload=JSON.parse(job.payload)
 if(job.id)activeJobs.set(job.id,job)
 return job
}
export async function operation(job,name,body={}){
 const r=await request('/internal/team-worker/jobs/'+job.id+'/'+name,{...body,workerId,fence:job.fence},undefined,values.GILL_TEAM_WORKER_SECRET)
 if(name==='finish')activeJobs.delete(job.id)
 return r
}
export async function workerCommand(job,kind,payload,key=crypto.randomUUID()){
 return operation(job,'command',{kind,payload,requestKey:key})
}
export async function work(a,employee=a.members[0],goal='验收任务',extra={}){
 const task=(await a.ok('task.assign',{employeeId:employee,goal,...extra})).id
 const job=await claim();check(job.payload?.taskId===task,'fixture queue is not isolated',{task,payload:job.payload})
 return {task,job}
}
export async function drain(){
 for(let i=0;i<100;i++){
  const job=await claim();if(!job.id)return
  await operation(job,'finish',{state:'stopped',result:{reason:'acceptance fixture teardown; no model or tool was invoked'}})
 }
 throw Error('fixture queue drain limit exceeded')
}
export async function test(id,ac,run){
 const startedAt=new Date().toISOString();let entry
 try{entry={id,ac,status:'passed',startedAt,details:await run()}}
 catch(error){entry={id,ac,status:'failed',startedAt,error:error.message,details:error.details||{}};process.exitCode=1}
 entry.finishedAt=new Date().toISOString()
 fs.appendFileSync(results,JSON.stringify(entry)+'\n')
 console.log(JSON.stringify(entry))
 for(const job of activeJobs.values())await operation(job,'finish',{state:'stopped',result:{reason:'acceptance assertion completed; fixture teardown'}})
 await drain()
}
