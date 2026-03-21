/** Contexto pasado desde `Layout` vía `<Outlet context={...} />`. */
export type LayoutOutletContext = {
  openDepositModal: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}
