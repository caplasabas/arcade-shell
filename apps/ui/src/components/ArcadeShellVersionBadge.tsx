import { useEffect, useState } from 'react'

type ArcadeShellBuildInfo = {
  version?: string
  created_at?: string
}

export function ArcadeShellVersionBadge() {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    fetch('/arcade-shell-build.json', { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<ArcadeShellBuildInfo>
      })
      .then(data => {
        if (cancelled) return
        setVersion(String(data?.version || '').trim())
      })
      .catch(() => {
        if (cancelled) return
        setVersion('')
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!version) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 10,
        fontSize: 12,
        opacity: 0.75,
        pointerEvents: 'none',
        zIndex: 9999,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {version}
    </div>
  )
}
