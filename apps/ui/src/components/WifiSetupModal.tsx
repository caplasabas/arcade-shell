import { useCallback, useEffect, useMemo, useState } from 'react'

type Network = {
  ssid: string
  signal: number
}

type KnownProfile = {
  id: string
  ssid: string
}

type Props = {
  onConnected: () => void
  currentSsid?: string | null
  wifiConnected?: boolean
  currentIp?: string | null
  ethernetName?: string | null
}

type FocusMode = 'section' | 'known-list' | 'new-list' | 'keyboard'
type Section = 'known' | 'new'

type VirtualKey = {
  label: string
  value?: string
  action: 'char' | 'space' | 'backspace' | 'clear' | 'toggle' | 'submit'
}

const KEYBOARD_LAYOUT: VirtualKey[][] = [
  [
    { label: '1', action: 'char', value: '1' },
    { label: '2', action: 'char', value: '2' },
    { label: '3', action: 'char', value: '3' },
    { label: '4', action: 'char', value: '4' },
    { label: '5', action: 'char', value: '5' },
    { label: '6', action: 'char', value: '6' },
    { label: '7', action: 'char', value: '7' },
    { label: '8', action: 'char', value: '8' },
    { label: '9', action: 'char', value: '9' },
    { label: '0', action: 'char', value: '0' },
  ],
  [
    { label: 'Q', action: 'char', value: 'q' },
    { label: 'W', action: 'char', value: 'w' },
    { label: 'E', action: 'char', value: 'e' },
    { label: 'R', action: 'char', value: 'r' },
    { label: 'T', action: 'char', value: 't' },
    { label: 'Y', action: 'char', value: 'y' },
    { label: 'U', action: 'char', value: 'u' },
    { label: 'I', action: 'char', value: 'i' },
    { label: 'O', action: 'char', value: 'o' },
    { label: 'P', action: 'char', value: 'p' },
  ],
  [
    { label: 'A', action: 'char', value: 'a' },
    { label: 'S', action: 'char', value: 's' },
    { label: 'D', action: 'char', value: 'd' },
    { label: 'F', action: 'char', value: 'f' },
    { label: 'G', action: 'char', value: 'g' },
    { label: 'H', action: 'char', value: 'h' },
    { label: 'J', action: 'char', value: 'j' },
    { label: 'K', action: 'char', value: 'k' },
    { label: 'L', action: 'char', value: 'l' },
  ],
  [
    { label: 'Z', action: 'char', value: 'z' },
    { label: 'X', action: 'char', value: 'x' },
    { label: 'C', action: 'char', value: 'c' },
    { label: 'V', action: 'char', value: 'v' },
    { label: 'B', action: 'char', value: 'b' },
    { label: 'N', action: 'char', value: 'n' },
    { label: 'M', action: 'char', value: 'm' },
  ],
  [
    { label: 'Space', action: 'space' },
    { label: 'Bksp', action: 'backspace' },
    { label: 'Clear', action: 'clear' },
    { label: 'Show', action: 'toggle' },
    { label: 'Connect', action: 'submit' },
  ],
]

export function WifiSetupModal({ onConnected, currentSsid, wifiConnected, currentIp, ethernetName }: Props) {
  const [knownProfiles, setKnownProfiles] = useState<KnownProfile[]>([])
  const [scannedNetworks, setScannedNetworks] = useState<Network[]>([])
  const [focusMode, setFocusMode] = useState<FocusMode>('section')
  const [section, setSection] = useState<Section>('known')
  const [knownIndex, setKnownIndex] = useState(0)
  const [newIndex, setNewIndex] = useState(0)
  const [keyboardRow, setKeyboardRow] = useState(0)
  const [keyboardCol, setKeyboardCol] = useState(0)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const knownNetworks = useMemo(() => {
    const visibleKnown = knownProfiles.filter(profile => scannedNetworks.some(network => network.ssid === profile.ssid))

    if (
      currentSsid &&
      knownProfiles.some(profile => profile.ssid === currentSsid) &&
      !visibleKnown.some(profile => profile.ssid === currentSsid)
    ) {
      const currentProfile = knownProfiles.find(profile => profile.ssid === currentSsid)
      if (currentProfile) {
        return [currentProfile, ...visibleKnown]
      }
    }

    return visibleKnown
  }, [currentSsid, knownProfiles, scannedNetworks])

  const otherNetworks = useMemo(
    () => scannedNetworks.filter(network => !knownProfiles.some(profile => profile.ssid === network.ssid)),
    [knownProfiles, scannedNetworks],
  )

  const selectedNewNetwork = otherNetworks[newIndex] ?? null

  const refresh = useCallback(async () => {
    setScanning(true)
    try {
      const [knownResponse, scanResponse] = await Promise.all([
        fetch('http://localhost:5174/wifi-known'),
        fetch('http://localhost:5174/wifi-scan'),
      ])

      const knownPayload = (await knownResponse.json()) as KnownProfile[]
      const scanPayload = (await scanResponse.json()) as Network[]

      setKnownProfiles((Array.isArray(knownPayload) ? knownPayload : []).filter(item => item?.ssid))
      setScannedNetworks(
        (Array.isArray(scanPayload) ? scanPayload : [])
          .filter(item => item?.ssid)
          .sort((a, b) => b.signal - a.signal),
      )
      setError(null)
    } catch {
      setError('Failed to load networks')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connectKnown = useCallback(
    async (profile: KnownProfile | null) => {
      if (!profile?.id) return
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('http://localhost:5174/wifi-connect-known', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: profile.id, ssid: profile.ssid }),
        })
        const payload = await response.json()
        if (payload.success) {
          onConnected()
          return
        }
        setError('Connection failed')
      } catch {
        setError('Unable to connect')
      } finally {
        setLoading(false)
      }
    },
    [onConnected],
  )

  const connectNew = useCallback(
    async (ssid: string, nextPassword: string) => {
      if (!ssid || !nextPassword) {
        setError('Password required')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('http://localhost:5174/wifi-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ssid, password: nextPassword }),
        })
        const payload = await response.json()
        if (payload.success) {
          onConnected()
          return
        }
        setError('Connection failed')
      } catch {
        setError('Unable to connect')
      } finally {
        setLoading(false)
      }
    },
    [onConnected],
  )

  const applyKey = useCallback(
    (key: VirtualKey) => {
      if (key.action === 'char' && key.value) {
        setPassword(prev => prev + key.value)
        return
      }
      if (key.action === 'space') {
        setPassword(prev => prev + ' ')
        return
      }
      if (key.action === 'backspace') {
        setPassword(prev => prev.slice(0, -1))
        return
      }
      if (key.action === 'clear') {
        setPassword('')
        return
      }
      if (key.action === 'toggle') {
        setShowPassword(prev => !prev)
        return
      }
      if (key.action === 'submit') {
        void connectNew(selectedNewNetwork?.ssid ?? '', password)
      }
    },
    [connectNew, password, selectedNewNetwork?.ssid],
  )

  const handleEnter = useCallback(() => {
    if (focusMode === 'section') {
      setFocusMode(section === 'known' ? 'known-list' : 'new-list')
      return
    }

    if (focusMode === 'known-list') {
      void connectKnown(knownNetworks[knownIndex] ?? null)
      return
    }

    if (focusMode === 'new-list') {
      if (!selectedNewNetwork) return
      setPassword('')
      setShowPassword(false)
      setKeyboardRow(0)
      setKeyboardCol(0)
      setFocusMode('keyboard')
      return
    }

    const key = KEYBOARD_LAYOUT[keyboardRow]?.[keyboardCol]
    if (key) applyKey(key)
  }, [
    applyKey,
    connectKnown,
    focusMode,
    keyboardCol,
    keyboardRow,
    knownIndex,
    knownNetworks,
    section,
    selectedNewNetwork,
  ])

  const handleBack = useCallback(() => {
    if (focusMode === 'keyboard') {
      setFocusMode('new-list')
      return
    }
    if (focusMode === 'known-list' || focusMode === 'new-list') {
      setFocusMode('section')
    }
  }, [focusMode])

  const move = useCallback(
    (deltaRow: number, deltaCol: number) => {
      if (focusMode === 'section') {
        if (deltaRow !== 0 || deltaCol !== 0) {
          setSection(prev => (prev === 'known' ? 'new' : 'known'))
        }
        return
      }

      if (focusMode === 'known-list') {
        setKnownIndex(prev => Math.max(0, Math.min(knownNetworks.length - 1, prev + deltaRow)))
        return
      }

      if (focusMode === 'new-list') {
        setNewIndex(prev => Math.max(0, Math.min(otherNetworks.length - 1, prev + deltaRow)))
        return
      }

      setKeyboardRow(prevRow => {
        const nextRow = Math.max(0, Math.min(KEYBOARD_LAYOUT.length - 1, prevRow + deltaRow))
        setKeyboardCol(prevCol => {
          const maxCol = KEYBOARD_LAYOUT[nextRow].length - 1
          return Math.max(0, Math.min(maxCol, prevCol + deltaCol))
        })
        return nextRow
      })
    },
    [focusMode, knownNetworks.length, otherNetworks.length],
  )

  useEffect(() => {
    const isConfirm = (button: string | number) =>
      button === 0 || button === '0' || button === 'A' || button === 'START'
    const isBack = (button: string | number) => button === 1 || button === '1' || button === 'B' || button === 'MENU'
    const onInput = (event: Event) => {
      const button = (event as CustomEvent<{ button?: string | number }>).detail?.button
      if (button === undefined || button === null) return

      if (isConfirm(button)) {
        handleEnter()
        return
      }

      if (isBack(button)) {
        handleBack()
        return
      }

      if (button === 'UP') move(-1, 0)
      else if (button === 'DOWN') move(1, 0)
      else if (button === 'LEFT') move(0, -1)
      else if (button === 'RIGHT') move(0, 1)
    }

    window.addEventListener('ARCADE_MODAL_INPUT', onInput)
    return () => window.removeEventListener('ARCADE_MODAL_INPUT', onInput)
  }, [handleBack, handleEnter, move])

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wifi-setup-title">
      <div className="modal-card modal-card-wide">
        <div className="modal-header">
          <h2 id="wifi-setup-title">WiFi Setup</h2>
        </div>

        <div className="modal-body">
          {wifiConnected && currentSsid && (
            <div className="modal-network-status">
              Connected to <strong>{currentSsid}</strong>
            </div>
          )}

          <div className="modal-network-meta">
            <span>IP: {currentIp || 'n/a'}</span>
            <span>{ethernetName ? `Ethernet: ${ethernetName}` : 'Wireless setup'}</span>
          </div>

          <div className="network-sections">
            <div className={['network-section', section === 'known' ? 'active' : ''].join(' ')}>
              <div className="network-section-title">Known Networks</div>
              <div className="network-scroll-list">
                {knownNetworks.length === 0 && <div className="modal-network-empty">No saved networks</div>}
                {knownNetworks.map((network, index) => (
                  <button
                    key={network.ssid}
                    type="button"
                    className={[
                      'network-item',
                      focusMode === 'section' && section === 'known' && index === knownIndex ? 'active' : '',
                      focusMode === 'known-list' && index === knownIndex ? 'active' : '',
                    ].join(' ')}
                    onClick={() => {
                      setSection('known')
                      setKnownIndex(index)
                      setFocusMode('known-list')
                    }}
                  >
                    <span>{network.ssid}</span>
                    <span className="network-item-meta">{network.ssid === currentSsid ? 'Connected' : 'Saved'}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={['network-section', section === 'new' ? 'active' : ''].join(' ')}>
              <div className="network-section-title">Other Networks</div>
              <div className="network-scroll-list">
                {otherNetworks.length === 0 && <div className="modal-network-empty">No networks found</div>}
                {otherNetworks.map((network, index) => (
                  <button
                    key={network.ssid}
                    type="button"
                    className={[
                      'network-item',
                      focusMode === 'section' && section === 'new' && index === newIndex ? 'active' : '',
                      focusMode === 'new-list' && index === newIndex ? 'active' : '',
                    ].join(' ')}
                    onClick={() => {
                      setSection('new')
                      setNewIndex(index)
                      setFocusMode('keyboard')
                      setPassword('')
                      setShowPassword(false)
                      setKeyboardRow(0)
                      setKeyboardCol(0)
                    }}
                  >
                    <span>{network.ssid}</span>
                    <span className="network-item-meta">{network.signal}%</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {focusMode === 'keyboard' && (
            <>
              <div className="modal-row" style={{ marginTop: 14 }}>
                <span>Password for {selectedNewNetwork?.ssid || 'network'}</span>
              </div>
              <input type={showPassword ? 'text' : 'password'} value={password} readOnly />
              <div className="virtual-keyboard" aria-label="Virtual keyboard">
                {KEYBOARD_LAYOUT.map((row, rowIndex) => (
                  <div key={rowIndex} className="virtual-keyboard-row">
                    {row.map((key, colIndex) => (
                      <button
                        key={`${rowIndex}-${colIndex}-${key.label}`}
                        type="button"
                        className={[
                          'virtual-key',
                          rowIndex === keyboardRow && colIndex === keyboardCol ? 'active' : '',
                        ].join(' ')}
                      >
                        {key.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          {error && <div style={{ marginTop: 16, color: '#EDA29B' }}>{error}</div>}
        </div>

        <div className="modal-actions">
          <button className="modal-confirm" disabled={loading || scanning} onClick={handleEnter}>
            {loading ? 'Connecting…' : 'A: Enter / B: Back'}
          </button>
        </div>
      </div>
    </div>
  )
}
