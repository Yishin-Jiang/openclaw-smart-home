export type PreferenceCategory = 'lighting' | 'energy' | 'notification' | 'communication' | 'general'
export type PreferenceStatus = 'pending' | 'active' | 'inactive'

export interface Preference {
  id: string
  statement: string
  category: PreferenceCategory
  status: PreferenceStatus
  source: string
  sourceSessionId: string | null
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
  lastUsedAt: string | null
}

export interface ActivityRecord {
  id: string
  sessionId: string | null
  source: string
  type: string
  requestSummary: string
  entityIds: string[]
  outcome: string
  durationMs: number | null
  createdAt: string
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  const body = response.status === 204 ? null : await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `網站後端回應 ${response.status}`)
  return body as T
}

export async function getPreferences() {
  return jsonRequest<{ items: Preference[] }>('/api/preferences', { cache: 'no-store' })
}

export async function createPreferenceCandidate(statement: string, category: PreferenceCategory) {
  return jsonRequest<{ preference: Preference }>('/api/preferences/candidates', {
    method: 'POST', body: JSON.stringify({ statement, category }),
  })
}

export async function confirmPreference(id: string) {
  return jsonRequest<{ preference: Preference }>(`/api/preferences/${encodeURIComponent(id)}/confirm`, { method: 'POST' })
}

export async function updatePreference(id: string, changes: Partial<Pick<Preference, 'statement' | 'category' | 'status'>>) {
  return jsonRequest<{ preference: Preference }>(`/api/preferences/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  })
}

export async function deletePreference(id: string) {
  await jsonRequest<null>(`/api/preferences/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function getActivity(limit = 100) {
  return jsonRequest<{ items: ActivityRecord[]; retentionDays: number; maxRecords: number }>(`/api/activity?limit=${limit}`, { cache: 'no-store' })
}

export async function deleteActivity(id: string) {
  await jsonRequest<null>(`/api/activity/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function clearActivity() {
  await jsonRequest<null>('/api/activity', { method: 'DELETE' })
}
