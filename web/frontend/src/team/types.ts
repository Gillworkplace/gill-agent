export interface Skill { name: string; content: string; description?: string }
export type TemplateFilePurpose = 'prompt' | 'skill' | 'resource'
export interface TemplateFile { path: string; key: string; size: number; utf8: boolean; purpose: TemplateFilePurpose }
export interface Version { revision: number; content?: string; prompt?: string; updatedAt?: string; authorType?: string; authorId?: string; files?: TemplateFile[] }
interface ManagedResource { id: string; revision: number; updatedAt?: string }
export interface Team extends ManagedResource { name: string; description: string; prompt: string; promptFiles?: TemplateFile[]; receiverId?: string; limits?: {maxRounds?: number;maxSeconds?: number}; versions?: Version[] }
export interface TeamRole extends ManagedResource { teamId: string; name: string; prompt?: string; promptFiles?: TemplateFile[]; skills?: Skill[] }
export interface OrganizationTemplate extends ManagedResource { type: 'team'|'role'; name: string; description?: string; prompt?: string; promptFiles?: TemplateFile[]; skills?: Skill[]; roles?: Pick<TeamRole,'name'|'prompt'|'promptFiles'|'skills'>[] }
export interface Employee extends ManagedResource { teamId: string; templateId?: string; templateRevision?: number; name: string; role: string; roleId?: string; personality?: string; prompt: string; promptFiles?: TemplateFile[]; skills: Skill[]; files?: TemplateFile[]; parentId: string; knowledgeIds: string[]; lifecycle?: string }
export interface EmployeeTemplate extends ManagedResource { name: string; prompt: string; skills: Skill[]; files?: TemplateFile[]; versions: Version[]; reason?: string; originTeamId?: string; authorizedTeamIds?: string[] }
export interface Knowledge extends ManagedResource { title: string; content: string; category?: string; versions: Version[] }
export interface Document extends ManagedResource { title: string; content: string; versions: Version[] }
export interface LocalDirectory { rootId: string; path: string; label: string; hasGit: boolean }
export interface Project extends ManagedResource { teamId: string; name: string; description?: string; repositoryUrl?: string; targetBranch?: string; checkCommand?: string; protectedBranches?: string[]; baselineCommit?: string; documents?: Record<string, Document>; localDirectory?: LocalDirectory }
export type ChatIntent = 'notify' | 'review' | 'assign'
export interface Message { id: string; teamId: string; senderType: string; senderId: string; text: string; createdAt: string; kind: string; mentions?: string[]; mentionUser?: boolean; status?: string; decisionId?: string; taskId?: string; replyTo?: string; requiresResponse?: boolean; intent?: ChatIntent }
export interface Run { id: string; teamId: string; goal: string; state: string; createdAt: string; controlRevision: number; calls: number; manualPaused?: boolean; workItemId?: string }
export interface KnowledgeRead { sourceId: string; revision: number; readAt: string }
export interface Task { id: string; runId: string; teamId: string; employeeId: string; goal: string; state: string; createdAt?: string; reason?: string; revision: number; workItemId?: string; parentTaskId?: string; executionId?: string; sandboxId?: string; executedActions?: {id: string; state: string; kind: string; result: Record<string, unknown>}[]; employeeSnapshot?: Pick<Employee,'name'|'revision'|'templateId'|'templateRevision'|'personality'|'prompt'|'promptFiles'|'skills'|'files'>; teamSnapshot?: Pick<Team,'name'|'revision'|'prompt'|'promptFiles'>; roleSnapshot?: Pick<TeamRole,'id'|'name'|'revision'|'prompt'|'promptFiles'|'skills'>; knowledgeReads?: KnowledgeRead[] }
export interface Artifact { id: string; taskId: string; teamId: string; title: string; content: string; unchecked: string; remaining: string; revision: number; versions: Version[] }
export interface Decision { id: string; teamId: string; taskId: string; problem: string; state: string; handlerId: string; answer?: string; attempts?: string[]; options?: string[]; path: string[]; revision?:number; configurationError?:string; invalidReason?:string; dispatchApproval?: boolean; dispatchApproved?: boolean }
export interface Draft { id: string; busy: boolean; name?: string; prompt?: string; skills?: Skill[]; files?: TemplateFile[]; error?: string; messages: {role: string; content: string}[] }
export interface Check { id: string; artifactId: string; subjectRevision: number; result: string; kind: string; limitations: string }
export interface WorkItem { id: string; teamId: string; runId: string; projectId?: string; goal: string; state: string; requireDispatchApproval?: boolean; dispatchApprovalDecisionId?: string }
export interface CodeVersion { id: string; taskId: string; projectId: string; commit: string; baseRef: string; bundleKey: string; summary: string }
export interface Integration { id: string; teamId: string; taskId: string; projectId: string; state: string; result?: string }
export interface Workspace {
 revision: number
 updatedAt?: string
 codeVersions: Record<string, CodeVersion>
 teams: Record<string, Team>; teamRoles: Record<string, TeamRole>; organizationTemplates: Record<string,OrganizationTemplate>; templates: Record<string, EmployeeTemplate>; employees: Record<string, Employee>
 knowledge: Record<string, Knowledge>; projects: Record<string, Project>; messages: Record<string, Message>
 runs: Record<string, Run>; tasks: Record<string, Task>; artifacts: Record<string, Artifact>
 decisions: Record<string, Decision>; drafts: Record<string, Draft>; checks: Record<string, Check>
 workItems: Record<string, WorkItem>; integrations: Record<string, Integration>
}
export function emptyWorkspace(): Workspace {
 return {revision:0,codeVersions:{},teams:{},teamRoles:{},organizationTemplates:{},templates:{},employees:{},knowledge:{},projects:{},messages:{},runs:{},tasks:{},artifacts:{},decisions:{},drafts:{},checks:{},workItems:{},integrations:{}}
}
