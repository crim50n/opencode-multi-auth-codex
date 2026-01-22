import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const SERVICE_NAME = 'codex-soft'

export interface ServiceOptions {
  cliPath: string
  host?: string
  port?: number
}

function getServiceDir(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user')
}

export function getServiceFilePath(): string {
  return path.join(getServiceDir(), `${SERVICE_NAME}.service`)
}

function ensureDir(): void {
  const dir = getServiceDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function runSystemctl(args: string[]): void {
  execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' })
}

export function installService(options: ServiceOptions): string {
  const host = options.host || '127.0.0.1'
  const port = options.port || 3434
  const serviceFile = getServiceFilePath()
  const workingDir = path.dirname(options.cliPath)
  const execStart = `${process.execPath} ${options.cliPath} web --host ${host} --port ${port}`

  ensureDir()
  const unit = `[Unit]
Description=Codex Soft Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${workingDir}
ExecStart=${execStart}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`

  fs.writeFileSync(serviceFile, unit, { mode: 0o600 })
  runSystemctl(['daemon-reload'])
  runSystemctl(['enable', '--now', `${SERVICE_NAME}.service`])
  return serviceFile
}

export function disableService(): void {
  runSystemctl(['disable', '--now', `${SERVICE_NAME}.service`])
}

export function serviceStatus(): void {
  runSystemctl(['status', `${SERVICE_NAME}.service`, '--no-pager'])
}
