/**
 * Master switch for NozkVault verbose console logging:
 * `[NozkVault deposit debug]`, `[NozkVault activity]`, `[NozkVault redeem]`.
 *
 * On in the Vite dev server, or when `VITE_NOZK_DEBUG=true` at build time.
 */
export function isNozkVaultDebugEnabled(): boolean {
  return (
    import.meta.env.DEV === true ||
    import.meta.env.VITE_NOZK_DEBUG === 'true'
  )
}
