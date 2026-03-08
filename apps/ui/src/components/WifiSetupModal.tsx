import { useCallback, useEffect, useRef, useState } from 'react'

type Network = {
  ssid: string
  signal: number
}

type VirtualKey = {
  label: string
  action:
    | 'char'
    | 'space'
    | 'backspace'
    | 'clear'
    | 'done'
    | 'shift'
    | 'symbols'
    | 'letters'
    | 'toggle-password'
  value?: string
}

type Props = {
  onConnected: () => void
  currentSsid?: string | null
  wifiConnected?: boolean
}

const LETTERS_LAYOUT: VirtualKey[][] = [
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
    { label: 'SHIFT', action: 'shift' },
    { label: 'SYM', action: 'symbols' },
    { label: 'SPACE', action: 'space' },
    { label: 'BKSP', action: 'backspace' },
    { label: 'SHOW', action: 'toggle-password' },
    { label: 'CLEAR', action: 'clear' },
    { label: 'DONE', action: 'done' },
  ],
]

const SYMBOLS_LAYOUT: VirtualKey[][] = [
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
    { label: '!', action: 'char', value: '!' },
    { label: '@', action: 'char', value: '@' },
    { label: '#', action: 'char', value: '#' },
    { label: '$', action: 'char', value: '$' },
    { label: '%', action: 'char', value: '%' },
    { label: '^', action: 'char', value: '^' },
    { label: '&', action: 'char', value: '&' },
    { label: '*', action: 'char', value: '*' },
    { label: '(', action: 'char', value: '(' },
    { label: ')', action: 'char', value: ')' },
  ],
  [
    { label: '-', action: 'char', value: '-' },
    { label: '_', action: 'char', value: '_' },
    { label: '=', action: 'char', value: '=' },
    { label: '+', action: 'char', value: '+' },
    { label: '[', action: 'char', value: '[' },
    { label: ']', action: 'char', value: ']' },
    { label: '{', action: 'char', value: '{' },
    { label: '}', action: 'char', value: '}' },
    { label: '\\', action: 'char', value: '\\' },
    { label: '|', action: 'char', value: '|' },
  ],
  [
    { label: ';', action: 'char', value: ';' },
    { label: ':', action: 'char', value: ':' },
    { label: "'", action: 'char', value: "'" },
    { label: '"', action: 'char', value: '"' },
    { label: ',', action: 'char', value: ',' },
    { label: '.', action: 'char', value: '.' },
    { label: '/', action: 'char', value: '/' },
    { label: '?', action: 'char', value: '?' },
    { label: '`', action: 'char', value: '`' },
    { label: '~', action: 'char', value: '~' },
  ],
  [
    { label: 'ABC', action: 'letters' },
    { label: 'SPACE', action: 'space' },
    { label: 'BKSP', action: 'backspace' },
    { label: 'SHOW', action: 'toggle-password' },
    { label: 'CLEAR', action: 'clear' },
    { label: 'DONE', action: 'done' },
  ],
]

export function WifiSetupModal({ onConnected, currentSsid, wifiConnected }: Props) {
  const [networks, setNetworks] = useState<Network[]>([])
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerIndex, setPickerIndex] = useState(0)

  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardRow, setKeyboardRow] = useState(0)
  const [keyboardCol, setKeyboardCol] = useState(0)
  const [shiftEnabled, setShiftEnabled] = useState(false)
  const [symbolsMode, setSymbolsMode] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const keyboardLayout = symbolsMode ? SYMBOLS_LAYOUT : LETTERS_LAYOUT

  const uiKeyboardLayout = keyboardLayout.map(row =>
    row.map(key => {
      if (key.action === 'char' && key.value && shiftEnabled && !symbolsMode) {
        return {
          ...key,
          label: key.value.toUpperCase(),
        }
      }

      if (key.action === 'shift') {
        return {
          ...key,
          label: shiftEnabled ? 'SHIFT ON' : 'SHIFT',
        }
      }

      if (key.action === 'toggle-password') {
        return {
          ...key,
          label: showPassword ? 'HIDE' : 'SHOW',
        }
      }

      return key
    }),
  )

  const networkButtonRef = useRef<HTMLButtonElement | null>(null)
  const rescanButtonRef = useRef<HTMLButtonElement | null>(null)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)
  const connectButtonRef = useRef<HTMLButtonElement | null>(null)

  const getFocusOrder = useCallback(
    () =>
      [
        networkButtonRef.current,
        rescanButtonRef.current,
        passwordInputRef.current,
        connectButtonRef.current,
      ].filter(Boolean) as HTMLElement[],
    [],
  )

  const focusByOffset = useCallback(
    (offset: number) => {
      const focusOrder = getFocusOrder()
      if (focusOrder.length === 0) return

      const current = document.activeElement as HTMLElement | null
      const currentIndex = focusOrder.findIndex(node => node === current)
      const base = currentIndex < 0 ? 0 : currentIndex
      const nextIndex = (base + offset + focusOrder.length) % focusOrder.length
      focusOrder[nextIndex]?.focus()
    },
    [getFocusOrder],
  )

  const scanNetworks = useCallback(async () => {
    setScanning(true)

    try {
      const res = await fetch('http://localhost:5174/wifi-scan')
      const data = await res.json()

      const cleaned = data
        .filter((n: Network) => n.ssid)
        .sort((a: Network, b: Network) => b.signal - a.signal)

      setNetworks(cleaned)
      setPickerIndex(0)
      setSsid(prev => (cleaned.some((n: Network) => n.ssid === prev) ? prev : ''))
      setError(null)
    } catch {
      setError('Failed to scan networks')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    scanNetworks()
  }, [scanNetworks])

  useEffect(() => {
    networkButtonRef.current?.focus()
  }, [])

  const connect = useCallback(async () => {
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
  }, [onConnected, password, ssid])

  const applyVirtualKey = useCallback(
    (key: VirtualKey) => {
      if (key.action === 'char' && key.value) {
        const nextValue = shiftEnabled && !symbolsMode ? key.value.toUpperCase() : key.value
        setPassword(prev => prev + nextValue)
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

      if (key.action === 'done') {
        setKeyboardVisible(false)
        passwordInputRef.current?.focus()
        return
      }

      if (key.action === 'shift') {
        setShiftEnabled(prev => !prev)
        return
      }

      if (key.action === 'symbols') {
        setSymbolsMode(true)
        setKeyboardRow(0)
        setKeyboardCol(0)
        return
      }

      if (key.action === 'letters') {
        setSymbolsMode(false)
        setKeyboardRow(0)
        setKeyboardCol(0)
        return
      }

      if (key.action === 'toggle-password') {
        setShowPassword(prev => !prev)
      }
    },
    [shiftEnabled, symbolsMode],
  )

  const moveKeyboard = useCallback(
    (rowDelta: number, colDelta: number) => {
      setKeyboardRow(prevRow => {
        const nextRow = Math.max(0, Math.min(uiKeyboardLayout.length - 1, prevRow + rowDelta))

        setKeyboardCol(prevCol => {
          const maxCol = uiKeyboardLayout[nextRow].length - 1
          return Math.max(0, Math.min(maxCol, prevCol + colDelta))
        })

        return nextRow
      })
    },
    [uiKeyboardLayout],
  )

  const confirmWithP1 = useCallback(() => {
    if (loading || scanning) return

    if (keyboardVisible) {
      const key = uiKeyboardLayout[keyboardRow]?.[keyboardCol]
      if (key) applyVirtualKey(key)
      return
    }

    const active = document.activeElement as HTMLElement | null

    if (active === networkButtonRef.current) {
      if (!pickerOpen) {
        setPickerOpen(true)
      } else {
        const selected = networks[pickerIndex]
        if (selected) {
          setSsid(selected.ssid)
          setPickerOpen(false)
        }
      }
      return
    }

    if (active === passwordInputRef.current) {
      setKeyboardVisible(true)
      setKeyboardRow(0)
      setKeyboardCol(0)
      return
    }

    if (active === connectButtonRef.current) {
      connect()
      return
    }

    active?.click()
  }, [
    applyVirtualKey,
    connect,
    keyboardCol,
    keyboardRow,
    keyboardVisible,
    loading,
    networks,
    pickerIndex,
    pickerOpen,
    scanning,
    uiKeyboardLayout,
  ])

  useEffect(() => {
    const onArcadeInput = (event: Event) => {
      const customEvent = event as CustomEvent<{ button?: string | number }>
      const button = customEvent.detail?.button

      if (button === undefined || button === null) return

      if (button === 1) {
        confirmWithP1()
        return
      }

      if (button === 3 && keyboardVisible) {
        setKeyboardVisible(false)
        passwordInputRef.current?.focus()
        return
      }

      if (keyboardVisible) {
        if (button === 'UP') moveKeyboard(-1, 0)
        else if (button === 'DOWN') moveKeyboard(1, 0)
        else if (button === 'LEFT') moveKeyboard(0, -1)
        else if (button === 'RIGHT') moveKeyboard(0, 1)

        return
      }

      if (pickerOpen) {
        if (button === 'UP') {
          setPickerIndex(prev => Math.max(0, prev - 1))
        } else if (button === 'DOWN') {
          setPickerIndex(prev => Math.min(networks.length - 1, prev + 1))
        }

        return
      }

      if (button === 'UP') {
        focusByOffset(-1)
      } else if (button === 'DOWN') {
        focusByOffset(1)
      }
    }

    window.addEventListener('ARCADE_MODAL_INPUT', onArcadeInput)
    return () => window.removeEventListener('ARCADE_MODAL_INPUT', onArcadeInput)
  }, [confirmWithP1, focusByOffset, keyboardVisible, moveKeyboard, networks.length, pickerOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        return
      }

      if (event.key === 'Tab' && !keyboardVisible && !pickerOpen) {
        event.preventDefault()
        focusByOffset(event.shiftKey ? -1 : 1)
      }

      if (event.key === 'Enter' && !keyboardVisible) {
        const active = document.activeElement as HTMLElement | null

        if (active === connectButtonRef.current) {
          event.preventDefault()
          connect()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connect, focusByOffset, keyboardVisible, pickerOpen])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wifi-setup-title"
      onMouseDown={event => event.preventDefault()}
    >
      <div className="modal-card modal-card-wide" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2 id="wifi-setup-title">WiFi Setup</h2>
        </div>

        <div className="modal-body">
          {wifiConnected && currentSsid && (
            <div className="modal-network-status">
              Connected to <strong>{currentSsid}</strong>, but no internet access.
            </div>
          )}

          <div className="modal-row">
            <span>Select Network</span>
          </div>

          <div className="modal-network-controls">
            <button
              ref={networkButtonRef}
              className="modal-network-picker"
              type="button"
              disabled={loading || scanning}
              onClick={() => {
                if (!pickerOpen) {
                  setPickerOpen(true)
                  return
                }

                const selected = networks[pickerIndex]
                if (selected) {
                  setSsid(selected.ssid)
                }
                setPickerOpen(false)
              }}
            >
              {ssid || '-- Choose Network --'}
            </button>

            <button
              ref={rescanButtonRef}
              type="button"
              className="modal-rescan-btn"
              disabled={loading || scanning}
              onClick={() => {
                setPickerOpen(false)
                scanNetworks()
              }}
            >
              {scanning ? 'Scanning…' : 'Rescan'}
            </button>
          </div>

          {pickerOpen && (
            <div className="modal-network-list" role="listbox" aria-label="Available WiFi networks">
              {networks.length === 0 && (
                <div className="modal-network-empty">No networks found</div>
              )}

              {networks.map((network, index) => {
                const isActive = index === pickerIndex

                return (
                  <button
                    key={`${network.ssid}-${index}`}
                    type="button"
                    className={`modal-network-option ${isActive ? 'active' : ''}`}
                    onMouseEnter={() => setPickerIndex(index)}
                    onClick={() => {
                      setSsid(network.ssid)
                      setPickerOpen(false)
                    }}
                  >
                    {network.ssid} ({network.signal}%)
                  </button>
                )
              })}
            </div>
          )}

          <div className="modal-row" style={{ marginTop: 16 }}>
            <span>Password</span>
          </div>

          <input
            ref={passwordInputRef}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            onFocus={() => setPickerOpen(false)}
          />

          {keyboardVisible && (
            <div className="virtual-keyboard" aria-label="Virtual keyboard">
              {uiKeyboardLayout.map((row, rowIndex) => (
                <div key={rowIndex} className="virtual-keyboard-row">
                  {row.map((key, colIndex) => {
                    const isSelected = rowIndex === keyboardRow && colIndex === keyboardCol

                    return (
                      <button
                        key={`${rowIndex}-${colIndex}-${key.label}`}
                        type="button"
                        className={`virtual-key ${isSelected ? 'active' : ''}`}
                        onMouseEnter={() => {
                          setKeyboardRow(rowIndex)
                          setKeyboardCol(colIndex)
                        }}
                        onClick={() => applyVirtualKey(key)}
                      >
                        {key.action === 'char' && !shiftEnabled
                          ? key.label.toLowerCase()
                          : key.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ marginTop: 16, color: '#EDA29B' }}>{error}</div>}
        </div>

        <div className="modal-actions">
          <button
            ref={connectButtonRef}
            className="modal-confirm"
            disabled={loading}
            onClick={connect}
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
