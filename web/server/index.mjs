import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHomeAssistantClient } from './home-assistant.mjs'
import { createOpenClawObserver } from './openclaw-observer.mjs'
import { cameraRequestPolicy, createSnapshotStore } from './snapshot-store.mjs'
import { createEnergyClient } from './energy.mjs'
import { createProactiveMonitor } from './proactive-monitor.mjs'
import { createMemoryStore } from './memory-store.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDirectory = join(projectRoot, 'dist')
const sessionDirectory = resolve(process.env.SESSION_DATA_DIR || join(projectRoot, 'data', 'sessions'))
const gatewayUrl = (process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '')
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || ''
let proactiveHookToken = process.env.PROACTIVE_HOOK_TOKEN?.trim() || ''
if (!proactiveHookToken && process.env.PROACTIVE_HOOK_TOKEN_FILE) {
  try {
    proactiveHookToken = (await readFile(process.env.PROACTIVE_HOOK_TOKEN_FILE, 'utf8')).trim()
  } catch (error) {
    console.error('[proactive-monitor] hook token file is not readable:', error.message)
  }
}
const openClawSessionsIndex = process.env.OPENCLAW_SESSIONS_INDEX || '/home/vboxuser/.openclaw/agents/main/sessions/sessions.json'
let homeAssistantToken = process.env.HOME_ASSISTANT_TOKEN?.trim() || ''
if (!homeAssistantToken && process.env.HOME_ASSISTANT_TOKEN_FILE) {
  try {
    homeAssistantToken = (await readFile(process.env.HOME_ASSISTANT_TOKEN_FILE, 'utf8')).trim()
  } catch (error) {
    console.error('[home-assistant] token file is not readable:', error.message)
  }
}
const homeAssistant = createHomeAssistantClient({
  baseUrl: process.env.HOME_ASSISTANT_URL || '',
  token: homeAssistantToken,
  timeoutMs: Number.parseInt(process.env.HOME_ASSISTANT_TIMEOUT_MS || '6000', 10),
  cacheTtlMs: Number.parseInt(process.env.HOME_STATUS_CACHE_TTL_MS || '15000', 10),
  staleAfterMs: Number.parseInt(process.env.HOME_STATUS_STALE_AFTER_MS || '120000', 10),
  domains: (process.env.HOME_ENTITY_DOMAINS || 'light,switch,camera').split(',').map((value) => value.trim()).filter(Boolean),
})
const energyClient = createEnergyClient({
  baseUrl: process.env.HOME_ASSISTANT_URL || '',
  token: homeAssistantToken,
  timeoutMs: Number.parseInt(process.env.HOME_ASSISTANT_TIMEOUT_MS || '8000', 10),
  cacheTtlMs: Number.parseInt(process.env.ENERGY_CACHE_TTL_MS || '30000', 10),
  entities: {
    power: process.env.P110_POWER_ENTITY || 'sensor.smart_wi_fi_plug_dian_li_1',
    total: process.env.P110_TOTAL_ENERGY_ENTITY || 'sensor.smart_wi_fi_plug_neng_yuan_1',
    today: process.env.P110_TODAY_ENERGY_ENTITY || '',
    voltage: process.env.P110_VOLTAGE_ENTITY || 'sensor.smart_wi_fi_plug_you_xiao_dian_ya_1',
    current: process.env.P110_CURRENT_ENTITY || 'sensor.smart_wi_fi_plug_you_xiao_dian_liu_1',
  },
})
const host = process.env.HOST || '127.0.0.1'
const port = Number.parseInt(process.env.PORT || '4173', 10)
const maxBodyBytes = 32 * 1024
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean))
const generalRateLimit = Number.parseInt(process.env.API_RATE_LIMIT_PER_MINUTE || '120', 10)
const actionRateLimit = Number.parseInt(process.env.ACTION_RATE_LIMIT_PER_MINUTE || '12', 10)
const sessionPattern = /^[a-f0-9-]{20,64}$/i
const executionProtocol = [
  'For Home Assistant control requests, execute tools sequentially:',
  'first call GetLiveContext and wait for its result, then call the required HA control tool and wait for its result, then call GetLiveContext again to verify.',
  'Never claim completion when a control tool fails or the final verification is missing or contradicts the request.',
  'For read-only questions, use GetLiveContext when current HA state is needed.',
].join(' ')
const snapshotStore = createSnapshotStore({
  directory: process.env.SNAPSHOT_DATA_DIR || join(projectRoot, 'data', 'snapshots'),
  signingSecret: process.env.SNAPSHOT_SIGNING_SECRET || '',
  ttlSeconds: Number.parseInt(process.env.SNAPSHOT_TTL_SECONDS || '120', 10),
  allowedSourceDirectory: process.env.CAMERA_SNAPSHOT_SOURCE_DIR || '/home/vboxuser/.openclaw/workspace/skills/ha-camera-snapshot/cache',
})
const memoryStore = createMemoryStore({
  directory: resolve(process.env.MEMORY_DATA_DIR || join(projectRoot, 'data', 'memory')),
  userProfilePath: resolve(process.env.OPENCLAW_USER_PROFILE_PATH || join(projectRoot, '..', 'USER.md')),
  retentionDays: Number.parseInt(process.env.ACTIVITY_RETENTION_DAYS || '30', 10),
  maxActivityRecords: Number.parseInt(process.env.ACTIVITY_MAX_RECORDS || '1000', 10),
})
const proactiveMonitor = createProactiveMonitor({
  homeAssistant,
  gatewayUrl,
  hookToken: proactiveHookToken,
  statePath: resolve(process.env.PROACTIVE_STATE_FILE || join(projectRoot, 'data', 'monitor-state.json')),
  enabled: process.env.PROACTIVE_MONITOR_ENABLED === 'true',
  pollMs: Number.parseInt(process.env.PROACTIVE_POLL_MS || '15000', 10),
  offlineSeconds: {
    light: Number.parseInt(process.env.PROACTIVE_LIGHT_OFFLINE_SECONDS || '120', 10),
    outlet: Number.parseInt(process.env.PROACTIVE_SWITCH_OFFLINE_SECONDS || '120', 10),
    camera: Number.parseInt(process.env.PROACTIVE_CAMERA_OFFLINE_SECONDS || '300', 10),
  },
  recoverySeconds: Number.parseInt(process.env.PROACTIVE_RECOVERY_SECONDS || '60', 10),
  longRunningSeconds: Number.parseInt(process.env.PROACTIVE_LONG_RUNNING_SECONDS || '14400', 10),
  repeatSeconds: Number.parseInt(process.env.PROACTIVE_REPEAT_SECONDS || '1800', 10),
  maxAlertsPerIncident: Number.parseInt(process.env.PROACTIVE_MAX_ALERTS_PER_INCIDENT || '2', 10),
  monitoredEntities: (process.env.PROACTIVE_MONITORED_ENTITIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  longRunningEntities: (process.env.PROACTIVE_LONG_RUNNING_ENTITIES || '').split(',').map((value) => value.trim()).filter(Boolean),
  agentId: process.env.PROACTIVE_HOOK_AGENT || 'home-monitor',
  channel: process.env.PROACTIVE_NOTIFY_CHANNEL || 'line',
  to: process.env.PROACTIVE_NOTIFY_TO || '',
})
await proactiveMonitor.start()

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
}

function now() {
  return new Date().toISOString()
}

function createSession(id = randomUUID()) {
  const timestamp = now()
  return { id, createdAt: timestamp, updatedAt: timestamp, messages: [], events: [] }
}

function sessionPath(sessionId) {
  if (!sessionPattern.test(sessionId)) throw new Error('invalid_session_id')
  return join(sessionDirectory, `${sessionId}.json`)
}

async function loadSession(sessionId) {
  try {
    return JSON.parse(await readFile(sessionPath(sessionId), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return createSession(sessionId)
    throw error
  }
}

async function saveSession(session) {
  await mkdir(sessionDirectory, { recursive: true })
  session.updatedAt = now()
  const target = sessionPath(session.id)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, target)
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function applyCors(request, response) {
  const origin = request.headers.origin
  if (!origin) return true
  if (!allowedOrigins.has(origin)) return false
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  return true
}

function clientAddress(request) {
  const remote = request.socket.remoteAddress || 'unknown'
  const forwarded = request.headers['x-forwarded-for']
  if ((remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return remote
}

function createRateLimiter(limit) {
  const entries = new Map()
  return (key) => {
    const current = Date.now()
    const cutoff = current - 60_000
    const recent = (entries.get(key) || []).filter((timestamp) => timestamp > cutoff)
    if (recent.length >= limit) {
      entries.set(key, recent)
      return Math.max(1, Math.ceil((recent[0] + 60_000 - current) / 1000))
    }
    recent.push(current)
    entries.set(key, recent)
    if (entries.size > 1000) {
      for (const [entryKey, timestamps] of entries) {
        if (!timestamps.some((timestamp) => timestamp > cutoff)) entries.delete(entryKey)
      }
    }
    return 0
  }
}

const checkGeneralRateLimit = createRateLimiter(generalRateLimit)
const checkActionRateLimit = createRateLimiter(actionRateLimit)

function sendSse(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw new Error('request_too_large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function addEvent(session, step, status, label, detail, createdAt = now()) {
  const event = { id: randomUUID(), step, status, label, detail, createdAt }
  session.events.push(event)
  session.events = session.events.slice(-100)
  return event
}

function extractDelta(payload) {
  const content = payload?.choices?.[0]?.delta?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
}

function extractMessageContent(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('').trim()
}

async function createEnergyInsight(period) {
  if (!gatewayToken) throw new Error('OpenClaw Gateway Token is not configured')
  const energy = await energyClient.getEnergy()
  const selected = energy.periods[period]
  const payload = {
    period: selected.label,
    consumptionKwh: selected.value,
    complete: selected.complete,
    currentPowerW: energy.current.powerW,
    voltageV: energy.current.voltageV,
    currentA: energy.current.currentA,
    measuredDevices: energy.devices.filter((device) => device.measured).map((device) => ({ name: device.name, area: device.area.name, consumptionKwh: device[`${period}Kwh`] })),
    dataUpdatedAt: energy.dataUpdatedAt,
  }
  const upstream = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openclaw/default',
      user: `web:energy:${randomUUID()}`,
      stream: false,
      messages: [
        { role: 'system', content: '你是智慧家庭能耗摘要助手。不可呼叫工具。只能根據使用者提供的 JSON 數值，用繁體中文寫 2 到 3 句客觀摘要；不得自行計算、補值或猜測。null 必須說明資料不足，不能寫成 0。不要提出沒有數據支持的節能幅度。' },
        { role: 'user', content: `以下是網站後端由 Home Assistant 歷史資料計算的唯讀結果：\n${JSON.stringify(payload)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!upstream.ok) throw new Error(`OpenClaw Gateway returned ${upstream.status}`)
  const text = extractMessageContent(await upstream.json())
  if (!text) throw new Error('OpenClaw did not return an energy summary')
  return { text, period, generatedAt: now(), sourceUpdatedAt: energy.updatedAt }
}

async function gatewayHealth() {
  if (!gatewayToken) return { state: 'misconfigured', detail: '後端尚未設定 Gateway Token' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(`${gatewayUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${gatewayToken}` },
      signal: controller.signal,
    })
    if (!response.ok) return { state: 'unavailable', detail: `Gateway 回應 ${response.status}` }
    return { state: 'connected', detail: 'OpenClaw Gateway 已連線' }
  } catch {
    return { state: 'unavailable', detail: '無法連線 OpenClaw Gateway' }
  } finally {
    clearTimeout(timer)
  }
}

async function streamChat(request, response) {
  if (!gatewayToken) return sendJson(response, 503, { error: '後端尚未設定 OpenClaw Gateway Token' })

  let body
  try {
    body = await readJsonBody(request)
  } catch (error) {
    const statusCode = error?.message === 'request_too_large' ? 413 : 400
    return sendJson(response, statusCode, { error: statusCode === 413 ? '訊息內容過大' : '請求格式錯誤' })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const sessionId = typeof body.sessionId === 'string' && sessionPattern.test(body.sessionId)
    ? body.sessionId
    : randomUUID()
  if (!message || message.length > 8000) {
    return sendJson(response, 400, { error: '訊息長度必須介於 1 到 8000 字元' })
  }
  const cameraPolicy = cameraRequestPolicy(message)
  const requestStartedAt = Date.now()
  const explicitPreference = memoryStore.extractExplicitPreference(message)
  let preferenceCandidate = null
  if (explicitPreference) {
    preferenceCandidate = await memoryStore.createCandidate({
      ...explicitPreference,
      source: 'web-chat',
      sourceSessionId: sessionId,
    }).catch((error) => {
      console.error('[memory] unable to create preference candidate:', error.message)
      return null
    })
  }

  const session = await loadSession(sessionId)
  const userMessage = { id: randomUUID(), role: 'user', text: message, createdAt: now() }
  session.messages.push(userMessage)
  const receivedEvent = addEvent(session, 'received', 'success', '收到使用者要求', message.slice(0, 80))
  await saveSession(session)

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
    'X-Session-Id': sessionId,
  })
  sendSse(response, 'session', { sessionId })
  sendSse(response, 'flow', receivedEvent)
  if (preferenceCandidate) sendSse(response, 'memory_candidate', { preference: preferenceCandidate })

  const emitFlow = (step, status, label, detail, createdAt) => {
    const event = addEvent(session, step, status, label, detail, createdAt)
    if (!response.destroyed) sendSse(response, 'flow', event)
    return event
  }
  const observer = createOpenClawObserver({
    sessionId,
    startedAt: Date.now(),
    sessionsIndex: openClawSessionsIndex,
    emit: emitFlow,
    requireAttachment: cameraPolicy.imageRequested,
    requireVision: cameraPolicy.analysisRequested,
    onSnapshot: cameraPolicy.imageRequested
      ? (sourcePath) => snapshotStore.importSnapshot(sourcePath, sessionId, Date.now())
      : undefined,
  })
  observer.start()
  let observerFinished = false

  const controller = new AbortController()
  let completed = false
  response.on('close', () => {
    if (!completed) controller.abort()
  })

  let assistantText = ''
  let activityRecorded = false
  try {
    const preferencesPrompt = await memoryStore.activePreferencesPrompt()
    const upstream = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw/default',
        user: `web:${sessionId}`,
        stream: true,
        messages: [
          { role: 'system', content: `${executionProtocol} Memory is managed by the website. Never write USER.md, MEMORY.md, or memory files. A preference is not permission to control a device or access a camera. ${preferenceCandidate ? `The website created a pending preference candidate: "${preferenceCandidate.statement}". Tell the user to review and confirm the website memory card; do not treat it as active yet.` : ''} ${preferencesPrompt} ${cameraPolicy.captureRequested
            ? `The user explicitly authorized one fresh camera capture for this request. Use the ha-camera-snapshot skill. ${cameraPolicy.analysisRequested ? 'Analyze the fresh snapshot with the image tool and answer only from that result.' : 'The user only requested the snapshot; do not run image analysis.'} ${cameraPolicy.imageRequested ? 'They explicitly requested to receive the image; retain it through response delivery and include it as instructed by the skill.' : 'They did not request delivery of the image.'}`
            : 'The user did not authorize a camera capture. For camera connectivity questions use metadata only and never capture an image.'}` },
          { role: 'user', content: message },
        ],
      }),
      signal: controller.signal,
    })

    if (!upstream.ok || !upstream.body) {
      const upstreamText = await upstream.text()
      throw new Error(`Gateway ${upstream.status}: ${upstreamText.slice(0, 240)}`)
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamStarted = false

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = done ? '' : lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        const payload = JSON.parse(data)
        if (payload.error) throw new Error(payload.error.message || 'OpenClaw 執行失敗')
        const delta = extractDelta(payload)
        if (!delta) continue
        if (!streamStarted) {
          streamStarted = true
          emitFlow('response', 'running', 'OpenClaw 回覆', '正在依據工具結果整理回覆')
        }
        assistantText += delta
        sendSse(response, 'delta', { text: delta })
      }
      if (done) break
    }

    if (!assistantText.trim()) throw new Error('OpenClaw 沒有傳回可顯示的文字')

    const observed = await observer.finish()
    observerFinished = true
    assistantText = assistantText.replace(/^\s*MEDIA:\s*.+$/gim, '').trim()
    if (observed.actionFailed) {
      assistantText = cameraPolicy.captureRequested
        ? cameraPolicy.analysisRequested
          ? '攝影機快照或影像判讀未能完成。請查看右側處理流程中的失敗摘要。'
          : '攝影機快照未能取得或顯示。請查看右側處理流程中的失敗摘要。'
        : '設備操作未能完成。請查看右側處理流程中的失敗工具與結果摘要。'
    } else if (observed.verificationFailed) {
      assistantText = cameraPolicy.captureRequested
        ? '攝影機快照已取得，但 OpenClaw 沒有完成使用者要求的影像判讀，因此目前無法回答畫面內容。'
        : '設備操作已送出，但 OpenClaw 沒有完成事後狀態驗證，因此目前不能確認操作已成功。'
    }

    const assistantMessage = { id: randomUUID(), role: 'assistant', text: assistantText, attachments: observed.attachments, createdAt: now() }
    session.messages.push(assistantMessage)
    emitFlow('response', observed.failed ? 'failed' : 'success', observed.failed ? '回覆未通過驗證' : 'OpenClaw 回覆完成', observed.failed ? assistantText : `已依可驗證結果傳回 ${assistantText.length} 個字元`)
    await saveSession(session)
    await memoryStore.recordActivity({
      sessionId,
      source: 'web',
      type: preferenceCandidate ? 'preference-candidate' : cameraPolicy.captureRequested ? 'snapshot' : observed.actionSeen ? 'control' : 'query',
      requestSummary: message,
      entityIds: await relatedEntityIds(message),
      outcome: observed.failed ? 'failed' : preferenceCandidate ? 'pending-confirmation' : 'success',
      durationMs: Date.now() - requestStartedAt,
    }).catch((error) => console.error('[memory] activity write failed:', error.message))
    activityRecorded = true
    sendSse(response, 'done', { message: assistantMessage })
  } catch (error) {
    if (!observerFinished) {
      await observer.finish().catch(() => {})
      observerFinished = true
    }
    const detail = error?.name === 'AbortError' ? '連線已中止' : String(error?.message || error)
    const failedEvent = addEvent(session, 'response', 'failed', 'OpenClaw 回覆失敗', detail.slice(0, 180))
    await saveSession(session).catch(() => {})
    if (!activityRecorded) {
      await memoryStore.recordActivity({
        sessionId,
        source: 'web',
        type: preferenceCandidate ? 'preference-candidate' : cameraPolicy.captureRequested ? 'snapshot' : 'query',
        requestSummary: message,
        entityIds: await relatedEntityIds(message),
        outcome: 'failed',
        durationMs: Date.now() - requestStartedAt,
      }).catch((memoryError) => console.error('[memory] activity write failed:', memoryError.message))
    }
    if (!response.destroyed) {
      sendSse(response, 'flow', failedEvent)
      sendSse(response, 'error', { error: 'OpenClaw 暫時無法完成要求', detail: detail.slice(0, 180) })
    }
  } finally {
    completed = true
    if (!response.destroyed) response.end()
  }
}

async function relatedEntityIds(message) {
  try {
    const snapshot = await homeAssistant.getStatus()
    const text = message.toLocaleLowerCase('zh-TW')
    return snapshot.areas.flatMap((area) => area.devices).filter((device) => {
      const exact = text.includes(device.entityId.toLocaleLowerCase('zh-TW')) || text.includes(device.name.toLocaleLowerCase('zh-TW'))
      if (exact) return true
      if (device.kind === 'light') return /燈|照明|moes/iu.test(message)
      if (device.kind === 'outlet') return /插座|p110|plug/iu.test(message)
      if (device.kind === 'camera') return /攝影機|相機|快照|g350|camera/iu.test(message)
      return false
    }).map((device) => device.entityId)
  } catch {
    return []
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname
  let target = resolve(distDirectory, `.${requested}`)
  if (!target.startsWith(`${distDirectory}${sep}`) && target !== distDirectory) {
    return sendJson(response, 403, { error: 'Forbidden' })
  }

  try {
    if (!(await stat(target)).isFile()) throw Object.assign(new Error('not_file'), { code: 'ENOENT' })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    target = join(distDirectory, 'index.html')
  }

  const fileStat = await stat(target)
  response.writeHead(200, {
    'Cache-Control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=86400',
    'Content-Length': fileStat.size,
    'Content-Type': mimeTypes[extname(target).toLowerCase()] || 'application/octet-stream',
  })
  createReadStream(target).pipe(response)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    setSecurityHeaders(response)
    if (!applyCors(request, response)) return sendJson(response, 403, { error: 'Origin not allowed' })
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      return response.end()
    }

    if (url.pathname.startsWith('/api/')) {
      const address = clientAddress(request)
      const generalRetry = checkGeneralRateLimit(address)
      if (generalRetry) {
        response.setHeader('Retry-After', String(generalRetry))
        return sendJson(response, 429, { error: '請求過於頻繁，請稍後再試' })
      }
      if (['POST', 'PATCH', 'DELETE'].includes(request.method || '') && (
        url.pathname === '/api/chat'
        || url.pathname === '/api/energy/insights'
        || url.pathname.startsWith('/api/preferences')
        || url.pathname.startsWith('/api/activity')
      )) {
        const actionRetry = checkActionRateLimit(address)
        if (actionRetry) {
          response.setHeader('Retry-After', String(actionRetry))
          return sendJson(response, 429, { error: '操作過於頻繁，請稍後再試' })
        }
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, gateway: await gatewayHealth() })
    }
    if (request.method === 'GET' && url.pathname === '/api/home/status') {
      try {
        return sendJson(response, 200, await homeAssistant.getStatus())
      } catch (error) {
        console.error('[home-assistant]', error.message)
        return sendJson(response, 503, { error: 'Home Assistant 狀態目前無法讀取', stale: true })
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/home/areas') {
      try {
        return sendJson(response, 200, await homeAssistant.getAreas())
      } catch (error) {
        console.error('[home-assistant]', error.message)
        return sendJson(response, 503, { error: 'Home Assistant 分區目前無法讀取', stale: true })
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/monitor/status') {
      return sendJson(response, 200, proactiveMonitor.getStatus())
    }
    if (request.method === 'GET' && url.pathname === '/api/activity') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10)
      return sendJson(response, 200, await memoryStore.listActivity(limit))
    }
    if (request.method === 'DELETE' && url.pathname === '/api/activity') {
      await memoryStore.clearActivity()
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      return response.end()
    }
    const activityMatch = url.pathname.match(/^\/api\/activity\/([a-f0-9-]{36})$/i)
    if (request.method === 'DELETE' && activityMatch) {
      const deleted = await memoryStore.deleteActivity(activityMatch[1])
      if (!deleted) return sendJson(response, 404, { error: '找不到使用紀錄' })
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      return response.end()
    }
    if (request.method === 'GET' && url.pathname === '/api/preferences') {
      return sendJson(response, 200, await memoryStore.listPreferences())
    }
    if (request.method === 'POST' && url.pathname === '/api/preferences/candidates') {
      try {
        const body = await readJsonBody(request)
        const preference = await memoryStore.createCandidate({
          statement: body.statement,
          category: body.category,
          source: 'web-manual',
        })
        return sendJson(response, 201, { preference })
      } catch (error) {
        return sendJson(response, 400, { error: String(error?.message || error) })
      }
    }
    const preferenceConfirmMatch = url.pathname.match(/^\/api\/preferences\/([a-f0-9-]{36})\/confirm$/i)
    if (request.method === 'POST' && preferenceConfirmMatch) {
      const preference = await memoryStore.confirmPreference(preferenceConfirmMatch[1])
      if (!preference) return sendJson(response, 404, { error: '找不到偏好' })
      await memoryStore.recordActivity({
        source: 'web', type: 'preference-confirmed', requestSummary: preference.statement, entityIds: [], outcome: 'success',
      }).catch(() => {})
      return sendJson(response, 200, { preference })
    }
    const preferenceMatch = url.pathname.match(/^\/api\/preferences\/([a-f0-9-]{36})$/i)
    if (request.method === 'PATCH' && preferenceMatch) {
      try {
        const body = await readJsonBody(request)
        const preference = await memoryStore.updatePreference(preferenceMatch[1], body)
        if (!preference) return sendJson(response, 404, { error: '找不到偏好' })
        return sendJson(response, 200, { preference })
      } catch (error) {
        return sendJson(response, 400, { error: String(error?.message || error) })
      }
    }
    if (request.method === 'DELETE' && preferenceMatch) {
      const deleted = await memoryStore.deletePreference(preferenceMatch[1])
      if (!deleted) return sendJson(response, 404, { error: '找不到偏好' })
      response.writeHead(204, { 'Cache-Control': 'no-store' })
      return response.end()
    }
    if (request.method === 'GET' && url.pathname === '/api/energy') {
      try {
        return sendJson(response, 200, await energyClient.getEnergy())
      } catch (error) {
        console.error('[energy]', error.message)
        return sendJson(response, 503, { error: 'Home Assistant 能耗資料目前無法讀取', stale: true })
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/energy/insights') {
      try {
        const body = await readJsonBody(request)
        const period = ['today', 'week', 'month'].includes(body.period) ? body.period : 'today'
        return sendJson(response, 200, await createEnergyInsight(period))
      } catch (error) {
        console.error('[energy-insight]', error.message)
        return sendJson(response, 503, { error: 'OpenClaw 暫時無法產生能耗摘要' })
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      return await streamChat(request, response)
    }

    const snapshotMatch = url.pathname.match(/^\/api\/chat\/([a-f0-9-]{20,64})\/snapshots\/([a-f0-9-]{36})$/i)
    if (request.method === 'GET' && snapshotMatch) {
      const served = await snapshotStore.serve(response, {
        sessionId: snapshotMatch[1],
        snapshotId: snapshotMatch[2],
        expires: url.searchParams.get('expires'),
        suppliedSignature: url.searchParams.get('signature'),
      })
      if (served) return
      return sendJson(response, 403, { error: '快照連結無效或已過期' })
    }

    const historyMatch = url.pathname.match(/^\/api\/chat\/([a-f0-9-]{20,64})\/history$/i)
    if (request.method === 'GET' && historyMatch) {
      const session = await loadSession(historyMatch[1])
      return sendJson(response, 200, { sessionId: session.id, messages: session.messages, events: session.events, updatedAt: session.updatedAt })
    }

    const eventsMatch = url.pathname.match(/^\/api\/chat\/([a-f0-9-]{20,64})\/events$/i)
    if (request.method === 'GET' && eventsMatch) {
      const session = await loadSession(eventsMatch[1])
      return sendJson(response, 200, { sessionId: session.id, events: session.events, updatedAt: session.updatedAt })
    }

    const resetMatch = url.pathname.match(/^\/api\/chat\/([a-f0-9-]{20,64})\/reset$/i)
    if (request.method === 'POST' && resetMatch) {
      const session = createSession()
      await saveSession(session)
      return sendJson(response, 201, { sessionId: session.id })
    }

    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found' })
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed' })
    return await serveStatic(response, decodeURIComponent(url.pathname))
  } catch (error) {
    console.error('[server]', error)
    if (!response.headersSent) return sendJson(response, 500, { error: '伺服器發生錯誤' })
    response.end()
  }
})

server.listen(port, host, () => {
  console.log(`OpenClaw Smart Home listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    proactiveMonitor.stop()
    server.close(() => process.exit(0))
  })
}
