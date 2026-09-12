const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const authorization = process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD
  ? `Basic ${Buffer.from(`${process.env.SMOKE_USERNAME}:${process.env.SMOKE_PASSWORD}`).toString('base64')}`
  : ''

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: authorization ? { Authorization: authorization } : {},
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}`)
  return response
}

const checks = [
  ['control center', '/', async (response) => (await response.text()).includes('<div id="app"></div>')],
  ['energy route', '/energy', async (response) => (await response.text()).includes('<div id="app"></div>')],
  ['gateway health', '/api/health', async (response) => (await response.json()).ok === true],
  ['HA status', '/api/home/status', async (response) => (await response.json()).source === 'home-assistant'],
  ['HA areas', '/api/home/areas', async (response) => Array.isArray((await response.json()).areas)],
  ['HA energy', '/api/energy', async (response) => (await response.json()).source === 'home-assistant'],
]

let failed = 0
for (const [name, pathname, validate] of checks) {
  try {
    const valid = await validate(await request(pathname))
    if (!valid) throw new Error('response contract mismatch')
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

if (failed) process.exitCode = 1
else console.log(`PASS ${checks.length} read-only checks; no device control was executed`)
