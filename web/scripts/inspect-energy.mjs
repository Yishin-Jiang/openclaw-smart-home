import { readFile } from 'node:fs/promises'

const baseUrl = (process.env.HOME_ASSISTANT_URL || 'http://192.168.0.103:8123').replace(/\/$/, '')
const token = (await readFile(process.env.HOME_ASSISTANT_TOKEN_FILE || '/home/vboxuser/.config/openclaw/ha_token', 'utf8')).trim()
const socketUrl = new URL(baseUrl)
socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
socketUrl.pathname = '/api/websocket'

const registries = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl)
  const results = new Map()
  const timeout = setTimeout(() => reject(new Error('registry timeout')), 6000)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }))
    if (message.type === 'auth_invalid') reject(new Error('authentication failed'))
    if (message.type === 'auth_ok') {
      socket.send(JSON.stringify({ id: 1, type: 'config/area_registry/list' }))
      socket.send(JSON.stringify({ id: 2, type: 'config/device_registry/list' }))
      socket.send(JSON.stringify({ id: 3, type: 'config/entity_registry/list' }))
    }
    if (message.type === 'result' && [1, 2, 3].includes(message.id)) {
      results.set(message.id, message.result)
      if (results.size === 3) {
        clearTimeout(timeout)
        socket.close()
        resolve({ areas: results.get(1), devices: results.get(2), entities: results.get(3) })
      }
    }
  })
  socket.addEventListener('error', () => reject(new Error('registry connection failed')))
})

const statesResponse = await fetch(`${baseUrl}/api/states`, { headers: { Authorization: `Bearer ${token}` } })
if (!statesResponse.ok) throw new Error(`states request failed: ${statesResponse.status}`)
const states = await statesResponse.json()
const entityById = new Map(registries.entities.map((entity) => [entity.entity_id, entity]))
const deviceById = new Map(registries.devices.map((device) => [device.id, device]))
const areaById = new Map(registries.areas.map((area) => [area.area_id, area]))

const candidates = states.filter((state) => {
  const text = `${state.entity_id} ${state.attributes?.friendly_name || ''}`
  return /smart_wi_fi_plug|p110|tapo/i.test(text)
}).map((state) => {
  const entity = entityById.get(state.entity_id)
  const device = deviceById.get(entity?.device_id)
  const areaId = entity?.area_id || device?.area_id || null
  return {
    entityId: state.entity_id,
    name: entity?.name || state.attributes?.friendly_name || entity?.original_name || state.entity_id,
    state: state.state,
    unit: state.attributes?.unit_of_measurement || null,
    deviceClass: state.attributes?.device_class || null,
    stateClass: state.attributes?.state_class || null,
    disabledBy: entity?.disabled_by || null,
    deviceId: entity?.device_id || null,
    deviceName: device?.name_by_user || device?.name || null,
    areaId,
    areaName: areaById.get(areaId)?.name || null,
    lastUpdated: state.last_updated,
  }
})

console.log(JSON.stringify(candidates, null, 2))
