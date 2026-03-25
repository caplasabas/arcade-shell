import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Network = {
  ssid: string
  signal: number
}

type KnownProfile = {
  id: string
  ssid: string
  inRange?: boolean
  signal?: number | null
}

type Props = {
  onConnected: () => void
  onClose?: () => void
  onDeleteKnownProfile?: (profile: KnownProfile) => Promise<boolean> | boolean
  currentSsid?: string | null
  wifiConnected?: boolean
  currentIp?: string | null
  ethernetName?: string | null
}

type FocusMode = 'section' | 'known-list' | 'new-list' | 'keyboard'
type Section = 'known' | 'new' | 'refresh'

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

export function WifiSetupModal({
  onConnected,
  onClose,
  onDeleteKnownProfile,
  currentSsid,
  wifiConnected,
  currentIp,
  ethernetName,
}: Props) {
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<KnownProfile | null>(null)
  const knownItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const newItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const clampIndex = (value: number, length: number) => {
    if (length <= 0) return 0
    return Math.max(0, Math.min(length - 1, value))
  }

  const knownNetworks = useMemo(() => {
    const scannedBySsid = new Map(scannedNetworks.map(network => [network.ssid, network]))

    const merged = knownProfiles.map(profile => {
      const scanned = scannedBySsid.get(profile.ssid)
      const isCurrent = Boolean(currentSsid && profile.ssid === currentSsid)

      return {
        ...profile,
        inRange: Boolean(scanned) || isCurrent,
        signal: scanned?.signal ?? null,
      }
    })

    return merged.sort((a, b) => {
      if (a.ssid === currentSsid) return -1
      if (b.ssid === currentSsid) return 1
      if (Boolean(a.inRange) !== Boolean(b.inRange)) return a.inRange ? -1 : 1
      return (b.signal ?? -1) - (a.signal ?? -1)
    })
  }, [currentSsid, knownProfiles, scannedNetworks])

  const otherNetworks = useMemo(
    () =>
      scannedNetworks
        .filter(network => !knownProfiles.some(profile => profile.ssid === network.ssid))
        .sort((a, b) => b.signal - a.signal),
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

      const knownPayload = knownResponse.ok ? ((await knownResponse.json()) as KnownProfile[]) : []
      const scanPayload = scanResponse.ok ? ((await scanResponse.json()) as Network[]) : []

      const nextKnownProfiles = (Array.isArray(knownPayload) ? knownPayload : []).filter(
        item => item?.ssid && item?.id,
      )
      const nextScannedNetworks = (Array.isArray(scanPayload) ? scanPayload : [])
        .filter(item => item?.ssid)
        .sort((a, b) => b.signal - a.signal)

      setKnownProfiles(nextKnownProfiles)
      setScannedNetworks(nextScannedNetworks)
      setKnownIndex(prev => clampIndex(prev, nextKnownProfiles.length))
      setNewIndex(prev =>
        clampIndex(
          prev,
          nextScannedNetworks.filter(
            network => !nextKnownProfiles.some(profile => profile.ssid === network.ssid),
          ).length,
        ),
      )
      setError(null)
    } catch {
      setError('Failed to load networks')
    } finally {
      setScanning(false)
    }
  }, [])

  const handleManualRefresh = useCallback(() => {
    if (loading) return
    setStatusMessage('Refreshing networks…')
    setError(null)
    void refresh()
  }, [loading, refresh])

  useEffect(() => {
    void refresh()

    const interval = window.setInterval(() => {
      void refresh()
    }, 8000)

    return () => window.clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    setKnownIndex(prev => clampIndex(prev, knownNetworks.length))
  }, [knownNetworks.length])

  useEffect(() => {
    setNewIndex(prev => clampIndex(prev, otherNetworks.length))
  }, [otherNetworks.length])

  useEffect(() => {
    if (focusMode !== 'known-list') return
    knownItemRefs.current[knownIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusMode, knownIndex])

  useEffect(() => {
    if (focusMode !== 'new-list') return
    newItemRefs.current[newIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusMode, newIndex])

  const connectKnown = useCallback(
    async (profile: KnownProfile | null) => {
      if (!profile?.id || !profile.inRange) return
      setLoading(true)
      setError(null)
      setStatusMessage(`Connecting to ${profile.ssid}…`)
      try {
        const response = await fetch('http://localhost:5174/wifi-connect-known', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: profile.id, ssid: profile.ssid }),
        })
        const payload = await response.json()
        if (payload.success) {
          setStatusMessage(`Connected to ${profile.ssid}`)
          onConnected()
          return
        }
        setError('Connection failed')
        setStatusMessage(`Failed to connect to ${profile.ssid}`)
      } catch {
        setError('Unable to connect')
        setStatusMessage(`Unable to connect to ${profile.ssid}`)
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
        setStatusMessage('Password required')
        return
      }
      setLoading(true)
      setError(null)
      setStatusMessage(`Connecting to ${ssid}…`)
      try {
        const response = await fetch('http://localhost:5174/wifi-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ssid, password: nextPassword }),
        })
        const payload = await response.json()
        if (payload.success) {
          setStatusMessage(`Connected to ${ssid}`)
          onConnected()
          return
        }
        setError('Connection failed')
        setStatusMessage(`Failed to connect to ${ssid}`)
      } catch {
        setError('Unable to connect')
        setStatusMessage(`Unable to connect to ${ssid}`)
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

  const requestDeleteKnownProfile = useCallback(() => {
    if (loading || focusMode !== 'known-list') return

    const profile = knownNetworks[knownIndex] ?? null
    if (!profile?.id) return

    if (profile.ssid === currentSsid) {
      setError('Cannot delete the currently connected network')
      setStatusMessage('Cannot delete the currently connected network')
      return
    }

    setError(null)
    setStatusMessage(`Delete saved network ${profile.ssid}?`)
    setDeleteConfirmProfile(profile)
  }, [currentSsid, focusMode, knownIndex, knownNetworks, loading])

  const confirmDeleteKnownProfile = useCallback(async () => {
    if (!deleteConfirmProfile || loading) return

    if (!onDeleteKnownProfile) {
      setError('Delete not available')
      setStatusMessage('Delete not available')
      setDeleteConfirmProfile(null)
      return
    }

    setLoading(true)
    setError(null)
    setStatusMessage(`Deleting ${deleteConfirmProfile.ssid}…`)

    try {
      const didDelete = await onDeleteKnownProfile(deleteConfirmProfile)
      if (didDelete) {
        setStatusMessage(`Deleted ${deleteConfirmProfile.ssid}`)
        setDeleteConfirmProfile(null)
        await refresh()
        return
      }

      setError('Delete failed')
      setStatusMessage(`Failed to delete ${deleteConfirmProfile.ssid}`)
    } catch {
      setError('Delete failed')
      setStatusMessage(`Failed to delete ${deleteConfirmProfile.ssid}`)
    } finally {
      setLoading(false)
      setDeleteConfirmProfile(null)
    }
  }, [deleteConfirmProfile, loading, onDeleteKnownProfile, refresh])

  const handleEnter = useCallback(() => {
    if (loading) return
    if (deleteConfirmProfile) {
      void confirmDeleteKnownProfile()
      return
    }
    if (focusMode === 'section') {
      if (section === 'refresh') {
        handleManualRefresh()
        return
      }

      if (section === 'known') {
        if (knownNetworks.length > 0) {
          setFocusMode('known-list')
        } else if (otherNetworks.length > 0) {
          setSection('new')
          setFocusMode('new-list')
        } else {
          handleManualRefresh()
        }
      } else {
        if (otherNetworks.length > 0) {
          setFocusMode('new-list')
        } else if (knownNetworks.length > 0) {
          setSection('known')
          setFocusMode('known-list')
        } else {
          handleManualRefresh()
        }
      }
      return
    }

    if (focusMode === 'known-list') {
      const selectedKnownNetwork = knownNetworks[knownIndex] ?? null
      if (!selectedKnownNetwork) {
        setFocusMode('section')
        return
      }
      if (!selectedKnownNetwork.inRange) {
        setError('Saved network is not currently reachable')
        setStatusMessage(`Saved network ${selectedKnownNetwork.ssid} is not currently reachable`)
        return
      }
      void connectKnown(selectedKnownNetwork)
      return
    }

    if (focusMode === 'new-list') {
      if (!selectedNewNetwork) {
        setFocusMode('section')
        return
      }
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
    handleManualRefresh,
    keyboardCol,
    keyboardRow,
    knownIndex,
    knownNetworks,
    loading,
    otherNetworks.length,
    refresh,
    section,
    selectedNewNetwork,
    confirmDeleteKnownProfile,
    deleteConfirmProfile,
  ])

  const handleBack = useCallback(() => {
    if (loading) return
    if (deleteConfirmProfile) {
      setDeleteConfirmProfile(null)
      setStatusMessage('Delete cancelled')
      return
    }
    if (focusMode === 'keyboard') {
      setFocusMode('new-list')
      return
    }
    if (focusMode === 'known-list' || focusMode === 'new-list') {
      setFocusMode('section')
      return
    }
    onClose?.()
  }, [deleteConfirmProfile, focusMode, loading, onClose])

  const move = useCallback(
    (deltaRow: number, deltaCol: number) => {
      if (loading) return
      if (deleteConfirmProfile) return
      if (focusMode === 'section') {
        if (deltaRow !== 0 || deltaCol !== 0) {
          const sections: Section[] = ['known', 'new', 'refresh']
          const currentIndex = sections.indexOf(section)
          const direction = deltaRow > 0 || deltaCol > 0 ? 1 : -1
          const nextIndex = (currentIndex + direction + sections.length) % sections.length
          setSection(sections[nextIndex])
        }
        return
      }

      if (focusMode === 'known-list') {
        setKnownIndex(prev => clampIndex(prev + deltaRow, knownNetworks.length))
        return
      }

      if (focusMode === 'new-list') {
        setNewIndex(prev => clampIndex(prev + deltaRow, otherNetworks.length))
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
    [deleteConfirmProfile, focusMode, loading, section],
  )

  useEffect(() => {
    const isConfirm = (button: string | number) =>
      button === 0 || button === '0' || button === 'A' || button === 'START'
    const isBack = (button: string | number) =>
      button === 1 || button === '1' || button === 'B' || button === 'MENU'
    const isSelect = (button: string | number) =>
      button === 'SELECT' ||
      button === 'BACK' ||
      button === 6 ||
      button === '6' ||
      button === 8 ||
      button === '8'
    const onInput = (event: Event) => {
      const button = (event as CustomEvent<{ button?: string | number }>).detail?.button
      if (button === undefined || button === null) return

      if (isConfirm(button)) {
        event.stopImmediatePropagation?.()
        handleEnter()
        return
      }

      if (isBack(button)) {
        event.stopImmediatePropagation?.()
        handleBack()
        return
      }

      if (isSelect(button)) {
        event.stopImmediatePropagation?.()
        requestDeleteKnownProfile()
        return
      }

      if (button === 'UP') {
        event.stopImmediatePropagation?.()
        move(-1, 0)
      } else if (button === 'DOWN') {
        event.stopImmediatePropagation?.()
        move(1, 0)
      } else if (button === 'LEFT') {
        event.stopImmediatePropagation?.()
        move(0, -1)
      } else if (button === 'RIGHT') {
        event.stopImmediatePropagation?.()
        move(0, 1)
      }
    }

    window.addEventListener('ARCADE_MODAL_INPUT', onInput)
    return () => window.removeEventListener('ARCADE_MODAL_INPUT', onInput)
  }, [handleBack, handleEnter, move, requestDeleteKnownProfile])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wifi-setup-title"
    >
      <div className="modal-card modal-card-wide" style={{ position: 'relative' }}>
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
            <span>
              {ethernetName
                ? `Ethernet: ${ethernetName}`
                : scanning
                  ? 'Scanning networks…'
                  : 'Wireless setup'}
            </span>
          </div>

          <div className="network-sections">
            <div className={['network-section', section === 'known' ? 'active' : ''].join(' ')}>
              <div className="network-section-title">Known Networks</div>
              <div className="network-scroll-list">
                {knownNetworks.length === 0 && (
                  <div className="modal-network-empty">No saved networks</div>
                )}
                {knownNetworks.map((network, index) => (
                  <button
                    key={network.id}
                    ref={element => {
                      knownItemRefs.current[index] = element
                    }}
                    type="button"
                    style={!network.inRange ? { opacity: 0.5 } : undefined}
                    className={[
                      'network-item',
                      focusMode === 'section' && section === 'known' && index === knownIndex
                        ? 'active'
                        : '',
                      focusMode === 'known-list' && index === knownIndex ? 'active' : '',
                    ].join(' ')}
                    onClick={() => {
                      setSection('known')
                      setKnownIndex(index)
                      setFocusMode('known-list')
                    }}
                  >
                    <span>{network.ssid}</span>
                    <span className="network-item-meta">
                      {network.ssid === currentSsid
                        ? 'Connected'
                        : network.inRange
                          ? `${network.signal ?? 0}%`
                          : 'Not in range'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className={['network-section', section === 'new' ? 'active' : ''].join(' ')}>
              <div className="network-section-title">Other Networks</div>
              <div className="network-scroll-list">
                {otherNetworks.length === 0 && (
                  <div className="modal-network-empty">No networks found</div>
                )}
                {otherNetworks.map((network, index) => (
                  <button
                    key={network.ssid}
                    ref={element => {
                      newItemRefs.current[index] = element
                    }}
                    type="button"
                    className={[
                      'network-item',
                      focusMode === 'section' && section === 'new' && index === newIndex
                        ? 'active'
                        : '',
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
            <div className={['network-section', section === 'refresh' ? 'active' : ''].join(' ')}>
              <div className="network-section-title">Actions</div>
              <div className="network-scroll-list">
                <button
                  type="button"
                  className={[
                    'network-item',
                    focusMode === 'section' && section === 'refresh' ? 'active' : '',
                  ].join(' ')}
                  onClick={handleManualRefresh}
                >
                  <span>{scanning ? 'Refreshing…' : 'Refresh Networks'}</span>
                  <span className="network-item-meta">Action</span>
                </button>
              </div>
            </div>
          </div>
          <div className="modal-row" style={{ marginTop: 12 }}>
            <span>A: Enter / B: Back / SELECT: Delete saved network</span>
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

          {statusMessage && <div style={{ marginTop: 16, color: '#D0D5DD' }}>{statusMessage}</div>}
          {error && <div style={{ marginTop: 16, color: '#EDA29B' }}>{error}</div>}
        </div>

        {deleteConfirmProfile && !loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.55)',
              borderRadius: 16,
              zIndex: 6,
            }}
          >
            <div
              style={{
                width: 'min(420px, calc(100% - 32px))',
                padding: 20,
                borderRadius: 14,
                background: 'rgba(17, 24, 39, 0.96)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#fff',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>Delete saved network?</div>
              <div style={{ color: '#D0D5DD', lineHeight: 1.5 }}>
                Are you sure you want to delete <strong>{deleteConfirmProfile.ssid}</strong>?
              </div>
              <div style={{ marginTop: 14, color: '#D0D5DD' }}>A: Confirm &nbsp; B: Cancel</div>
            </div>
          </div>
        )}
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.55)',
              borderRadius: 16,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                padding: '14px 18px',
                borderRadius: 12,
                background: 'rgba(17, 24, 39, 0.92)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              {statusMessage || 'Connecting…'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
