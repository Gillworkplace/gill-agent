import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source=fs.readFileSync(new URL('../src/team/teamSkillPreview.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {inFlightTasks}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

test('active preview offers only in-flight tasks for the selected member and team',()=>{
 const task=(id,createdAt,state='queued',teamId='t',employeeId='a')=>({id,createdAt,state,employeeId,teamId})
 const input=[task('first','2026-11-18T10:00:00Z'),task('second','2026-11-18T11:00:00Z','blocked'),
  task('finished','2026-11-18T12:00:00Z','completed'),task('another','2026-11-18T12:00:00Z','queued','t','b'),
  task('elsewhere','2026-11-18T12:00:00Z','queued','other')]
 assert.deepEqual(inFlightTasks(input,'t','a').map(t=>t.id),['second','first'])
})
