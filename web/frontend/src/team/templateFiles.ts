import { api } from '../api'
import { templateUploadLayout } from './templateFileLayout'
import type { TemplateFile, TemplateFilePurpose } from './types'

function asBase64(file:File):Promise<string> {
 return new Promise((resolve,reject)=>{
  const reader=new FileReader()
  reader.onload=()=>resolve(String(reader.result).split(',',2)[1]||'')
  reader.onerror=()=>reject(new Error(`无法读取 ${file.name}`))
  reader.readAsDataURL(file)
 })
}

function purpose(path:string,utf8:boolean,size:number,forPrompt:boolean):TemplateFilePurpose {
 if(!utf8||!size)return 'resource'
 const parts=path.toLowerCase().split('/')
 const name=parts.at(-1)
 if(name==='skill.md')return 'skill'
 if(parts[0]==='prompts'||(parts.length===1&&(forPrompt?/\.(md|markdown|txt)$/:/^(agents|claude|prompt|instructions|system)([._-].*)?\.(md|txt)$/).test(name||'')))
  return 'prompt'
 return 'resource'
}

export async function uploadTemplateFiles(chosen:File[],forPrompt=false){
 const files=chosen.filter(file=>!['.DS_Store','Thumbs.db'].includes(file.name))
 const size=files.reduce((total,file)=>total+file.size,0)
 if(!files.length)throw new Error('所选文件夹没有可导入的文件。')
 if(files.length>128||files.some(file=>file.size>8*1024*1024)||size>20*1024*1024)
  throw new Error('最多 128 个文件，单个文件不超过 8 MB，合计不超过 20 MB。')
 const {paths,suggestedName}=templateUploadLayout(files.map(file=>file.webkitRelativePath||file.name))
 const payload=await Promise.all(files.map(async (file,index)=>({
  path:paths[index],
  data:await asBase64(file)
 })))
 const result=await api<{files:Omit<TemplateFile,'purpose'>[]}>('/team-workspace/template-files',{files:payload})
 return {suggestedName,files:result.files.map(file=>({...file,purpose:purpose(file.path,file.utf8,file.size,forPrompt)}))}
}

export function mergeTemplateFiles(existing:TemplateFile[],added:TemplateFile[]) {
 const merged=new Map(existing.map(file=>[file.path,file]))
 for(const file of added){
  const previous=merged.get(file.path)
  const purpose=previous&&file.utf8&&file.size?previous.purpose:file.purpose
  merged.set(file.path,{...file,purpose})
 }
 const files=[...merged.values()]
 if(files.length>128||files.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)
  throw new Error('最多可保留 128 个文件，合计不超过 20 MB。')
 return files.sort((a,b)=>a.path.localeCompare(b.path))
}
