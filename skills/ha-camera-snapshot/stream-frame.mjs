import { readFile, writeFile } from 'node:fs/promises'

const [baseUrl, cameraEntity, tokenFile, outputFile] = process.argv.slice(2)
if (!baseUrl || !cameraEntity || !tokenFile || !outputFile) {
  console.error('Usage: node stream-frame.mjs <ha-url> <camera-entity> <token-file> <output-file>')
  process.exit(2)
}

const token = (await readFile(tokenFile, 'utf8')).trim()
if (!token) throw new Error('Home Assistant token file is empty')

const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 30_000)
const jpegStart = Buffer.from([0xff, 0xd8])
const jpegEnd = Buffer.from([0xff, 0xd9])
const maximumBufferedBytes = 12 * 1024 * 1024

try {
  const streamUrl = `${baseUrl.replace(/\/$/, '')}/api/camera_proxy_stream/${encodeURIComponent(cameraEntity)}`
  const response = await fetch(streamUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: controller.signal,
  })
  if (!response.ok || !response.body) throw new Error(`Home Assistant camera stream returned HTTP ${response.status}`)

  const reader = response.body.getReader()
  let buffered = Buffer.alloc(0)
  let frame = null

  while (!frame) {
    const { done, value } = await reader.read()
    if (done) break
    buffered = Buffer.concat([buffered, Buffer.from(value)])

    const start = buffered.indexOf(jpegStart)
    if (start >= 0) {
      const end = buffered.indexOf(jpegEnd, start + jpegStart.length)
      if (end >= 0) frame = buffered.subarray(start, end + jpegEnd.length)
      else if (start > 0) buffered = buffered.subarray(start)
    } else if (buffered.length > 64 * 1024) {
      buffered = buffered.subarray(-2)
    }

    if (buffered.length > maximumBufferedBytes) throw new Error('Camera stream frame exceeded safety limit')
  }

  await reader.cancel().catch(() => {})
  if (!frame) throw new Error('Camera stream ended before a JPEG frame was received')
  await writeFile(outputFile, frame, { mode: 0o600 })
  console.log(`Captured one JPEG frame from Home Assistant stream (${frame.length} bytes)`)
} finally {
  clearTimeout(timer)
}
