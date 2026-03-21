import { useMemo, useState, type ReactNode } from 'react'
import { SelectedAccountContext } from './selected-account-context'

export function SelectedAccountProvider({ children }: { children: ReactNode }) {
  const [selectedAccountId, setSelectedAccountId] = useState(1)

  const value = useMemo(
    () => ({ selectedAccountId, setSelectedAccountId }),
    [selectedAccountId]
  )

  return (
    <SelectedAccountContext.Provider value={value}>
      {children}
    </SelectedAccountContext.Provider>
  )
}
