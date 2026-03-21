import { useEffect, useState } from 'react'
import splashSvg from '../../assets/eghost-splash.svg?raw'

export function SplashScreen() {
  const [phase, setPhase] = useState<'visible' | 'hiding' | 'gone'>('visible')

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase('hiding'), 4500)
    const t2 = window.setTimeout(() => setPhase('gone'), 5000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      id="splash"
      className={phase === 'hiding' ? 'hide' : undefined}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: splashSvg }}
    />
  )
}
