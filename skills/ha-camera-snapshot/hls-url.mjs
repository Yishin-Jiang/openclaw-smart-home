import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.env.HOME_ASSISTANT_URL || 'http://homeassistant.local:8123'
const tokenFile = process.env.HOME_ASSISTANT_TOKEN_FILE || join(homedir(), '.config', 'openclaw', 'ha_token')
const entityId = process.env.HOME_ASSISTANT_CAMERA_ENTITY || 'camera.aqara_g350'
const token = (await readFile(tokenFile, 'utf8')).trim()
const url = new URL('/api/websocket', baseUrl)
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket(url)
  const timer = setTimeout(() => finish(new Error('Camera stream request timed out')), 15_000)
  let settled = false

  function finish(error, value) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    socket.close()
    if (error) reject(error)
    else resolve(value)
  }

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      return finish(new Error('Home Assistant returned invalid JSON'))
    }
    if (message.type === 'auth_required') {
      socket.send(JSON.stringify({ type: 'auth', access_token: token }))
    } else if (message.type === 'auth_invalid') {
      finish(new Error('Home Assistant authentication failed'))
    } else if (message.type === 'auth_ok') {
      socket.send(JSON.stringify({ id: 1, type: 'camera/stream', entity_id: entityId, format: 'hls' }))
    } else if (message.type === 'result' && message.id === 1) {
      if (!message.success || !message.result?.url) finish(new Error(message.error?.message || 'Camera stream failed'))
      else finish(null, message.result)
    }
  })
  socket.addEventListener('error', () => finish(new Error('Home Assistant WebSocket failed')))
  socket.addEventListener('close', () => {
    if (!settled) finish(new Error('Home Assistant WebSocket closed early'))
  })
})

console.log(new URL(result.url, baseUrl).toString())
