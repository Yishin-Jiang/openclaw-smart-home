const DEFAULT_DOMAINS = ['light', 'switch', 'camera']

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function websocketUrl(baseUrl) {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/websocket'
  url.search = ''
  return url.toString()
}

export async function fetchHaJson(url, token, timeoutMs) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Home Assistant REST API returned ${response.status}`)
  return response.json()
}

export function fetchHaRegistries(baseUrl, token, timeoutMs) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(baseUrl))
    const commands = new Map([
      [1, 'config/area_registry/list'],
      [2, 'config/device_registry/list'],
      [3, 'config/entity_registry/list'],
    ])
    const results = new Map()
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.close()
      if (error) reject(error)
      else resolve(value)
    }

    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return finish(new Error('Home Assistant WebSocket returned invalid JSON'))
      }

      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }))
        return
      }
      if (message.type === 'auth_invalid') return finish(new Error('Home Assistant authentication failed'))
      if (message.type === 'auth_ok') {
        for (const [id, type] of commands) socket.send(JSON.stringify({ id, type }))
        return
      }
      if (message.type !== 'result' || !commands.has(message.id)) return
      if (!message.success) return finish(new Error(`Home Assistant registry request failed: ${commands.get(message.id)}`))
      results.set(message.id, message.result)
      if (results.size === commands.size) {
        finish(null, { areas: results.get(1), devices: results.get(2), entities: results.get(3) })
      }
    })
    socket.addEventListener('error', () => finish(new Error('Home Assistant WebSocket connection failed')))
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('Home Assistant WebSocket closed before registry data arrived'))
    })
  }), timeoutMs, 'Home Assistant registry request timed out')
}

function classifyState(domain, state) {
  if (!state || state === 'unknown') return { status: 'unknown', label: '未知' }
  if (state === 'unavailable') return { status: 'offline', label: '離線' }
  if (state === 'on') return { status: 'on', label: '開啟' }
  if (state === 'off') return { status: 'off', label: '關閉' }
  return { status: 'unknown', label: '未知' }
}

export function classifyCameraState(state, cameraProbe, fetchedAtMs = Date.now(), offlineMs = 300000) {
  if (!state || state === 'unknown') {
    return { status: 'unknown', label: '連線待確認', reason: 'ha-state-unknown' }
  }
  if (state === 'unavailable') {
    return { status: 'offline', label: '離線', reason: 'ha-unavailable' }
  }
  if (cameraProbe?.reachable === true) {
    return { status: 'on', label: '連線正常', reason: null }
  }
  if (cameraProbe?.reachable === false) {
    const failureSinceMs = Date.parse(cameraProbe.failureSince || '')
    const failureAgeMs = Number.isFinite(failureSinceMs)
      ? Math.max(0, fetchedAtMs - failureSinceMs)
      : 0
    const sustainedFailure = (cameraProbe.failureCount || 0) >= 2 && failureAgeMs >= offlineMs
    return sustainedFailure
      ? { status: 'offline', label: '離線', reason: 'stream-probe-failed' }
      : { status: 'unknown', label: '連線待確認', reason: 'stream-probe-failed' }
  }
  return { status: 'unknown', label: '連線待確認', reason: 'stream-probe-pending' }
}

export async function probeCameraStream(baseUrl, token, entityId, timeoutMs = 8000) {
  const streamResult = await withTimeout(new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl(baseUrl))
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.close()
      if (error) reject(error)
      else resolve(value)
    }
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return finish(new Error('Home Assistant camera probe returned invalid JSON'))
      }
      if (message.type === 'auth_required') return socket.send(JSON.stringify({ type: 'auth', access_token: token }))
      if (message.type === 'auth_invalid') return finish(new Error('Home Assistant camera probe authentication failed'))
      if (message.type === 'auth_ok') {
        socket.send(JSON.stringify({ id: 1, type: 'camera/stream', entity_id: entityId, format: 'hls' }))
        return
      }
      if (message.type === 'result' && message.id === 1) {
        if (!message.success || !message.result?.url) return finish(new Error('Home Assistant camera stream is unavailable'))
        finish(null, new URL(message.result.url, baseUrl).toString())
      }
    })
    socket.addEventListener('error', () => finish(new Error('Home Assistant camera probe WebSocket failed')))
    socket.addEventListener('close', () => {
      if (!settled) finish(new Error('Home Assistant camera probe WebSocket closed early'))
    })
  }), timeoutMs, 'Home Assistant camera stream URL timed out')

  const response = await fetch(streamResult, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Home Assistant camera stream probe returned ${response.status}`)
  }
  await response.body?.cancel()
  return true
}

function deviceKind(domain) {
  if (domain === 'switch') return 'outlet'
  return domain
}

function normalizeSnapshot(registries, states, options) {
  const fetchedAtMs = Date.now()
  const fetchedAt = new Date(fetchedAtMs).toISOString()
  const areaById = new Map(registries.areas.map((area) => [area.area_id, area]))
  const deviceById = new Map(registries.devices.map((device) => [device.id, device]))
  const registryByEntity = new Map(registries.entities.map((entity) => [entity.entity_id, entity]))
  const areas = registries.areas.map((area) => ({
    id: area.area_id,
    name: area.name,
    devices: [],
  }))
  const unassigned = { id: 'unassigned', name: '未分區', devices: [] }
  const normalizedAreaById = new Map(areas.map((area) => [area.id, area]))

  for (const state of states) {
    const [domain] = state.entity_id.split('.')
    if (!options.domains.has(domain)) continue
    const entity = registryByEntity.get(state.entity_id)
    if (entity?.disabled_by || entity?.hidden_by) continue
    const haDevice = entity?.device_id ? deviceById.get(entity.device_id) : undefined
    const areaId = entity?.area_id || haDevice?.area_id
    const area = normalizedAreaById.get(areaId) || unassigned
    const cameraProbe = domain === 'camera' ? options.cameraProbes.get(state.entity_id) : null
    const classification = domain === 'camera'
      ? classifyCameraState(state.state, cameraProbe, fetchedAtMs, options.cameraProbeOfflineMs)
      : classifyState(domain, state.state)
    const name = entity?.name || state.attributes?.friendly_name || entity?.original_name || haDevice?.name_by_user || haDevice?.name || state.entity_id

    area.devices.push({
      id: state.entity_id,
      entityId: state.entity_id,
      deviceId: entity?.device_id || null,
      name,
      kind: deviceKind(domain),
      status: classification.status,
      statusLabel: classification.label,
      available: classification.status === 'on' || classification.status === 'off',
      availabilityReason: classification.reason || (classification.status === 'offline' ? 'ha-unavailable' : null),
      cameraProbeMode: domain === 'camera' ? 'hls-manifest-headers-only' : null,
      lastProbeAt: cameraProbe?.lastAttemptAt || null,
      lastProbeSuccessAt: cameraProbe?.lastSuccessAt || null,
      probeFailureSince: cameraProbe?.failureSince || null,
      probeFailureCount: cameraProbe?.failureCount || 0,
      lastUpdated: state.last_updated || state.last_changed || null,
      source: 'home-assistant',
      cameraMode: domain === 'camera' ? 'connection-only' : null,
      lastChanged: state.last_changed || null,
    })
  }

  if (unassigned.devices.length) areas.push(unassigned)
  for (const area of areas) area.devices.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))

  const haDevices = areas.flatMap((area) => area.devices).filter((device) => device.source === 'home-assistant')
  return {
    areas,
    summary: {
      areas: areas.filter((area) => area.id !== 'unassigned').length,
      connected: haDevices.filter((device) => device.available).length,
      total: haDevices.length,
      offline: haDevices.filter((device) => device.status === 'offline').length,
      unknown: haDevices.filter((device) => device.status === 'unknown').length,
    },
    updatedAt: fetchedAt,
    stale: false,
    source: 'home-assistant',
  }
}

function markCache(snapshot, staleAfterMs) {
  const ageMs = Date.now() - Date.parse(snapshot.updatedAt)
  return { ...snapshot, stale: ageMs >= staleAfterMs, cached: true, ageSeconds: Math.max(0, Math.floor(ageMs / 1000)) }
}

export function createHomeAssistantClient({
  baseUrl,
  token,
  timeoutMs = 6000,
  cacheTtlMs = 15000,
  staleAfterMs = 120000,
  cameraProbeIntervalMs = 60000,
  cameraProbeTimeoutMs = 8000,
  cameraProbeOfflineMs = 300000,
  domains = DEFAULT_DOMAINS,
}) {
  let cache = null
  const cameraProbes = new Map()
  const normalizedBaseUrl = baseUrl?.replace(/\/$/, '')
  const options = { domains: new Set(domains), cameraProbes, cameraProbeOfflineMs }

  function refreshCameraProbe(entityId) {
    const previous = cameraProbes.get(entityId) || {}
    const currentTime = Date.now()
    if (previous.running || (previous.lastAttemptAt && currentTime - Date.parse(previous.lastAttemptAt) < cameraProbeIntervalMs)) return
    const attemptAt = new Date(currentTime).toISOString()
    cameraProbes.set(entityId, { ...previous, running: true, lastAttemptAt: attemptAt })
    probeCameraStream(normalizedBaseUrl, token, entityId, cameraProbeTimeoutMs)
      .then(() => {
        cameraProbes.set(entityId, {
          reachable: true,
          running: false,
          lastAttemptAt: attemptAt,
          lastSuccessAt: new Date().toISOString(),
          failureSince: null,
          failureCount: 0,
          lastError: null,
        })
      })
      .catch((error) => {
        const latest = cameraProbes.get(entityId) || {}
        cameraProbes.set(entityId, {
          ...latest,
          reachable: false,
          running: false,
          failureSince: latest.failureSince || attemptAt,
          failureCount: (latest.failureCount || 0) + 1,
          lastError: String(error?.message || error).slice(0, 160),
        })
      })
  }

  async function fetchSnapshot() {
    if (!normalizedBaseUrl || !token) throw new Error('Home Assistant read-only API is not configured')
    const [registries, states] = await Promise.all([
      fetchHaRegistries(normalizedBaseUrl, token, timeoutMs),
      fetchHaJson(`${normalizedBaseUrl}/api/states`, token, timeoutMs),
    ])
    for (const state of states) {
      if (state.entity_id.startsWith('camera.')) refreshCameraProbe(state.entity_id)
    }
    cache = normalizeSnapshot(registries, states, options)
    return cache
  }

  async function getStatus() {
    if (cache && Date.now() - Date.parse(cache.updatedAt) < cacheTtlMs) return cache
    try {
      return await fetchSnapshot()
    } catch (error) {
      if (cache) return { ...markCache(cache, staleAfterMs), error: 'Home Assistant 暫時無法連線，顯示最近一次資料' }
      throw error
    }
  }

  async function getAreas() {
    const status = await getStatus()
    return {
      areas: status.areas.map((area) => ({
        id: area.id,
        name: area.name,
        deviceCount: area.devices.length,
        connectedCount: area.devices.filter((device) => device.available).length,
      })),
      updatedAt: status.updatedAt,
      stale: status.stale,
      source: status.source,
    }
  }

  return { getAreas, getStatus }
}
