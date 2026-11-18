import type { EmployeeTemplate } from './types'

export function importedSkillName(path:string){
 const parts=path.split('/')
 const file=parts.pop()||''
 if(/^skill\.md$/i.test(file))return parts.at(-1)||file
 return file.replace(/\.[^.]+$/,'')||file
}

export function catalogSkillNames(template:Pick<EmployeeTemplate,'skills'|'files'>){
 const names=[...template.skills.map(skill=>skill.name),
  ...(template.files||[]).filter(file=>file.purpose==='skill').map(file=>importedSkillName(file.path))]
 return [...new Set(names.filter(Boolean))]
}

export function templateSummary(template:Pick<EmployeeTemplate,'prompt'|'skills'>){
 const firstLine=template.prompt.split(/\r?\n/).map(line=>line.trim()).find(line=>line&&!/^#+\s/.test(line))
 return firstLine||template.skills.find(skill=>skill.description?.trim())?.description?.trim()||''
}

export function filterTemplates(templates:EmployeeTemplate[],query:string){
 const term=query.trim().toLowerCase()
 if(!term)return templates
 return templates.filter(template=>[template.name,...catalogSkillNames(template)].some(text=>text.toLowerCase().includes(term)))
}

export function sortTemplates(templates:EmployeeTemplate[]){
 return templates.map(template=>({template,createdAt:Date.parse(template.versions[0]?.updatedAt||'')||0}))
  .sort((a,b)=>a.createdAt-b.createdAt).map(entry=>entry.template)
}
