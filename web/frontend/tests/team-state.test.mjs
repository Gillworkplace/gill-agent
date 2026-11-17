import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const source=fs.readFileSync(new URL('../src/team/presentation.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {mentionsForUser,teamMessages,employeeActivity,latestForTeam,decisionStateLabel,checksForVersion}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
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
