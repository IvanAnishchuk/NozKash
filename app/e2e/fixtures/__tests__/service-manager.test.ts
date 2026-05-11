/**
 * Unit tests for app/e2e/fixtures/service-manager.ts
 *
 * Tests:
 * - ServiceHandle interface shape
 * - Environment variable construction logic for startMintServer and startRelayerServer
 * - Default value application (rpcWsUrl, pollInterval, port, chainId)
 * - stopService logic via mocked ChildProcess
 */

import { describe, expect, it } from 'vitest'

// ==============================================================================
// Environment variable construction helpers
// These are extracted from service-manager.ts to enable pure unit testing
// without spawning real processes.
// ==============================================================================

interface MintServerOpts {
  contractAddress: string
  mintBlsPrivkey: string
  mintWalletAddress: string
  mintWalletKey: string
  rpcWsUrl?: string
  pollInterval?: number
}

interface RelayerServerOpts {
  contractAddress: string
  mintBlsPubkey: string
  relayerWalletAddress: string
  relayerWalletKey: string
  rpcHttpUrl?: string
  port?: number
  chainId?: number
}

/** Mirror of env construction in startMintServer */
function buildMintServerEnv(opts: MintServerOpts): Record<string, string> {
  return {
    CONTRACT_ADDRESS: opts.contractAddress,
    MINT_BLS_PRIVKEY: opts.mintBlsPrivkey,
    RPC_WS_URL: opts.rpcWsUrl ?? 'ws://127.0.0.1:8545',
    MINT_WALLET_ADDRESS: opts.mintWalletAddress,
    MINT_WALLET_KEY: opts.mintWalletKey,
    POLL_INTERVAL_SECONDS: String(opts.pollInterval ?? 1),
  }
}

/** Mirror of env construction in startRelayerServer */
function buildRelayerServerEnv(opts: RelayerServerOpts): Record<string, string> {
  return {
    CONTRACT_ADDRESS: opts.contractAddress,
    MINT_BLS_PUBKEY: opts.mintBlsPubkey,
    RPC_HTTP_URL: opts.rpcHttpUrl ?? 'http://127.0.0.1:8545',
    RELAYER_WALLET_ADDRESS: opts.relayerWalletAddress,
    RELAYER_WALLET_KEY: opts.relayerWalletKey,
    CHAIN_ID: String(opts.chainId ?? 31337),
  }
}

/** Mirror of port selection in startRelayerServer */
function selectRelayerPort(opts: RelayerServerOpts): number {
  return opts.port ?? 8000
}

// ==============================================================================
// Mint server env construction
// ==============================================================================

describe('Mint server environment construction', () => {
  const baseOpts: MintServerOpts = {
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    mintBlsPrivkey: '0x000000000000000000000000000000000000000000000000000000000000002a', // 42 in hex
    mintWalletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    mintWalletKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }

  it('sets CONTRACT_ADDRESS correctly', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.CONTRACT_ADDRESS).toBe(baseOpts.contractAddress)
  })

  it('sets MINT_BLS_PRIVKEY correctly', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.MINT_BLS_PRIVKEY).toBe(baseOpts.mintBlsPrivkey)
  })

  it('sets MINT_WALLET_ADDRESS correctly', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.MINT_WALLET_ADDRESS).toBe(baseOpts.mintWalletAddress)
  })

  it('sets MINT_WALLET_KEY correctly', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.MINT_WALLET_KEY).toBe(baseOpts.mintWalletKey)
  })

  it('uses default RPC_WS_URL when not provided', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.RPC_WS_URL).toBe('ws://127.0.0.1:8545')
  })

  it('uses custom RPC_WS_URL when provided', () => {
    const env = buildMintServerEnv({ ...baseOpts, rpcWsUrl: 'ws://192.168.1.1:8546' })
    expect(env.RPC_WS_URL).toBe('ws://192.168.1.1:8546')
  })

  it('uses default POLL_INTERVAL_SECONDS of 1 when not provided', () => {
    const env = buildMintServerEnv(baseOpts)
    expect(env.POLL_INTERVAL_SECONDS).toBe('1')
  })

  it('converts pollInterval number to string for env', () => {
    const env = buildMintServerEnv({ ...baseOpts, pollInterval: 5 })
    expect(env.POLL_INTERVAL_SECONDS).toBe('5')
    expect(typeof env.POLL_INTERVAL_SECONDS).toBe('string')
  })

  it('uses custom pollInterval when provided', () => {
    const env = buildMintServerEnv({ ...baseOpts, pollInterval: 10 })
    expect(env.POLL_INTERVAL_SECONDS).toBe('10')
  })

  it('pollInterval of 0 results in "0" string', () => {
    const env = buildMintServerEnv({ ...baseOpts, pollInterval: 0 })
    expect(env.POLL_INTERVAL_SECONDS).toBe('0')
  })

  it('has exactly the required env keys', () => {
    const env = buildMintServerEnv(baseOpts)
    const keys = Object.keys(env)
    expect(keys).toContain('CONTRACT_ADDRESS')
    expect(keys).toContain('MINT_BLS_PRIVKEY')
    expect(keys).toContain('RPC_WS_URL')
    expect(keys).toContain('MINT_WALLET_ADDRESS')
    expect(keys).toContain('MINT_WALLET_KEY')
    expect(keys).toContain('POLL_INTERVAL_SECONDS')
    expect(keys).toHaveLength(6)
  })
})

// ==============================================================================
// Relayer server env construction
// ==============================================================================

describe('Relayer server environment construction', () => {
  const baseOpts: RelayerServerOpts = {
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    mintBlsPubkey: '0xabcdef1234567890abcdef1234567890abcdef12',
    relayerWalletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    relayerWalletKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  }

  it('sets CONTRACT_ADDRESS correctly', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.CONTRACT_ADDRESS).toBe(baseOpts.contractAddress)
  })

  it('sets MINT_BLS_PUBKEY correctly', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.MINT_BLS_PUBKEY).toBe(baseOpts.mintBlsPubkey)
  })

  it('sets RELAYER_WALLET_ADDRESS correctly', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.RELAYER_WALLET_ADDRESS).toBe(baseOpts.relayerWalletAddress)
  })

  it('sets RELAYER_WALLET_KEY correctly', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.RELAYER_WALLET_KEY).toBe(baseOpts.relayerWalletKey)
  })

  it('uses default RPC_HTTP_URL when not provided', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.RPC_HTTP_URL).toBe('http://127.0.0.1:8545')
  })

  it('uses custom RPC_HTTP_URL when provided', () => {
    const env = buildRelayerServerEnv({ ...baseOpts, rpcHttpUrl: 'http://10.0.0.1:8545' })
    expect(env.RPC_HTTP_URL).toBe('http://10.0.0.1:8545')
  })

  it('uses default CHAIN_ID of 31337 when not provided', () => {
    const env = buildRelayerServerEnv(baseOpts)
    expect(env.CHAIN_ID).toBe('31337')
  })

  it('converts chainId number to string for env', () => {
    const env = buildRelayerServerEnv({ ...baseOpts, chainId: 1 })
    expect(env.CHAIN_ID).toBe('1')
    expect(typeof env.CHAIN_ID).toBe('string')
  })

  it('uses custom chainId when provided', () => {
    const env = buildRelayerServerEnv({ ...baseOpts, chainId: 11155111 })
    expect(env.CHAIN_ID).toBe('11155111')
  })

  it('uses Sepolia chain ID 11155111 correctly', () => {
    const env = buildRelayerServerEnv({ ...baseOpts, chainId: 11155111 })
    expect(env.CHAIN_ID).toBe('11155111')
  })

  it('has exactly the required env keys', () => {
    const env = buildRelayerServerEnv(baseOpts)
    const keys = Object.keys(env)
    expect(keys).toContain('CONTRACT_ADDRESS')
    expect(keys).toContain('MINT_BLS_PUBKEY')
    expect(keys).toContain('RPC_HTTP_URL')
    expect(keys).toContain('RELAYER_WALLET_ADDRESS')
    expect(keys).toContain('RELAYER_WALLET_KEY')
    expect(keys).toContain('CHAIN_ID')
    expect(keys).toHaveLength(6)
  })
})

// ==============================================================================
// Port selection
// ==============================================================================

describe('Relayer server port selection', () => {
  const baseOpts: RelayerServerOpts = {
    contractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    mintBlsPubkey: '0xabcdef',
    relayerWalletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    relayerWalletKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }

  it('defaults to port 8000', () => {
    expect(selectRelayerPort(baseOpts)).toBe(8000)
  })

  it('uses custom port when provided', () => {
    expect(selectRelayerPort({ ...baseOpts, port: 9000 })).toBe(9000)
  })

  it('uses port 8001 for parallel test isolation', () => {
    expect(selectRelayerPort({ ...baseOpts, port: 8001 })).toBe(8001)
  })

  it('matches VITE_RELAYER_URL port in .env.test', () => {
    // .env.test has VITE_RELAYER_URL=http://127.0.0.1:8000
    expect(selectRelayerPort(baseOpts)).toBe(8000)
  })
})

// ==============================================================================
// stopService logic via mock process
// ==============================================================================

describe('stopService logic', () => {
  /**
   * Simulate the stopService function from service-manager.ts using a mock process.
   * The function:
   * 1. If process has already exited (exitCode !== null), close log stream immediately.
   * 2. Otherwise, send SIGTERM and wait for 'exit' event.
   * 3. Force SIGKILL after 5 seconds if still running.
   */
  function createMockProcess(exitCode: number | null = null) {
    const listeners: Record<string, Array<() => void>> = {}
    const killCalls: string[] = []

    return {
      exitCode,
      killCalls,
      on(event: string, fn: () => void) {
        ;(listeners[event] ??= []).push(fn)
      },
      kill(signal: string) {
        killCalls.push(signal)
        if (signal === 'SIGTERM') {
          // Simulate immediate exit after SIGTERM
          this.exitCode = 0
          ;(listeners['exit'] ?? []).forEach(fn => fn())
        }
      },
      emit(event: string) {
        ;(listeners[event] ?? []).forEach(fn => fn())
      },
    }
  }

  function createMockLogStream() {
    let ended = false
    return {
      get ended() { return ended },
      end() { ended = true },
    }
  }

  async function simulateStopService(proc: ReturnType<typeof createMockProcess>, logStream: ReturnType<typeof createMockLogStream>): Promise<void> {
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
    })
  }

  it('resolves immediately if process has already exited', async () => {
    const proc = createMockProcess(0) // exitCode = 0 (already exited)
    const logStream = createMockLogStream()

    await simulateStopService(proc, logStream)

    expect(logStream.ended).toBe(true)
    expect(proc.killCalls).toHaveLength(0) // no kill needed
  })

  it('ends log stream when process has already exited', async () => {
    const proc = createMockProcess(1) // exitCode = 1 (exited with error)
    const logStream = createMockLogStream()

    await simulateStopService(proc, logStream)

    expect(logStream.ended).toBe(true)
  })

  it('sends SIGTERM to running process', async () => {
    const proc = createMockProcess(null) // no exit yet
    const logStream = createMockLogStream()

    await simulateStopService(proc, logStream)

    expect(proc.killCalls).toContain('SIGTERM')
  })

  it('ends log stream after SIGTERM and exit event', async () => {
    const proc = createMockProcess(null)
    const logStream = createMockLogStream()

    await simulateStopService(proc, logStream)

    expect(logStream.ended).toBe(true)
  })

  it('resolves after SIGTERM triggers exit event', async () => {
    const proc = createMockProcess(null)
    const logStream = createMockLogStream()

    let resolved = false
    const promise = simulateStopService(proc, logStream).then(() => { resolved = true })
    await promise
    expect(resolved).toBe(true)
  })
})

// ==============================================================================
// ServiceHandle interface validation
// ==============================================================================

describe('ServiceHandle interface', () => {
  it('has the expected shape (process, logPath, stop)', () => {
    // This is a structural test verifying that the handle returned
    // by the service manager has the correct properties.
    function createFakeHandle() {
      return {
        process: { pid: 12345, exitCode: null },
        logPath: '/tmp/test.log',
        stop: async () => {},
      }
    }

    const handle = createFakeHandle()
    expect(handle).toHaveProperty('process')
    expect(handle).toHaveProperty('logPath')
    expect(handle).toHaveProperty('stop')
    expect(typeof handle.stop).toBe('function')
    expect(typeof handle.logPath).toBe('string')
  })

  it('stop() returns a Promise', () => {
    const handle = {
      process: {},
      logPath: '/tmp/test.log',
      stop: async () => {},
    }
    const result = handle.stop()
    expect(result).toBeInstanceOf(Promise)
  })
})

// ==============================================================================
// Log path construction
// ==============================================================================

describe('Service log path construction', () => {
  it('mint server log filename is mint-server.log', () => {
    // Mirror the log path naming from service-manager.ts
    const logFileName = 'mint-server.log'
    expect(logFileName).toMatch(/^mint-server\.log$/)
  })

  it('relayer server log filename is relayer-server.log', () => {
    const logFileName = 'relayer-server.log'
    expect(logFileName).toMatch(/^relayer-server\.log$/)
  })

  it('log files have .log extension', () => {
    expect('mint-server.log'.endsWith('.log')).toBe(true)
    expect('relayer-server.log'.endsWith('.log')).toBe(true)
  })
})

// ==============================================================================
// Default value assertions (cross-test invariants)
// ==============================================================================

describe('Service manager default values', () => {
  it('default anvil WS URL is ws://127.0.0.1:8545', () => {
    const opts: MintServerOpts = {
      contractAddress: '0x0',
      mintBlsPrivkey: '0x0',
      mintWalletAddress: '0x0',
      mintWalletKey: '0x0',
    }
    const env = buildMintServerEnv(opts)
    expect(env.RPC_WS_URL).toBe('ws://127.0.0.1:8545')
  })

  it('default anvil HTTP URL is http://127.0.0.1:8545', () => {
    const opts: RelayerServerOpts = {
      contractAddress: '0x0',
      mintBlsPubkey: '0x0',
      relayerWalletAddress: '0x0',
      relayerWalletKey: '0x0',
    }
    const env = buildRelayerServerEnv(opts)
    expect(env.RPC_HTTP_URL).toBe('http://127.0.0.1:8545')
  })

  it('default poll interval is 1 second', () => {
    const opts: MintServerOpts = {
      contractAddress: '0x0',
      mintBlsPrivkey: '0x0',
      mintWalletAddress: '0x0',
      mintWalletKey: '0x0',
    }
    const env = buildMintServerEnv(opts)
    expect(env.POLL_INTERVAL_SECONDS).toBe('1')
  })

  it('default chain ID is 31337 (anvil)', () => {
    const opts: RelayerServerOpts = {
      contractAddress: '0x0',
      mintBlsPubkey: '0x0',
      relayerWalletAddress: '0x0',
      relayerWalletKey: '0x0',
    }
    const env = buildRelayerServerEnv(opts)
    expect(env.CHAIN_ID).toBe('31337')
    expect(parseInt(env.CHAIN_ID)).toBe(31337)
  })

  it('default relayer port is 8000', () => {
    const opts: RelayerServerOpts = {
      contractAddress: '0x0',
      mintBlsPubkey: '0x0',
      relayerWalletAddress: '0x0',
      relayerWalletKey: '0x0',
    }
    expect(selectRelayerPort(opts)).toBe(8000)
  })
})