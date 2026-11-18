import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source=fs.readFileSync(new URL('../src/team/templateFileLayout.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {templateImportLayout,templateUploadLayout,groupTemplateFiles}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

test('individually imported Skills have independent entry and reference paths',()=>{
 const paths=['SKILL.md','references/guide.md']
 assert.deepEqual(templateImportLayout('frontend-engineer',paths),{paths:['skills/frontend-engineer/SKILL.md','skills/frontend-engineer/references/guide.md'],suggestedName:''})
 assert.deepEqual(templateImportLayout('test-engineer',paths).paths,['skills/test-engineer/SKILL.md','skills/test-engineer/references/guide.md'])
})

test('Skill collections are rooted at skills and template bundles keep their layout',()=>{
 const entries=['frontend/SKILL.md','testing/SKILL.md','testing/references/sample.md']
 const canonical=entries.map(path=>`skills/${path}`)
 assert.deepEqual(templateImportLayout('skills',entries).paths,canonical)
 assert.deepEqual(templateImportLayout('my-collection',entries).paths,canonical)
 assert.deepEqual(templateImportLayout('my-template',['AGENTS.md',...canonical]),{paths:['AGENTS.md',...canonical],suggestedName:'my-template'})
 assert.deepEqual(templateImportLayout('my-template',['shared.md',...entries]).paths,['shared.md',...entries])
 assert.deepEqual(templateImportLayout('', ['SKILL.md']).paths,['SKILL.md'])
})

test('a selection with two named directories keeps both roots and upload order',()=>{
 const input=['frontend/SKILL.md','testing/SKILL.md','frontend/references/shared.md','testing/references/shared.md']
 assert.deepEqual(templateUploadLayout(input),{paths:input.map(path=>`skills/${path}`),suggestedName:''})
 assert.deepEqual(templateUploadLayout(['AGENTS.md','settings.yml']).paths,['AGENTS.md','settings.yml'])
})

test('package groups keep nested assets and previously saved root Skills readable',()=>{
 const files=['SKILL.md','references/legacy.md','skills/check/SKILL.md','skills/check/references/report.md','skills/check-extra/notes.md'].map(path=>({path}))
 const {packages,shared}=groupTemplateFiles(files)
 assert.deepEqual(packages.map(({directory,files})=>[directory,files.map(file=>file.path)]),[
  ['', ['SKILL.md','references/legacy.md','skills/check-extra/notes.md']],
  ['skills/check',['skills/check/SKILL.md','skills/check/references/report.md']]
 ])
 assert.deepEqual(shared,[])
 assert.deepEqual(groupTemplateFiles(files.slice(2)).shared.map(f=>f.path),['skills/check-extra/notes.md'])
 assert.equal(groupTemplateFiles([...files].reverse()).packages[0].files[0].path,'skills/check/SKILL.md')
})
