import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useWallet } from '../hooks/useWallet'
import {
  buildNozkDerivationSignMessage,
  masterSeedFromPersonalSignSignature,
} from '../lib/deriveMasterSeedFromWallet'
import { getEthereum } from '../lib/ethereum'
import {
  getNozkMasterSeedFromEnv,
  NOZK_MASTER_SEED_CHANGED_EVENT,
} from '../lib/nozkVault'

type WalletUnlock = {
  seed: Uint8Array
  account: string
  /** eth_chainId normalized to lowercase */
  chainId: string
}

async function personalSignMasterSeed(
  ethereum: NonNullable<ReturnType<typeof getEthereum>>,
  account: string,
  chainIdHex: string
): Promise<Uint8Array | null> {
  try {
    const message = buildNozkDerivationSignMessage(account, chainIdHex)
    const sig = (await ethereum.request({
      method: 'personal_sign',
      params: [message, account],
    })) as string
    return masterSeedFromPersonalSignSignature(sig)
  } catch (e) {
    const err = e as { code?: number }
    if (err?.code !== 4001) {
      console.error('personal_sign (Nozk master seed)', e)
    }
    return null
  }
}

export type NozkMasterSeedContextValue = {
  effectiveMasterSeed: Uint8Array | null
  hasSignedUnlock: boolean
  seedRevision: number
  /** Manual re-sign after auto-unlock failed; seed stays in memory only while the wallet stays connected. */
  requestUnlockViaSign: (forAccount?: string) => Promise<Uint8Array | null>
  /** Clears the in-memory seed (e.g. another account on the same device). */
  clearSignedUnlock: () => Promise<void>
}

const NozkMasterSeedContext = createContext<NozkMasterSeedContextValue | null>(
  null
)

export function NozkMasterSeedProvider({ children }: { children: ReactNode }) {
  const { account, chainIdHex } = useWallet()
  const [unlock, setUnlock] = useState<WalletUnlock | null>(null)
  const unlockRef = useRef<WalletUnlock | null>(null)
  unlockRef.current = unlock

  const [seedRevision, setSeedRevision] = useState(0)

  const bump = useCallback(() => {
    setSeedRevision((r) => r + 1)
    window.dispatchEvent(new Event(NOZK_MASTER_SEED_CHANGED_EVENT))
  }, [])

  /** Without env override: seed only in RAM; cleared on disconnect (`account` null). Not persisted to localStorage. */
  useEffect(() => {
    if (getNozkMasterSeedFromEnv()) {
      setUnlock(null)
      return
    }

    if (!account || !chainIdHex) {
      setUnlock(null)
      return
    }

    const ethereum = getEthereum()
    if (!ethereum) return

    const cid = chainIdHex.toLowerCase()

    const u = unlockRef.current
    if (
      u &&
      u.account.toLowerCase() === account.toLowerCase() &&
      u.chainId === cid
    ) {
      return
    }

    let cancelled = false

    void (async () => {
      const seed = await personalSignMasterSeed(ethereum, account, chainIdHex)
      if (cancelled) return
      if (!seed) {
        setUnlock(null)
        return
      }
      setUnlock({
        seed,
        account,
        chainId: cid,
      })
      bump()
    })()

    return () => {
      cancelled = true
    }
  }, [account, chainIdHex, bump])

  const effectiveMasterSeed = useMemo(() => {
    const env = getNozkMasterSeedFromEnv()
    if (env) return env
    if (!account || !chainIdHex || !unlock) return null
    const cid = chainIdHex.toLowerCase()
    if (
      unlock.account.toLowerCase() === account.toLowerCase() &&
      unlock.chainId === cid
    ) {
      return unlock.seed
    }
    return null
  }, [account, chainIdHex, unlock, seedRevision])

  const hasSignedUnlock = Boolean(
    !getNozkMasterSeedFromEnv() && effectiveMasterSeed
  )

  const requestUnlockViaSign = useCallback(
    async (forAccount?: string): Promise<Uint8Array | null> => {
      const ethereum = getEthereum()
      const acct = forAccount ?? account
      const cid = chainIdHex?.toLowerCase()
      if (!ethereum || !acct || !cid) return null
      const seed = await personalSignMasterSeed(ethereum, acct, chainIdHex!)
      if (!seed) return null
      setUnlock({ seed, account: acct, chainId: cid })
      bump()
      return seed
    },
    [account, chainIdHex, bump]
  )

  const clearSignedUnlock = useCallback(async () => {
    setUnlock(null)
    bump()
  }, [bump])

  const value = useMemo(
    () => ({
      effectiveMasterSeed,
      hasSignedUnlock,
      seedRevision,
      requestUnlockViaSign,
      clearSignedUnlock,
    }),
    [
      effectiveMasterSeed,
      hasSignedUnlock,
      seedRevision,
      requestUnlockViaSign,
      clearSignedUnlock,
    ]
  )

  return (
    <NozkMasterSeedContext.Provider value={value}>
      {children}
    </NozkMasterSeedContext.Provider>
  )
}

export function useNozkMasterSeed(): NozkMasterSeedContextValue {
  const ctx = useContext(NozkMasterSeedContext)
  if (!ctx) {
    throw new Error('useNozkMasterSeed must be used within NozkMasterSeedProvider')
  }
  return ctx
}
