import { useEffect, useState } from 'react'

type Network = {
  ssid: string
  signal: number
}

type Props = {
  onConnected: () => void
  onCancel: () => void
}

export function WifiSetupModal({ onConnected, onCancel }: Props) {
  const [networks, setNetworks] = useState<Network[]>([])
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function scan() {
      try {
        const res = await fetch('http://localhost:5174/wifi-scan')
        const data = await res.json()

        setNetworks(
          data.filter((n: Network) => n.ssid).sort((a: Network, b: Network) => b.signal - a.signal),
        )
      } catch {
        setError('Failed to scan networks')
      }
    }

    scan()
  }, [])

  async function connect() {
    if (!ssid || !password) {
      setError('Password required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('http://localhost:5174/wifi-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password }),
      })

      const data = await res.json()

      if (data.success) {
        onConnected()
      } else {
        setError('Connection failed')
      }
    } catch {
      setError('Unable to connect')
    }

    setLoading(false)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2>WiFi Setup</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <span>Select Network</span>
          </div>

          <select value={ssid} onChange={e => setSsid(e.target.value)} style={{ height: 40 }}>
            <option value="">-- Choose Network --</option>
            {networks.map(n => (
              <option key={n.ssid} value={n.ssid}>
                {n.ssid} ({n.signal}%)
              </option>
            ))}
          </select>

          <div className="modal-row" style={{ marginTop: 16 }}>
            <span>Password</span>
          </div>

          <input type="password" value={password} onChange={e => setPassword(e.target.value)} />

          {error && <div style={{ marginTop: 16, color: '#EDA29B' }}>{error}</div>}
        </div>

        <div className="modal-actions">
          <button className="modal-cancel" disabled={loading} onClick={onCancel}>
            Back
          </button>

          <button className="modal-confirm" disabled={loading} onClick={connect}>
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
