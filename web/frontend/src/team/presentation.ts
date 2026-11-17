interface Mention { teamId: string; mentionUser?: boolean; status?: string }
interface Dated { teamId: string; createdAt: string }
interface Activity { employeeId: string; state: string }
export function latestForTeam<T extends Dated>(items: Record<string,T>, teamId: string): T | undefined {
 return Object.values(items).filter(x=>x.teamId===teamId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1)
}
export function mentionsForUser(messages: Record<string, Mention>, teamId?: string): number {
 return Object.values(messages).filter(m => (!teamId || m.teamId === teamId) && m.mentionUser === true && m.status === 'needs-user').length
}
export function teamMessages<T extends Dated>(messages: Record<string, T>, teamId: string): T[] {
 return Object.values(messages).filter(m => m.teamId === teamId).sort((a,b) => a.createdAt.localeCompare(b.createdAt))
}
export function employeeActivity(tasks: Record<string, Activity> | undefined, id: string): string {
 if (!tasks) return 'unknown'
 const states = Object.values(tasks).filter(t => t.employeeId === id).map(t => t.state)
 if (states.includes('unknown')) return 'unknown'
 if (states.some(s => s === 'running' || s === 'queued')) return 'working'
 if (states.some(s => ['blocked','paused','awaiting_followup','needs_reconciliation'].includes(s))) return 'waiting'
 return 'idle'
}
export function stateLabel(state: string): string {
 return ({queued:'排队中',running:'工作中',active:'进行中',blocked:'等待处理',completed:'已完成',failed:'失败',
 cancelled:'已取消',idle:'空闲',working:'工作中',waiting:'等待处理',unknown:'状态未知',awaiting_followup:'待补充后续处理',
 pause_requested:'正在暂停',paused:'已暂停',stop_requested:'正在停止',stopped:'已停止',needs_reconciliation:'结果待核实',
 responded:'已响应',done:'轮次已结束'} as Record<string,string>)[state] || state
}
export function decisionStateLabel(state: string): string {
 return ({open:'等待评估',applied:'已记录并应用决定',superseded:'已失效，未应用'} as Record<string,string>)[state]||'决定状态待核实'
}
export function checksForVersion<T extends {artifactId:string;subjectRevision:number}>(checks:Record<string,T>,artifactId:string,revision:number):T[] {
 return Object.values(checks).filter(c=>c.artifactId===artifactId&&Number.isInteger(c.subjectRevision)&&c.subjectRevision>0&&c.subjectRevision===revision)
}
