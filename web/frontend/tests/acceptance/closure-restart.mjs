import fs from 'node:fs'
import {fixture,check,work,claim,operation,workerCommand,request} from './harness.mjs'

const file='/tmp/gill-closure-restart-fixture.json'
const marker='/tmp/gill-closure-restart-marker.txt'
if(process.argv[2]==='start'){
 const a=await fixture({members:1})
 const {task,job}=await work(a,a.members[0],'测试接收回执前的中断')
 const proof=(await workerCommand(job,'artifact.save',{title:'中断前保存的成果',content:'只使用合成数据。',unchecked:'不代表真实业务'})).body.id
 const intent=await operation(job,'action',{requestKey:'local-test-effect',kind:'shell',input:{fixture:'one local append'}})
 check(intent.body.state==='dispatched','real gateway did not record external intent')
 fs.writeFileSync(marker,'', {flag:'wx',mode:0o600})
 fs.appendFileSync(marker,'write-once\n')
 fs.writeFileSync(file,JSON.stringify({token:a.token,job,task,artifact:proof,at:Date.now()}),{mode:0o600})
 console.log('Persisted the external intent and wrote the synthetic marker, omitted the receipt and stopped the fixture process')
}else if(process.argv[2]==='verify'){
 const {token,job,task,artifact,at}=JSON.parse(fs.readFileSync(file,'utf8'))
 const wait=Math.max(0,41000-(Date.now()-at));if(wait)await new Promise(resolve=>setTimeout(resolve,wait))
 const claimed=await claim()
 check(!claimed.id,'gateway replayed the unresolved external work',claimed)
 const state=await request('/api/v1/team-workspace',undefined,token)
 check(state.body.tasks[task].state==='needs_reconciliation','lost external receipt did not surface for reconciliation')
 check(state.body.artifacts[artifact].revision===1,'previously saved artifact was lost')
 const late=await operation(job,'heartbeat')
 check(late.status===409,'expired worker kept its lease',late)
 const result=await request('/api/v1/team-workspace/commands',{kind:'execution.reconcile',requestKey:crypto.randomUUID(),payload:{executionId:job.id,executionStopped:true,resolution:'succeeded',evidence:'测试动作在本地标记文件恰好写入一行。独立 fixture 进程已退出，平台未发重放请求。'}},token)
 check(result.status===200,'human reconciliation failed',result)
 const after=await request('/api/v1/team-workspace',undefined,token)
 check(after.body.tasks[task].state==='paused','reconciliation implicitly restarted work')
 check(fs.readFileSync(marker,'utf8')==='write-once\n','effect was changed or repeated')
 console.log(JSON.stringify({task,artifact,execution:job.id,passed:true,afterRestart:'needs_reconciliation',afterManualReview:'paused',staleLeaseStatus:late.status,localSideEffectCount:1}))
}else throw Error('Pass start or verify against the isolated gateway')
