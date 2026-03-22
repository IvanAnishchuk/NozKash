/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GHOST_VAULT_ADDRESS?: string
  /** 64 hex chars (32 bytes) — master seed for `deriveTokenSecrets`. */
  readonly VITE_GHOST_MASTER_SEED_HEX?: string
  /** Avalanche Fuji JSON-RPC HTTPS URL for reads (logs, blocks, receipts, estimateGas). */
  readonly VITE_FUJI_RPC_URL?: string
  /** Máx. JSON-RPC seguidas antes de pausar el escaneo del vault (default 12). */
  readonly VITE_GHOST_VAULT_RPC_BURST?: string
  /** Pausa en ms tras agotar el burst (default 5000). */
  readonly VITE_GHOST_VAULT_RPC_PAUSE_MS?: string
  /** TTL del caché de actividad del vault en ms (default 12000). 0 = sin caché. */
  readonly VITE_GHOST_VAULT_SCAN_CACHE_MS?: string
  /** Opcional: solo esta cuenta ve "Start redeem" antes del primer borrador (misma que Account 1). */
  readonly VITE_GHOST_REDEEM_PREPARE_ACCOUNT?: string
  /** Opcional: solo esta cuenta ve "Redeem here" (Account 2 / quien firma la tx). */
  readonly VITE_GHOST_REDEEM_EXECUTOR_ACCOUNT?: string
  /** `true` — logs `[GhostVault redeem]` en consola (además de `import.meta.env.DEV`). */
  readonly VITE_GHOST_REDEEM_DEBUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg?raw' {
  const src: string
  export default src
}
