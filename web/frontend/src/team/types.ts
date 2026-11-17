export interface Skill { name: string; content: string; description?: string }
export interface Version { revision: number; content?: string; prompt?: string; updatedAt?: string; authorType?: string; authorId?: string }
export interface Team { id: string; name: string; description: string; prompt: string; revision: number; receiverId?: string; limits?: {maxRounds?: number;maxSeconds?: number}; versions?: Version[] }
export interface Employee { id: string; teamId: string; templateId: string; templateRevision: number; name: string; role: string; prompt: string; skills: Skill[]; parentId: string; revision: number; knowledgeIds: string[]; lifecycle?: string }
export interface EmployeeTemplate { id: string; name: string; prompt: string; skills: Skill[]; revision: number; versions: Version[]; reason?: string; originTeamId?: string; authorizedTeamIds?: string[] }
export interface Knowledge { id: string; title: string; content: string; category?: string; revision: number; versions: Version[] }
export interface Document { id: string; title: string; content: string; revision: number; versions: Version[] }
export interface Project { id: string; teamId: string; name: string; description?: string; repositoryUrl?: string; targetBranch?: string; checkCommand?: string; protectedBranches?: string[]; baselineCommit?: string; revision: number; documents?: Record<string, Document> }
export interface Message { id: string; teamId: string; senderType: string; senderId: string; text: string; createdAt: string; kind: string; mentions?: string[]; mentionUser?: boolean; status?: string; decisionId?: string; taskId?: string; replyTo?: string; requiresResponse?: boolean }
export interface Run { id: string; teamId: string; goal: string; state: string; createdAt: string; controlRevision: number; calls: number; manualPaused?: boolean }
export interface Task { id: string; runId: string; teamId: string; employeeId: string; goal: string; state: string; reason?: string; revision: number; executionId?: string; sandboxId?: string; executedActions?: {id: string; state: string; kind: string; result: Record<string, unknown>}[] }
export interface Artifact { id: string; taskId: string; teamId: string; title: string; content: string; unchecked: string; remaining: string; revision: number; versions: Version[] }
export interface Decision { id: string; teamId: string; taskId: string; problem: string; state: string; handlerId: string; answer?: string; attempts?: string[]; options?: string[]; path: string[]; revision?:number; configurationError?:string; invalidReason?:string }
export interface Draft { id: string; busy: boolean; name?: string; prompt?: string; skills?: Skill[]; error?: string; messages: {role: string; content: string}[] }
export interface Check { id: string; artifactId: string; subjectRevision: number; result: string; kind: string; limitations: string }
export interface WorkItem { id: string; teamId: string; runId: string; projectId?: string; goal: string; state: string }
export interface CodeVersion { id: string; taskId: string; projectId: string; commit: string; baseRef: string; bundleKey: string; summary: string }
export interface Integration { id: string; teamId: string; taskId: string; projectId: string; state: string; result?: string }
export interface Workspace {
 revision: number
 updatedAt?: string
 codeVersions: Record<string, CodeVersion>
 teams: Record<string, Team>; templates: Record<string, EmployeeTemplate>; employees: Record<string, Employee>
 knowledge: Record<string, Knowledge>; projects: Record<string, Project>; messages: Record<string, Message>
 runs: Record<string, Run>; tasks: Record<string, Task>; artifacts: Record<string, Artifact>
 decisions: Record<string, Decision>; drafts: Record<string, Draft>; checks: Record<string, Check>
 workItems: Record<string, WorkItem>; integrations: Record<string, Integration>
}
export function emptyWorkspace(): Workspace {
 return {revision:0,codeVersions:{},teams:{},templates:{},employees:{},knowledge:{},projects:{},messages:{},runs:{},tasks:{},artifacts:{},decisions:{},drafts:{},checks:{},workItems:{},integrations:{}}
}
