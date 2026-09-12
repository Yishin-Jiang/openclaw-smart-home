import { spawn } from 'node:child_process'

const commands = [
  spawn(process.execPath, ['--watch', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:client'], { stdio: 'inherit' }),
]

function stop(exitCode = 0) {
  for (const command of commands) command.kill()
  process.exit(exitCode)
}

for (const command of commands) {
  command.on('exit', (code) => {
    if (code && code !== 0) stop(code)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

