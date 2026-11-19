import type { Skill, Task, TemplateFile } from './types'

export interface SkillConfigurationRecord {
 id?: string
 name: string
 revision: number
 prompt?: string
 promptFiles?: TemplateFile[]
 templateRevision?: number
 files?: TemplateFile[]
 skills?: Skill[]
}

export interface SkillPreview {
 team: SkillConfigurationRecord | null
 role: SkillConfigurationRecord | null
 employee: SkillConfigurationRecord | null
 taskId?: string
}

export function inFlightTasks(tasks: Task[], teamId: string, memberId: string) {
 const terminal = new Set(['completed', 'failed', 'cancelled', 'stopped'])
 return tasks.filter(task=>task.teamId===teamId && task.employeeId===memberId && !terminal.has(task.state))
  .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'') || a.id.localeCompare(b.id))
}
