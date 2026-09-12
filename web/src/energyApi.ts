export type EnergyPeriod = 'today' | 'week' | 'month'

export interface EnergyMetricSource {
  entityId: string
  name: string
  unit: string
  lastUpdated: string | null
}

export interface EnergyDevice {
  id: string
  name: string
  entityId: string
  area: { id: string; name: string }
  state: string
  measured: boolean
  powerW: number | null
  todayKwh: number | null
  weekKwh: number | null
  monthKwh: number | null
  energyTotalKwh: number | null
}

export interface EnergyData {
  periods: Record<EnergyPeriod, { label: string; value: number | null; start: string; complete: boolean }>
  current: { powerW: number | null; voltageV: number | null; currentA: number | null; energyTotalKwh: number | null }
  trends: Record<EnergyPeriod, { granularity: 'hour' | 'day'; unit: 'kWh'; points: Array<{ start: string; label: string; value: number | null }> }>
  devices: EnergyDevice[]
  coverage: { measured: number; total: number }
  sources: Record<'power' | 'energyTotal' | 'voltage' | 'current' | 'energyTodaySensor', EnergyMetricSource | null>
  traceability: {
    calculation: string
    historyEntityId: string
    historyEndpoint: string
    timeZone: string
    historyFirstSampleAt: string | null
    dedicatedTodaySensorAvailable: boolean
  }
  dataUpdatedAt: string | null
  updatedAt: string
  stale: boolean
  error?: string
}

export async function getEnergyData(signal?: AbortSignal): Promise<EnergyData> {
  const response = await fetch('/api/energy', { signal, cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || '無法讀取 Home Assistant 能耗資料')
  return payload
}

export async function getEnergyInsight(period: EnergyPeriod): Promise<{ text: string; generatedAt: string }> {
  const response = await fetch('/api/energy/insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ period }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'OpenClaw 暫時無法產生能耗摘要')
  return payload
}
