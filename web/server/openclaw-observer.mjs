import { readFile } from 'node:fs/promises'

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function parseResult(message) {
  const text = message.content?.find((item) => item.type === 'text')?.text || ''
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  const failedItems = payload?.data?.failed
  const failed = message.isError === true
    || payload?.success === false
    || (Array.isArray(failedItems) && failedItems.length > 0)
  return { failed, payload }
}

function toolLabel(name) {
  return String(name || '未知工具').replace(/^homeassistant__/, '')
}

function resultSummary(name, result) {
  const label = toolLabel(name)
  if (name?.endsWith('GetLiveContext')) {
    return result.failed ? `${label} 無法取得狀態` : `${label} 已取得 Home Assistant 即時狀態`
  }
  const successes = result.payload?.data?.success
  const failures = result.payload?.data?.failed
  const entities = (result.failed ? failures : successes)
    ?.map((item) => item.name || item.id)
    .filter(Boolean)
    .slice(0, 3)
  if (entities?.length) return `${label} · ${entities.join('、')}`
  return result.failed ? `${label} 執行失敗` : `${label} 執行完成`
}

export function createOpenClawObserver({ sessionId, startedAt, sessionsIndex, emit, onSnapshot, requireAttachment = false, requireVision = false }) {
  const seenMessages = new Set()
  const toolCalls = new Map()
  const state = {
    contextSeen: false,
    contextFailed: false,
    actionSeen: false,
    verifySeen: false,
    actionFailed: false,
    verificationFailed: false,
    cameraSeen: false,
    visionSeen: false,
  }
  const snapshotPromises = []
  let stopped = false
  let loopPromise

  async function resolveTranscript() {
    const index = JSON.parse(await readFile(sessionsIndex, 'utf8'))
    const key = `agent:main:openai-user:web:${sessionId}`
    const entry = index[key]
    return entry?.sessionFile || entry?.transcriptPath || null
  }

  function processToolCall(item, createdAt) {
    const isContext = item.name?.endsWith('GetLiveContext')
    const isHaAction = /^homeassistant__Hass/.test(item.name || '')
    const command = item.arguments?.command || ''
    const imagePath = item.arguments?.image || ''
    const isCameraStatus = item.name === 'exec' && /ha-camera-snapshot\/status\.sh/.test(command)
    const isCameraCapture = item.name === 'exec' && /ha-camera-snapshot\/snapshot\.sh/.test(command)
    const isVision = item.name === 'image' && /ha-camera-snapshot/.test(imagePath)
    let step
    let kind = 'ha-action'
    if (isContext || isCameraStatus) {
      kind = isCameraStatus ? 'camera-status' : 'ha-context'
      step = state.actionSeen ? 'verify' : 'context'
      if (step === 'context') state.contextSeen = true
      else state.verifySeen = true
    } else if (isHaAction) {
      step = 'action'
      state.actionSeen = true
    } else if (isCameraCapture) {
      kind = 'camera-capture'
      step = 'action'
      state.cameraSeen = true
    } else if (isVision) {
      kind = 'vision'
      step = 'verify'
      state.visionSeen = true
      state.verifySeen = true
    } else {
      return
    }
    toolCalls.set(item.id, { name: item.name, step, kind })
    const label = isCameraCapture ? '攝影機快照' : isVision ? '影像判讀' : isCameraStatus ? '攝影機連線狀態' : toolLabel(item.name)
    const detail = isCameraCapture ? '正在透過 Home Assistant 取得一次最新快照'
      : isVision ? '正在分析這一張新快照'
        : (isContext || isCameraStatus) ? '正在查詢 Home Assistant 狀態'
          : '正在透過 HA MCP 執行設備操作'
    emit(step, 'running', label, detail, createdAt)
  }

  function processToolResult(message, createdAt) {
    const call = toolCalls.get(message.toolCallId)
    if (!call) return
    const name = message.toolName || call?.name
    const step = call?.step || (name?.endsWith('GetLiveContext') ? (state.actionSeen ? 'verify' : 'context') : 'action')
    const result = parseResult(message)
    if (step === 'context' && result.failed) state.contextFailed = true
    if (step === 'action' && result.failed) state.actionFailed = true
    if (step === 'verify' && result.failed) state.verificationFailed = true
    const text = message.content?.find((item) => item.type === 'text')?.text || ''
    const snapshotPath = text.match(/Snapshot saved:\s*([^\r\n]+\.jpg)/i)?.[1]
    if (!result.failed && snapshotPath && onSnapshot) snapshotPromises.push(onSnapshot(snapshotPath.trim()))
    const label = call.kind === 'vision' ? '影像判讀' : call.kind === 'camera-capture' ? '攝影機快照' : call.kind === 'camera-status' ? '攝影機連線狀態' : toolLabel(name)
    const detail = call.kind === 'vision' ? (result.failed ? '無法分析快照' : '已完成最新快照的視覺判讀')
      : call.kind === 'camera-capture' ? (result.failed ? '無法取得攝影機快照' : '已取得並驗證 JPEG 快照')
        : call.kind === 'camera-status' ? (result.failed ? '無法取得攝影機連線狀態' : '已取得攝影機連線狀態，未拍攝快照')
        : resultSummary(name, result)
    emit(step, result.failed ? 'failed' : 'success', label, detail, createdAt)
  }

  async function scan() {
    const transcript = await resolveTranscript()
    if (!transcript) return
    const contents = await readFile(transcript, 'utf8')
    for (const rawLine of contents.split(/\r?\n/)) {
      if (!rawLine) continue
      let record
      try {
        record = JSON.parse(rawLine)
      } catch {
        continue
      }
      if (record.type !== 'message' || seenMessages.has(record.id)) continue
      if (Date.parse(record.timestamp || 0) < startedAt - 1000) continue
      seenMessages.add(record.id)
      const message = record.message
      if (message?.role === 'assistant') {
        for (const item of message.content || []) {
          if (item.type === 'toolCall') processToolCall(item, record.timestamp)
        }
      } else if (message?.role === 'toolResult') {
        processToolResult(message, record.timestamp)
      }
    }
  }

  async function loop() {
    while (!stopped) {
      await scan().catch(() => {})
      await sleep(150)
    }
  }

  return {
    start() {
      loopPromise = loop()
    },
    async finish() {
      stopped = true
      await loopPromise
      await scan().catch(() => {})
      const settledSnapshots = await Promise.allSettled(snapshotPromises)
      const attachments = settledSnapshots.filter((item) => item.status === 'fulfilled').map((item) => item.value)

      if (requireAttachment && state.cameraSeen) {
        if (attachments.length > 0) {
          emit('action', 'success', '快照附件', '已建立可在網站短期顯示的快照附件')
        } else if (!state.actionFailed) {
          emit('action', 'failed', '快照附件', '已執行攝影機快照，但無法建立可顯示的短期圖片')
          state.actionFailed = true
        }
      }

      if (!state.contextSeen) {
        emit('context', 'skipped', 'GetLiveContext', state.actionSeen ? 'OpenClaw 未在操作前查詢狀態' : state.cameraSeen ? '攝影機影像與 HA 設備狀態分開判讀' : '此次要求未呼叫即時狀態工具')
      }
      if (!state.actionSeen && !state.cameraSeen) {
        emit('action', 'skipped', '設備操作', '此次要求不需要控制設備')
        emit('verify', 'skipped', '狀態驗證', '沒有設備操作需要驗證')
      } else if (!state.verifySeen) {
        if (state.cameraSeen) {
          if (requireVision && !state.visionSeen) {
            emit('verify', state.actionFailed ? 'skipped' : 'failed', '影像判讀', state.actionFailed ? '快照取得失敗，停止影像判讀' : '取得快照後未完成影像判讀')
            if (!state.actionFailed) state.verificationFailed = true
          } else if (!requireVision) {
            emit('verify', 'skipped', '影像判讀', '使用者只要求取得或顯示快照，此次不需要影像判讀')
          }
        } else {
          const status = state.actionFailed ? 'skipped' : 'failed'
          emit('verify', status, 'GetLiveContext', state.actionFailed ? '設備操作已失敗，停止後續驗證' : '操作後未重新查詢設備狀態')
          if (!state.actionFailed) state.verificationFailed = true
        }
      }

      return {
        failed: state.contextFailed || state.actionFailed || state.verificationFailed,
        contextSeen: state.contextSeen,
        actionSeen: state.actionSeen,
        cameraSeen: state.cameraSeen,
        contextFailed: state.contextFailed,
        actionFailed: state.actionFailed,
        verificationFailed: state.verificationFailed,
        attachments,
      }
    },
  }
}
