/** 与后端 REST/WS 载荷对应的核心类型 */

export interface SpaceItem { id: string; type: 'personal' | 'group'; name: string }
export interface SessionItem { id: string; title: string; status?: string }
export interface HistMessage { id?: number; role: 'user' | 'assistant' | 'tool'; content: string }

export interface FileItem {
  id: string; filename: string; size_bytes: number; status: string; direction: 'upload' | 'download'
}
export interface UploadStartResp { uploadId: string; url: string; objectKey: string }
export interface PreviewResp { type: 'text' | 'image' | 'binary'; content?: string; url?: string; filename?: string }

export interface KbItem {
  id: string; title: string; content?: string; type: string; scope: string;
  pinned: boolean; hit_count: number; source: string
}
export interface ExtItem { id: string; name: string; type: string; status: string; version?: number; call_count_7d?: number }
export interface MemberRow { username: string; role: string }
export interface UserRow { id: number; username: string; role: string; status: string }
export interface AuditRow { command?: string; exit_code?: number }
export interface MeInfo { id: number; role: string; custom_instructions?: string }

export interface ChatMsg { self: boolean; who: string; text: string }

/** 会话消息流的渲染条目（聊天流是异构的：用户/AI/系统/工具/审批卡） */
export type StreamItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'ai'; id: number; text: string }
  | { kind: 'sys'; id: number; text: string; undoKbId?: string }
  | { kind: 'tool'; id: number; tool: string; args: string }
  | { kind: 'appr'; id: number; cid: string; command: string; riskLevel: string; reason: string;
      state: 'pending' | 'approved' | 'denied' | 'timeout' | 'always'; left: number }

export interface WsEvent { type: string; payload: any }
