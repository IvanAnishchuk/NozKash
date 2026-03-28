/**
 * Master switch for GhostVault verbose console logging:
 * `[GhostVault deposit debug]`, `[GhostVault activity]`, `[GhostVault redeem]`.
 *
 * On in the Vite dev server, or when `VITE_GHOST_DEBUG=true` at build time.
 */
export function isGhostVaultDebugEnabled(): boolean {
  return (
    import.meta.env.DEV === true ||
    import.meta.env.VITE_GHOST_DEBUG === 'true'
  )
}
