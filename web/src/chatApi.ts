export type ChatRole = 'user' | 'assistant'
export type FlowStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface ChatAttachment {
  id: string
  type: 'image'
  mimeType: 'image/jpeg'
  url: string
  expiresAt: string
  alt: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  createdAt: string
  attachments?: ChatAttachment[]
}

export interface MemoryCandidate {
  id: string
  statement: string
  category: 'lighting' | 'energy' | 'notification' | 'communication' | 'general'
  status: 'pending' | 'active' | 'inactive'
  createdAt: string
}

export interface FlowEvent {
  id: string
  step: string
  status: FlowStatus
  label: string
  detail: string
  createdAt: string
}

interface ChatHistory {
  sessionId: string
  messages: ChatMessage[]
  events: FlowEvent[]
}

interface StreamCallbacks {
  onDelta: (text: string) => void
  onFlow: (event: FlowEvent) => void
  onDone: (message: ChatMessage) => void
  onMemoryCandidate?: (preference: MemoryCandidate) => void
}

const sessionStorageKey = 'openclaw-smart-home-session'

export function getOrCreateSessionId() {
  const stored = window.localStorage.getItem(sessionStorageKey)
  if (stored) return stored
  const created = crypto.randomUUID()
  window.localStorage.setItem(sessionStorageKey, created)
  return created
}

export function saveSessionId(sessionId: string) {
  window.localStorage.setItem(sessionStorageKey, sessionId)
}

export async function getChatHistory(sessionId: string): Promise<ChatHistory> {
  const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/history`, { cache: 'no-store' })
  if (!response.ok) throw new Error('無法載入對話紀錄')
  return response.json()
}

export async function getGatewayHealth() {
  const response = await fetch('/api/health', { cache: 'no-store' })
  if (!response.ok) return { state: 'unavailable', detail: '網站後端無法連線' } as const
  const payload = await response.json()
  return payload.gateway as { state: 'connected' | 'misconfigured' | 'unavailable'; detail: string }
}

export async function resetChatSession(sessionId: string) {
  const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/reset`, { method: 'POST' })
  if (!response.ok) throw new Error('無法建立新對話')
  return response.json() as Promise<{ sessionId: string }>
}

function dispatchSseBlock(block: string, callbacks: StreamCallbacks) {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!dataLines.length) return
  const payload = JSON.parse(dataLines.join('\n'))
  if (eventName === 'delta') callbacks.onDelta(payload.text || '')
  if (eventName === 'flow') callbacks.onFlow(payload)
  if (eventName === 'done') callbacks.onDone(payload.message)
  if (eventName === 'memory_candidate') callbacks.onMemoryCandidate?.(payload.preference)
  if (eventName === 'error') throw new Error(payload.error || 'OpenClaw 執行失敗')
}

export async function streamChat(sessionId: string, message: string, callbacks: StreamCallbacks) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `網站後端回應 ${response.status}`)
  }
  if (!response.body) throw new Error('瀏覽器不支援串流回覆')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : blocks.pop() || ''
    for (const block of blocks) dispatchSseBlock(block, callbacks)
    if (done) break
  }
}
