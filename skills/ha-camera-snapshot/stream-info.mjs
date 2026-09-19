import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.env.HOME_ASSISTANT_URL || 'http://homeassistant.local:8123'
const tokenFile = process.env.HOME_ASSISTANT_TOKEN_FILE || join(homedir(), '.config', 'openclaw', 'ha_token')
const entityId = process.env.HOME_ASSISTANT_CAMERA_ENTITY || 'camera.aqara_g350'
const token = (await readFile(tokenFile, 'utf8')).trim()
const socketUrl = new URL('/api/websocket', baseUrl)
socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl)
  const timer = setTimeout(() => reject(new Error('Stream info request timed out')), 10_000)
  const finish = (error, value) => {
    clearTimeout(timer)
    socket.close()
    if (error) reject(error)
    else resolve(value)
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }))
    else if (message.type === 'auth_invalid') finish(new Error('Home Assistant authentication failed'))
    else if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, type: 'stream/camera', camera_entity_id: entityId }))
    else if (message.type === 'result' && message.id === 1) finish(message.success ? null : new Error(message.error?.message || 'Stream info request failed'), message.result)
  })
  socket.addEventListener('error', () => finish(new Error('Home Assistant WebSocket failed')))
})

console.log(JSON.stringify({ entityId, stream: result }, null, 2))
