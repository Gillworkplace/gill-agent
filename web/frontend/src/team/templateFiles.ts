import { api } from '../api'
import type { TemplateFile, TemplateFilePurpose } from './types'

function asBase64(file:File):Promise<string> {
 return new Promise((resolve,reject)=>{
  const reader=new FileReader()
  reader.onload=()=>resolve(String(reader.result).split(',',2)[1]||'')
  reader.onerror=()=>reject(new Error(`无法读取 ${file.name}`))
  reader.readAsDataURL(file)
 })
}

function purpose(path:string,utf8:boolean,size:number):TemplateFilePurpose {
 if(!utf8||!size)return 'resource'
 const parts=path.toLowerCase().split('/')
 const name=parts.at(-1)
 if(name==='skill.md')return 'skill'
 if(parts[0]==='prompts'||(parts.length===1&&/^(agents|claude|prompt|instructions|system)([._-].*)?\.(md|txt)$/.test(name||'')))
  return 'prompt'
 return 'resource'
}

export async function uploadTemplateFiles(chosen:File[]){
 const files=chosen.filter(file=>!['.DS_Store','Thumbs.db'].includes(file.name))
 const size=files.reduce((total,file)=>total+file.size,0)
 if(!files.length)throw new Error('所选文件夹没有可导入的文件。')
 if(files.length>128||files.some(file=>file.size>8*1024*1024)||size>20*1024*1024)
  throw new Error('最多 128 个文件，单个文件不超过 8 MB，合计不超过 20 MB。')
 const root=files[0].webkitRelativePath.split('/')[0]
 const payload=await Promise.all(files.map(async file=>({
  path:file.webkitRelativePath?file.webkitRelativePath.split('/').slice(1).join('/'):file.name,
  data:await asBase64(file)
 })))
 const result=await api<{files:Omit<TemplateFile,'purpose'>[]}>('/team-workspace/template-files',{files:payload})
 return {root,files:result.files.map(file=>({...file,purpose:purpose(file.path,file.utf8,file.size)}))}
}
