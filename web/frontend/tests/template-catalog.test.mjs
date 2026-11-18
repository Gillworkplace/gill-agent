import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source=fs.readFileSync(new URL('../src/team/templateCatalog.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {catalogSkillNames,templateSummary,filterTemplates,sortTemplates}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

const file=(path,purpose='skill')=>({path,purpose})
const template={name:'开发马仔',prompt:'\n## 工作指令\n核验接口并记录测试结果。\n请保留测试依据。',skills:[{name:'交付检查',description:'对照交付清单'}],files:[
 file('skills/frontend-engineer/SKILL.md'),file('skills/testing/SKILL.md'),file('skills/testing/references/guide.md','resource'),file('skills/experimental/SKILL.md','resource')
]}

test('show actual inline and imported Skill names without counting references',()=>{
 assert.deepEqual(catalogSkillNames(template),['交付检查','frontend-engineer','testing'])
 assert.deepEqual(catalogSkillNames({skills:[],files:[file('SKILL.md'),file('notes/check.md')]}),['SKILL.md','check'])
 assert.deepEqual(catalogSkillNames({skills:[]}),[])
})

test('use saved work instructions or an inline Skill description for the summary',()=>{
 assert.equal(templateSummary(template),'核验接口并记录测试结果。')
 assert.equal(templateSummary({...template,prompt:''}),'对照交付清单')
 assert.equal(templateSummary({prompt:'',skills:[],files:template.files}),'')
})

test('filter by template and Skill names case insensitively while keeping source order',()=>{
 const other={name:'业务核验',prompt:'',skills:[{name:'凭证核验'}]}
 assert.deepEqual(filterTemplates([template,other],' FRONTEND '),[template])
 assert.deepEqual(filterTemplates([template,other],'核验'),[other])
 assert.deepEqual(filterTemplates([template,other],'experimental'),[])
 assert.deepEqual(filterTemplates([template,other],' '),[template,other])
})

test('a new revision does not move a template to a different slot',()=>{
 const first={...template,versions:[{updatedAt:'2026-11-18T01:00:00Z'},{updatedAt:'2026-11-18T04:00:00Z'}]}
 const second={name:'后来创建',versions:[{updatedAt:'2026-11-18T02:00:00Z'}]}
 assert.deepEqual(sortTemplates([second,first]),[first,second])
})
