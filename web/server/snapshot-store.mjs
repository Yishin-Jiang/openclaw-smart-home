import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, open, readdir, stat, unlink } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'

const snapshotIdPattern = /^[a-f0-9-]{36}$/i

function safeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function cameraRequestPolicy(message) {
  const text = String(message || '')
  const captureDenied = /(?:不要|不用|不需|別|禁止|無需).{0,8}(?:取得|拍攝|拍照|拍|擷取|抓取|調閱).{0,8}(?:快照|照片|圖片|影像|畫面)|(?:不要|不用|不需|別|禁止|無需)(?:快照|拍照)|(?:no|without)\s+(?:snapshot|photo|capture)/i.test(text)
  const analysisDenied = /(?:不要|不用|不需|別|禁止|無需).{0,10}(?:判讀|辨識|分析|描述)|(?:no|without)\s+(?:analysis|vision|description)/i.test(text)
  const deliveryDenied = /(?:不要|不用|不需|別|禁止|無需).{0,10}(?:顯示|附上|傳送|提供).{0,8}(?:快照|照片|圖片|影像|畫面)|只(?:要|需)?(?:回答|回覆).{0,12}(?:判斷|結果|文字)|(?:no|without)\s+(?:display|attachment|attached|image delivery)/i.test(text)
  const analysisRequested = !captureDenied && !analysisDenied && /(有人|沒有人|無人|人物|人嗎|看見|看到|看看|看一下|描述|判斷|辨識|分析|什麼|狀況|情況|光線|明亮|昏暗|anyone|person|describe|identify|analy[sz]e|what(?:'s| is)|look|see|lighting)/i.test(text)
  const captureRequested = !captureDenied && (analysisRequested || /(快照|照片|圖片|影像|畫面|snapshot|photo|image|picture)/i.test(text))
  const explicitDelivery = /(?:取得|給我|顯示|傳給我|傳送|提供|附上|查看).{0,40}(?:快照|照片|圖片|影像|畫面)|(?:快照|照片|圖片|影像|畫面).{0,20}(?:給我|顯示|傳給我|傳送|提供|附上|查看)|(?:show|send|get|give).{0,30}(?:snapshot|photo|image|picture)/i.test(text)
  const imageRequested = captureRequested && explicitDelivery && !deliveryDenied
  return { captureRequested, imageRequested, analysisRequested }
}

export function createSnapshotStore({ directory, signingSecret, ttlSeconds = 120, allowedSourceDirectory }) {
  const snapshotDirectory = resolve(directory)
  const sourceDirectory = resolve(allowedSourceDirectory)
  const secret = signingSecret || randomUUID()

  function signature(sessionId, snapshotId, expires) {
    return createHmac('sha256', secret).update(`${sessionId}.${snapshotId}.${expires}`).digest('hex')
  }

  async function cleanup() {
    await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 })
    const cutoff = Date.now() - ttlSeconds * 1000
    for (const entry of await readdir(snapshotDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jpg')) continue
      const target = resolve(snapshotDirectory, entry.name)
      const details = await stat(target).catch(() => null)
      if (details && details.mtimeMs < cutoff) await unlink(target).catch(() => {})
    }
  }

  async function importSnapshot(sourcePath, sessionId, capturedAfter) {
    const source = resolve(sourcePath)
    if (!source.startsWith(`${sourceDirectory}${sep}`)) throw new Error('Snapshot source is outside the allowed camera cache')
    const sourceStat = await stat(source)
    if (!sourceStat.isFile() || sourceStat.size < 4 || sourceStat.size > 12 * 1024 * 1024) throw new Error('Snapshot file is invalid')
    if (sourceStat.mtimeMs < capturedAfter - 2000) throw new Error('Snapshot file is stale')

    const handle = await open(source, 'r')
    const header = Buffer.alloc(3)
    await handle.read(header, 0, 3, 0)
    await handle.close()
    if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) throw new Error('Snapshot is not a JPEG image')

    await cleanup()
    const id = randomUUID()
    const target = resolve(snapshotDirectory, `${id}.jpg`)
    await copyFile(source, target)
    await chmod(target, 0o600)
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const signed = signature(sessionId, id, expires)
    return {
      id,
      type: 'image',
      mimeType: 'image/jpeg',
      url: `/api/chat/${sessionId}/snapshots/${id}?expires=${expires}&signature=${signed}`,
      expiresAt: new Date(expires * 1000).toISOString(),
      alt: 'Aqara G350 最新快照',
    }
  }

  async function serve(response, { sessionId, snapshotId, expires, suppliedSignature }) {
    if (!snapshotIdPattern.test(snapshotId)) return false
    const expiry = Number.parseInt(expires || '', 10)
    if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false
    if (!safeEqual(signature(sessionId, snapshotId, expiry), suppliedSignature || '')) return false
    const target = resolve(snapshotDirectory, `${basename(snapshotId)}.jpg`)
    const details = await stat(target).catch(() => null)
    if (!details?.isFile()) return false
    response.writeHead(200, {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Length': details.size,
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'inline',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    createReadStream(target).pipe(response)
    return true
  }

  const cleanupTimer = setInterval(() => cleanup().catch(() => {}), 60_000)
  cleanupTimer.unref()
  cleanup().catch(() => {})

  return { cleanup, importSnapshot, serve }
}
