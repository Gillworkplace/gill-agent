import type { TemplateFile } from './types'

function directoryOf(path:string){
 return path.split('/').slice(0,-1).join('/')
}

function skillDirectories(paths:string[]){
 return new Set(paths.filter(path=>/(^|\/)SKILL\.md$/i.test(path)).map(directoryOf))
}

export function templateImportLayout(root:string,paths:string[]){
 if(!root)return {paths,suggestedName:''}
 const directories=skillDirectories(paths)
 if(directories.has(''))return {paths:paths.map(path=>`skills/${root}/${path}`),suggestedName:''}
 const skillCollection=paths.every(path=>directories.has(path.split('/')[0]))
 if(root.toLowerCase()==='skills'||skillCollection)return {paths:paths.map(path=>`skills/${path}`),suggestedName:''}
 return {paths,suggestedName:root}
}

export function templateUploadLayout(selection:string[]){
 const folders=new Map<string,{index:number;path:string}[]>()
 for(const [index,path] of selection.entries()){
  const slash=path.indexOf('/')
  if(slash<0)continue
  const root=path.slice(0,slash)
  const files=folders.get(root)??[]
  files.push({index,path:path.slice(slash+1)})
  folders.set(root,files)
 }
 const paths=[...selection]
 let suggestedName=''
 for(const [root,files] of folders){
  const layout=templateImportLayout(root,files.map(file=>file.path))
  files.forEach((file,index)=>{paths[file.index]=layout.paths[index]})
  if(folders.size===1)suggestedName=layout.suggestedName
 }
 return {paths,suggestedName}
}

export function groupTemplateFiles(files:TemplateFile[]) {
 const directories=skillDirectories(files.map(file=>file.path))
 const packages=new Map([...directories].map(directory=>[directory,{directory,files:[] as TemplateFile[]}]))
 const shared:TemplateFile[]=[]
 for(const file of files){
  let directory=directoryOf(file.path)
  while(directory&&!directories.has(directory))directory=directoryOf(directory)
  const group=packages.get(directory)
  if(!group)shared.push(file)
  else if(/(^|\/)SKILL\.md$/i.test(file.path))group.files.unshift(file)
  else group.files.push(file)
 }
 return {packages:[...packages.values()],shared}
}
