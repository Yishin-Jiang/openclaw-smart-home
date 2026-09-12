import { fetchHaJson, fetchHaRegistries } from './home-assistant.mjs'

const OFFSET_MS = 8 * 60 * 60 * 1000
const PERIOD_KEYS = ['today', 'week', 'month']

function numberOrNull(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function localParts(date) {
  const shifted = new Date(date.getTime() + OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), date: shifted.getUTCDate(), day: shifted.getUTCDay(), hour: shifted.getUTCHours() }
}

function taipeiDate(year, month, date, hour = 0) {
  return new Date(Date.UTC(year, month, date, hour) - OFFSET_MS)
}

function periodStarts(now) {
  const parts = localParts(now)
  const today = taipeiDate(parts.year, parts.month, parts.date)
  const mondayOffset = (parts.day + 6) % 7
  return {
    today,
    week: new Date(today.getTime() - mondayOffset * 86_400_000),
    month: taipeiDate(parts.year, parts.month, 1),
  }
}

function metric(state, expectedUnit) {
  if (!state || ['unknown', 'unavailable'].includes(state.state)) return null
  const value = numberOrNull(state.state)
  if (value === null) return null
  return {
    entityId: state.entity_id,
    name: state.attributes?.friendly_name || state.entity_id,
    value,
    unit: state.attributes?.unit_of_measurement || expectedUnit,
    lastUpdated: state.last_updated || null,
  }
}

function samplesFromHistory(history, currentState) {
  const raw = [...(history?.[0] || [])]
  if (currentState) raw.push(currentState)
  const byTimestamp = new Map()
  for (const item of raw) {
    const timestamp = Date.parse(item.last_updated || item.last_changed || '')
    const value = numberOrNull(item.state)
    if (Number.isFinite(timestamp) && value !== null) byTimestamp.set(timestamp, { timestamp, value })
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function consumptionBetween(samples, startMs, endMs) {
  let baseline = null
  for (const sample of samples) {
    if (sample.timestamp <= startMs) baseline = sample
    else break
  }
  if (!baseline) return null
  let previous = baseline.value
  let total = 0
  for (const sample of samples) {
    if (sample.timestamp <= startMs || sample.timestamp > endMs) continue
    total += sample.value >= previous ? sample.value - previous : Math.max(sample.value, 0)
    previous = sample.value
  }
  return Math.round(total * 1_000_000) / 1_000_000
}

function trendFor(period, start, now, samples) {
  const granularity = period === 'today' ? 'hour' : 'day'
  const stepMs = granularity === 'hour' ? 3_600_000 : 86_400_000
  const points = []
  for (let cursor = start.getTime(); cursor < now.getTime(); cursor += stepMs) {
    const end = Math.min(cursor + stepMs, now.getTime())
    const local = localParts(new Date(cursor))
    const label = granularity === 'hour'
      ? `${String(local.hour).padStart(2, '0')}:00`
      : period === 'week'
        ? ['日', '一', '二', '三', '四', '五', '六'][local.day]
        : `${local.month + 1}/${local.date}`
    points.push({ start: new Date(cursor).toISOString(), label, value: consumptionBetween(samples, cursor, end) })
  }
  return { granularity, unit: 'kWh', points }
}

function normalizeDeviceState(state) {
  if (!state || state.state === 'unknown') return '未知'
  if (state.state === 'unavailable') return '離線'
  if (state.entity_id.startsWith('camera.')) return '連線正常'
  return state.state === 'on' ? '開啟' : state.state === 'off' ? '關閉' : state.state
}

function newestTimestamp(metrics) {
  const timestamps = metrics.map((item) => Date.parse(item?.lastUpdated || '')).filter(Number.isFinite)
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null
}

export function createEnergyClient({ baseUrl, token, timeoutMs = 8000, cacheTtlMs = 30000, entities }) {
  const normalizedBaseUrl = baseUrl?.replace(/\/$/, '')
  let cache = null

  async function fetchEnergy() {
    if (!normalizedBaseUrl || !token) throw new Error('Home Assistant energy API is not configured')
    const now = new Date()
    const starts = periodStarts(now)
    const [registries, states] = await Promise.all([
      fetchHaRegistries(normalizedBaseUrl, token, timeoutMs),
      fetchHaJson(`${normalizedBaseUrl}/api/states`, token, timeoutMs),
    ])
    const stateById = new Map(states.map((state) => [state.entity_id, state]))
    const entityById = new Map(registries.entities.map((entity) => [entity.entity_id, entity]))
    const deviceById = new Map(registries.devices.map((device) => [device.id, device]))
    const areaById = new Map(registries.areas.map((area) => [area.area_id, area]))
    const totalState = stateById.get(entities.total)

    let history = []
    if (totalState) {
      const historyUrl = new URL(`${normalizedBaseUrl}/api/history/period/${encodeURIComponent(starts.month.toISOString())}`)
      historyUrl.searchParams.set('filter_entity_id', entities.total)
      historyUrl.searchParams.set('end_time', now.toISOString())
      historyUrl.searchParams.set('minimal_response', '')
      historyUrl.searchParams.set('no_attributes', '')
      historyUrl.searchParams.set('significant_changes_only', '')
      history = await fetchHaJson(historyUrl.toString(), token, timeoutMs)
    }
    const samples = samplesFromHistory(history, totalState)
    const periodValues = Object.fromEntries(PERIOD_KEYS.map((period) => [period, consumptionBetween(samples, starts[period].getTime(), now.getTime())]))
    const trends = Object.fromEntries(PERIOD_KEYS.map((period) => [period, trendFor(period, starts[period], now, samples)]))

    const configuredMetrics = {
      power: metric(stateById.get(entities.power), 'W'),
      energyTotal: metric(totalState, 'kWh'),
      voltage: metric(stateById.get(entities.voltage), 'V'),
      current: metric(stateById.get(entities.current), 'A'),
      energyTodaySensor: metric(stateById.get(entities.today), 'kWh'),
    }
    const energyRegistry = entityById.get(entities.total) || entityById.get(entities.power)
    const measuredDeviceId = energyRegistry?.device_id || null

    const primaryStates = states.filter((state) => /^(light|switch|camera)\./.test(state.entity_id))
    const seenDevices = new Set()
    const devices = []
    for (const state of primaryStates) {
      const entity = entityById.get(state.entity_id)
      if (entity?.disabled_by || entity?.hidden_by) continue
      const key = entity?.device_id || state.entity_id
      if (seenDevices.has(key)) continue
      seenDevices.add(key)
      const device = entity?.device_id ? deviceById.get(entity.device_id) : null
      const areaId = entity?.area_id || device?.area_id || 'unassigned'
      const measured = entity?.device_id === measuredDeviceId
      devices.push({
        id: key,
        name: device?.name_by_user || device?.name || state.attributes?.friendly_name || state.entity_id,
        entityId: state.entity_id,
        area: { id: areaId, name: areaById.get(areaId)?.name || '未分區' },
        state: normalizeDeviceState(state),
        measured,
        powerW: measured ? configuredMetrics.power?.value ?? null : null,
        todayKwh: measured ? periodValues.today : null,
        weekKwh: measured ? periodValues.week : null,
        monthKwh: measured ? periodValues.month : null,
        energyTotalKwh: measured ? configuredMetrics.energyTotal?.value ?? null : null,
      })
    }

    const sourceMetrics = Object.fromEntries(Object.entries(configuredMetrics).map(([key, value]) => [key, value ? { entityId: value.entityId, name: value.name, unit: value.unit, lastUpdated: value.lastUpdated } : null]))
    cache = {
      periods: {
        today: { label: '今日', value: periodValues.today, start: starts.today.toISOString(), complete: periodValues.today !== null },
        week: { label: '本週', value: periodValues.week, start: starts.week.toISOString(), complete: periodValues.week !== null },
        month: { label: '本月', value: periodValues.month, start: starts.month.toISOString(), complete: periodValues.month !== null },
      },
      current: {
        powerW: configuredMetrics.power?.value ?? null,
        voltageV: configuredMetrics.voltage?.value ?? null,
        currentA: configuredMetrics.current?.value ?? null,
        energyTotalKwh: configuredMetrics.energyTotal?.value ?? null,
      },
      trends,
      devices: devices.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
      coverage: { measured: devices.filter((device) => device.measured).length, total: devices.length },
      sources: sourceMetrics,
      traceability: {
        calculation: '累積電量（total_increasing）於區間起訖的正向差值；計量重設時由重設後數值重新累加',
        historyEntityId: entities.total,
        historyEndpoint: '/api/history/period',
        timeZone: 'Asia/Taipei',
        historyFirstSampleAt: samples[0] ? new Date(samples[0].timestamp).toISOString() : null,
        dedicatedTodaySensorAvailable: Boolean(configuredMetrics.energyTodaySensor),
      },
      dataUpdatedAt: newestTimestamp(Object.values(configuredMetrics)),
      updatedAt: now.toISOString(),
      stale: false,
      source: 'home-assistant',
    }
    return cache
  }

  async function getEnergy() {
    if (cache && Date.now() - Date.parse(cache.updatedAt) < cacheTtlMs) return cache
    try {
      return await fetchEnergy()
    } catch (error) {
      if (cache) return { ...cache, stale: true, error: 'Home Assistant 暫時無法連線，顯示最近一次能耗資料' }
      throw error
    }
  }

  return { getEnergy }
}
