import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source=fs.readFileSync(new URL('../src/components/promptFolder.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {readPromptFolder}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))
const textFile=(path,value)=>Object.assign(new File([value],path.split('/').at(-1)),{webkitRelativePath:path})

test('directory text import keeps existing text and labels nested files in path order',async()=>{
 const files=[textFile('rules/notes/b.md','second'),textFile('rules/a.txt','first'),textFile('rules/.DS_Store','ignored')]
 assert.equal(await readPromptFolder(files,'existing'), 'existing\n\n[rules/a.txt]\nfirst\n\n[rules/notes/b.md]\nsecond')
})

test('text-only inputs reject an unsupported file or input exceeding the existing limit',async()=>{
 await assert.rejects(readPromptFolder([textFile('rules/logo.png','\0image')],''),/UTF-8/)
 await assert.rejects(readPromptFolder([textFile('rules/a.md','first')],'existing',10),/10/)
})
