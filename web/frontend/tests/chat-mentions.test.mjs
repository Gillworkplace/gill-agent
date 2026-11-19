import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source=fs.readFileSync(new URL('../src/team/chatMentions.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
const {mentionQuery,insertMention,updateMentions}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'))

test('mention search follows the caret and allows adjacent Chinese text and full-width @',()=>{
 assert.deepEqual(mentionQuery('请＠张测 看结果',4,[]),{start:1,end:4,search:'张测'})
 assert.deepEqual(mentionQuery('@同事',1,[]),{start:0,end:3,search:''})
 assert.equal(mentionQuery('mail@example.com',16,[]),undefined)
 assert.equal(mentionQuery('请 @张 看看',7,[]),undefined)
})

test('a selection inserts an exact employee token, keeps other text, and does not reopen within the token',()=>{
 const draft=insertMention('请@王 看看',{start:1,end:3,search:'王'},[],{id:'employee-2',name:'王同学'})
 assert.equal(draft.text,'请@王同学 看看')
 assert.equal(draft.caret,6)
 assert.deepEqual(draft.mentions,[{id:'employee-2',start:1,end:5}])
 assert.equal(mentionQuery(draft.text,4,draft.mentions),undefined)
})

test('changing or removing a token drops only the selected identity, including duplicate names',()=>{
 const before='@同事 @同事 '
 const mentions=[{id:'x',start:0,end:3},{id:'y',start:4,end:7}]
 assert.deepEqual(updateMentions(before,'@同事 ',0,mentions),[{id:'y',start:0,end:3}])
 assert.deepEqual(updateMentions(before,'@同事 @同 ',6,mentions),[{id:'x',start:0,end:3}])
 assert.deepEqual(updateMentions(before,'请'+before,1,mentions),[{id:'x',start:1,end:4},{id:'y',start:5,end:8}])
})
