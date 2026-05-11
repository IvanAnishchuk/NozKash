/**
 * Manages mint server and relayer as child processes during Playwright tests.
 *
 * Captures stdout/stderr to log files in app/test-results/ for debugging.
 * Services are started after contract deployment (they need CONTRACT_ADDRESS).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

async function waitForHealth(url: string, proc: ChildProcess, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Process exited with code ${proc.exitCode} before becoming healthy`)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // server not ready yet
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Service at ${url} did not become healthy within ${timeoutMs}ms`)
}
const LOG_DIR = resolve(__dirname, '..', '..', 'test-results', 'service-logs')

export interface ServiceHandle {
  process: ChildProcess
  logPath: string
  stop: () => Promise<void>
}

function ensureLogDir() {
  mkdirSync(LOG_DIR, { recursive: true })
}

/**
 * Start the mint server as a subprocess.
 *
 * The mint auto-processes DepositLocked events and calls announce().
 * Logs are saved to test-results/service-logs/mint-server.log
 */
export async function startMintServer(opts: {
  contractAddress: string
  mintBlsPrivkey: string
  mintWalletAddress: string
  mintWalletKey: string
  rpcWsUrl?: string
  pollInterval?: number
}): Promise<ServiceHandle> {
  ensureLogDir()
  const logPath = resolve(LOG_DIR, 'mint-server.log')
  const logStream = createWriteStream(logPath, { flags: 'w' })

  const env = {
    ...process.env,
    CONTRACT_ADDRESS: opts.contractAddress,
    MINT_BLS_PRIVKEY: opts.mintBlsPrivkey,
    RPC_WS_URL: opts.rpcWsUrl ?? 'ws://127.0.0.1:8545',
    MINT_WALLET_ADDRESS: opts.mintWalletAddress,
    MINT_WALLET_KEY: opts.mintWalletKey,
    POLL_INTERVAL_SECONDS: String(opts.pollInterval ?? 1),
  }

  const proc = spawn('uv', ['run', 'mint_server.py', '--verbosity', 'verbose'], {
    cwd: resolve(REPO_ROOT, 'nozk_py'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout?.pipe(logStream)
  proc.stderr?.pipe(logStream)

  // Wait for the mint server to initialize (no HTTP health endpoint)
  // Race: either 2s startup delay succeeds, or spawn error rejects immediately
  await Promise.race([
    new Promise(r => setTimeout(r, 2000)),
    new Promise((_, reject) => proc.once('error', (err) =>
      reject(new Error(`Mint server failed to spawn: ${err.message} (see ${logPath})`))
    )),
  ])
  if (proc.exitCode !== null) {
    throw new Error(`Mint server exited immediately with code ${proc.exitCode} (see ${logPath})`)
  }

  return {
    process: proc,
    logPath,
    stop: () => stopService(proc, logStream),
  }
}

/**
 * Start the relayer server as a subprocess.
 *
 * Accepts reveal/redeem requests via HTTP and forwards to the contract.
 * Logs are saved to test-results/service-logs/relayer-server.log
 */
export async function startRelayerServer(opts: {
  contractAddress: string
  mintBlsPubkey: string
  relayerWalletAddress: string
  relayerWalletKey: string
  rpcHttpUrl?: string
  port?: number
  chainId?: number
}): Promise<ServiceHandle> {
  ensureLogDir()
  const logPath = resolve(LOG_DIR, 'relayer-server.log')
  const logStream = createWriteStream(logPath, { flags: 'w' })

  const env = {
    ...process.env,
    CONTRACT_ADDRESS: opts.contractAddress,
    MINT_BLS_PUBKEY: opts.mintBlsPubkey,
    RPC_HTTP_URL: opts.rpcHttpUrl ?? 'http://127.0.0.1:8545',
    RELAYER_WALLET_ADDRESS: opts.relayerWalletAddress,
    RELAYER_WALLET_KEY: opts.relayerWalletKey,
    CHAIN_ID: String(opts.chainId ?? 31337),
  }

  const port = opts.port ?? 8000
  const proc = spawn('uv', ['run', 'relayer_server.py', '--port', String(port), '--verbosity', 'verbose'], {
    cwd: resolve(REPO_ROOT, 'nozk_py'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout?.pipe(logStream)
  proc.stderr?.pipe(logStream)

  // Poll /health until the relayer is ready; also catch spawn errors
  const spawnError = new Promise<never>((_, reject) => proc.once('error', (err) =>
    reject(new Error(`Relayer failed to spawn: ${err.message} (see ${logPath})`))
  ))
  await Promise.race([
    waitForHealth(`http://127.0.0.1:${port}/health`, proc),
    spawnError,
  ])

  return {
    process: proc,
    logPath,
    stop: () => stopService(proc, logStream),
  }
}

async function stopService(proc: ChildProcess, logStream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      logStream.end()
      resolve()
      return
    }

    proc.on('exit', () => {
      logStream.end()
      resolve()
    })

    proc.kill('SIGTERM')

    // Force kill after 5 seconds
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL')
      }
    }, 5000)
  })
}
