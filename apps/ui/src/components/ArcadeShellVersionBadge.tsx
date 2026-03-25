import { useEffect, useState } from 'react'

type ArcadeShellBuildInfo = {
  version?: string
  created_at?: string
}

type Props = {
  deviceId?: string | null
}

export function ArcadeShellVersionBadge({ deviceId }: Props) {
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

  const normalizedDeviceId = String(deviceId ?? '')
    .trim()
    .slice(0, 12)
  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 10,
        fontSize: 12,
        opacity: 0.6,
        pointerEvents: 'none',
        zIndex: 100001,
        color: 'rgba(255,255,255,255.65)',
        // textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        fontVariantNumeric: 'tabular-nums',
        background: 'rgba(0, 0, 0, 0.45)',
        borderRadius: 10,
        padding: '6px 10px',
        letterSpacing: '0.03em',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        lineHeight: 1.2,
        gap: 2,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>{version}</div>
      <div>{normalizedDeviceId || 'UNKNOWN DEVICE'}</div>
    </div>
  )
}
