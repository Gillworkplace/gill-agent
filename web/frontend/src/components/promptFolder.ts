export async function readPromptFolder(selection: File[], current: string, maxLength = 100000) {
  const path = (file: File) => file.webkitRelativePath || file.name
  const files = selection.filter(file => !['.DS_Store', 'Thumbs.db'].includes(file.name))
  if (!files.length) throw new Error('所选文件夹没有可导入的文件。')
  if (files.reduce((total, file) => total + file.size, 0) > maxLength * 3) {
    throw new Error(`导入后的正文最多可包含 ${maxLength} 字。`)
  }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const blocks: string[] = []
  for (const file of files.sort((a, b) => path(a).localeCompare(path(b)))) {
    let content: string
    try {
      content = decoder.decode(await file.arrayBuffer())
      if (content.includes('\0')) throw new Error('binary')
    } catch {
      throw new Error(`${path(file)} 无法读取为 UTF-8 文本。`)
    }
    if (content.trim()) blocks.push(`[${path(file)}]\n${content}`)
  }
  if (!blocks.length) throw new Error('所选文件夹没有可导入的文本。')
  const merged = [current, ...blocks].filter(Boolean).join('\n\n')
  if (merged.length > maxLength) throw new Error(`导入后的正文最多可包含 ${maxLength} 字。`)
  return merged
}
