import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=fs.readFileSync(new URL('../src/team/presentation.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {mentionsForUser,teamMessages,employeeActivity,latestForTeam,decisionStateLabel,checksForVersion,decisionOpinions,workspaceFreshness,latestKnowledgeReads,chatRouting}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
test('latest progress follows timestamps rather than JSON object key order',()=>{
 const runs={newest:{teamId:'t',createdAt:'2026-11-17T02:00:00Z'},older:{teamId:'t',createdAt:'2026-11-17T01:00:00Z'},other:{teamId:'other',createdAt:'2026-11-18T00:00:00Z'}}
 assert.equal(latestForTeam(runs,'t'),runs.newest)
})

test('employee mentions never count as human decisions', () => {
 const messages={a:{id:'a',teamId:'t',mentions:['e'],status:'needs-user'},b:{id:'b',teamId:'t',mentionUser:true,status:'needs-user'},c:{id:'c',teamId:'t',mentionUser:true,status:'responded'}}
 assert.equal(mentionsForUser(messages,'t'),1)
})
test('message selection is scoped to selected team', () => {
 const messages={a:{id:'a',teamId:'one',createdAt:'2026-11-17T01:00:00Z'},b:{id:'b',teamId:'two',createdAt:'2026-11-17T00:00:00Z'}}
 assert.deepEqual(teamMessages(messages,'one').map(x=>x.id),['a'])
})
test('unknown activity is not rendered as idle', () => {
 assert.equal(employeeActivity(undefined,'e'),'unknown')
 assert.equal(employeeActivity({a:{employeeId:'e',state:'unknown'}},'e'),'unknown')
 assert.equal(employeeActivity({a:{employeeId:'e',state:'blocked'}},'e'),'waiting')
 assert.equal(employeeActivity({a:{employeeId:'e',state:'running'}},'e'),'working')
 assert.equal(employeeActivity({},'e'),'idle')
})
test('superseded decisions never appear applied or resolved',()=>{
 assert.equal(decisionStateLabel('superseded'),'已失效，未应用')
 assert.equal(decisionStateLabel('open'),'等待评估')
 assert.equal(decisionStateLabel('applied'),'已记录并应用决定')
})
test('only evidence for the displayed artifact version is current',()=>{
 const checks={a:{artifactId:'a',subjectRevision:1},b:{artifactId:'a',subjectRevision:2},wrong:{artifactId:'b',subjectRevision:2},invalid:{artifactId:'a',subjectRevision:999}}
 assert.deepEqual(checksForVersion(checks,'a',2),[checks.b])
 assert.deepEqual(checksForVersion(checks,'a',1),[checks.a])
})

test('decision details show persisted opinions for the exact issue and team in chronological order',()=>{
 const message={teamId:'t',decisionId:'d',kind:'decision-response',senderType:'employee'}
 const items={later:{...message,id:'later',createdAt:'2026-11-18T01:01:00Z'},earlier:{...message,id:'earlier',createdAt:'2026-11-18T01:00:00Z'},otherTeam:{...message,teamId:'other'},otherIssue:{...message,decisionId:'other'},escalation:{...message,kind:'escalation'}}
 assert.deepEqual(decisionOpinions(items,{id:'d',teamId:'t'}).map(m=>m.id),['earlier','later'])
})

test('unknown or failed observations cannot claim that employees are idle',()=>{
 assert.equal(workspaceFreshness('',false),'unknown')
 assert.equal(workspaceFreshness('invalid',false),'unknown')
 assert.equal(workspaceFreshness('2026-11-18T01:00:00Z',true),'stale')
 assert.equal(workspaceFreshness('2026-11-18T01:00:00Z',false),'fresh')
})

test('knowledge history distinguishes versions and takes the last actual read for each',()=>{
 const first={sourceId:'a',revision:1,readAt:'2026-11-18T01:00:00Z'}
 const older={sourceId:'a',revision:2,readAt:'2026-11-18T01:05:00Z'}
 const latest={sourceId:'a',revision:2,readAt:'2026-11-18T01:10:00Z'}
 assert.deepEqual(latestKnowledgeReads([latest,first,older]),[first,latest])
 assert.deepEqual(latestKnowledgeReads(undefined),[])
})

test('dispatch approval is sent only when starting a new, explicitly assigned goal',()=>{
 assert.deepEqual(chatRouting('assign',true,false),{intent:'assign',requireDispatchApproval:true})
 assert.deepEqual(chatRouting('assign',true,true),{intent:'assign'})
 assert.deepEqual(chatRouting('review',true,false),{intent:'review'})
 assert.deepEqual(chatRouting('notify',true,false),{intent:'notify'})
})
