import { createContext, useContext } from 'react'

export type SelectedAccountContextValue = {
  selectedAccountId: number
  setSelectedAccountId: (id: number) => void
}

export const SelectedAccountContext =
  createContext<SelectedAccountContextValue | null>(null)

export function useSelectedAccount() {
  const ctx = useContext(SelectedAccountContext)
  if (!ctx)
    throw new Error('useSelectedAccount must be used within SelectedAccountProvider')
  return ctx
}
