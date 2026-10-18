/** 后端 REST 访问层：统一携带 JWT、统一错误抛出 */

const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message) }
}

export function token(): string { return localStorage.getItem('gill_token') || '' }

export async function api<T = any>(path: string, body?: any, method?: string): Promise<T> {
  const r = await fetch(BASE + path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: 'Bearer ' + token() } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(d?.error?.code || 'HTTP-' + r.status, d?.error?.message || ('HTTP ' + r.status), r.status)
  return d as T
}
