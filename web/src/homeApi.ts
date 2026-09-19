export type HomeDeviceKind = 'light' | 'outlet' | 'camera'
export type HomeDeviceStatus = 'on' | 'off' | 'offline' | 'unknown'

export interface HomeDevice {
  id: string
  entityId: string | null
  deviceId: string | null
  name: string
  kind: HomeDeviceKind
  status: HomeDeviceStatus
  statusLabel: string
  available: boolean
  lastUpdated: string | null
  source: 'home-assistant'
  cameraMode: 'connection-only' | null
}

export interface HomeArea {
  id: string
  name: string
  devices: HomeDevice[]
}

export interface HomeStatus {
  areas: HomeArea[]
  summary: {
    areas: number
    connected: number
    total: number
    offline: number
    unknown: number
  }
  updatedAt: string
  stale: boolean
  cached?: boolean
  ageSeconds?: number
  source: 'home-assistant'
  error?: string
}

export async function getHomeStatus(signal?: AbortSignal): Promise<HomeStatus> {
  const response = await fetch('/api/home/status', { signal, headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || '無法讀取 Home Assistant 狀態')
  return body
}
