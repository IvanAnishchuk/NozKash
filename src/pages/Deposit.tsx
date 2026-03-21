import { useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import type { LayoutOutletContext } from '../layoutOutletContext'

/** Abre el modal de confirmación de depósito y vuelve al inicio. */
export function Deposit() {
  const navigate = useNavigate()
  const { openDepositModal } = useOutletContext<LayoutOutletContext>()

  useEffect(() => {
    openDepositModal()
    navigate('/', { replace: true })
  }, [navigate, openDepositModal])

  return null
}
