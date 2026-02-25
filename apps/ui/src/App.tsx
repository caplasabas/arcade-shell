import { useEffect, useRef, useState } from 'react'

import { GameGrid } from './components/GameGrid'
import { NoInternetModal } from './components/NoInternetModal'
import { WifiSetupModal } from './components/WifiSetupModal'

import { exitGame, isGameRunning, launchGame } from './lib/gameLoader'
import { fetchDeviceBalance, subscribeToDeviceBalance } from './lib/balance'
import { fetchCabinetGames, subscribeToCabinetGames, subscribeToGames } from './lib/games'
import { logLedgerEvent } from './lib/accounting'
import { WithdrawModal } from './components/WithdrawModal'

import { ensureDeviceRegistered } from './lib/device'

import { formatPeso } from './utils'

export type GameType = 'arcade' | 'casino'

export type Game = {
  id: string
  name: string
  type: GameType
  price: number
  art: string
  theme?: string
  emulator_core?: string
  rom_path?: string
}

const PAGE_SIZE = 12

type NetworkStage = 'boot' | 'ok' | 'no-internet' | 'wifi-form'
export default function App() {
  const [page, setPage] = useState(0)
  const [focus, setFocus] = useState(0)
  const [runningCasino, setRunningCasino] = useState(false)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)

  const [networkStage, setNetworkStage] = useState<NetworkStage>('boot')

  const internetLossTimerRef = useRef<number | null>(null)

  const [now, setNow] = useState(new Date())
  const [wifiSignal, setWifiSignal] = useState<number | null>(null)
  const [wifiConnected, setWifiConnected] = useState<boolean>(false)

  const [showWifiModal, setShowWifiModal] = useState(false)

  const [initialized, setInitialized] = useState(false)
  const [balance, setBalance] = useState(0)

  const [games, setGames] = useState<Game[]>([])

  const pageCount = Math.ceil(games.length / PAGE_SIZE)
  const pageGames = games.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const selectedGame = pageGames[focus]

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const networkStageRef = useRef(networkStage)

  useEffect(() => {
    networkStageRef.current = networkStage
  }, [networkStage])

  const [loading, setLoading] = useState(false)

  const [runningGame, setRunningGame] = useState<{
    id: string
    type: 'arcade' | 'casino'
    core?: string
    rom?: string
  } | null>(null)

  const runningGameRef = useRef(runningGame)

  useEffect(() => {
    runningGameRef.current = runningGame
  }, [runningGame])

  const [withdrawAmount, setWithdrawAmount] = useState(60)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  useEffect(() => {
    if (networkStage !== 'ok') return
    if (initialized) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    async function init() {
      try {
        const id = await ensureDeviceRegistered('Arcade Cabinet')
        if (cancelled) return

        setDeviceId(id)

        const initialBalance = await fetchDeviceBalance(id)
        if (cancelled) return

        setBalance(initialBalance)

        unsubscribe = subscribeToDeviceBalance(id, newBalance => {
          setBalance(prev => (prev !== newBalance ? newBalance : prev))
        })

        setInitialized(true)
      } catch (err) {
        console.error('Boot failed', err)

        // If backend unreachable, push back to offline state
        setNetworkStage('no-internet')
      }
    }

    init()

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
    }
  }, [networkStage])

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return

    if (networkStage !== 'ok') return

    console.log('[RECOVERY] Re-syncing after reconnect or game exit')

    // 1️⃣ Hard refresh balance
    fetchDeviceBalance(deviceId)
      .then(setBalance)
      .catch(() => {})

    // 2️⃣ Hard refresh games
    fetchCabinetGames(deviceId)
      .then(setGames)
      .catch(() => {})
  }, [networkStage])

  useEffect(() => {
    deviceIdRef.current = deviceId
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) return

    async function load() {
      if (!deviceId) return
      const list = await fetchCabinetGames(deviceId)

      setGames(list)

      const current = runningGameRef.current

      if (current && !list.find(g => g.id === current.id)) {
        handleExitGame()
      }

      setFocus(prev => {
        if (prev >= list.length) {
          return Math.max(0, list.length - 1)
        }
        return prev
      })
    }

    load()

    const unsubGames = subscribeToGames(deviceId, load, disabledGameId => {
      const current = runningGameRef.current
      if (current?.id === disabledGameId) {
        handleExitGame()
      }
    })

    const unsubCabinet = subscribeToCabinetGames(deviceId, load)

    return () => {
      unsubGames()
      unsubCabinet()
    }
  }, [deviceId, runningGame])

  const addBalance = (source = 'coin', amount = 5) => {
    const id = deviceIdRef.current
    if (!id) return

    setBalance(prev => prev + amount)

    logLedgerEvent({
      deviceId: id,
      type: 'deposit',
      amount,
      source,
    }).catch(e => {
      console.log('LEDGER EVENT', e)
      setBalance(prev => prev - amount)
    })
  }

  const minusBalance = (source = 'hopper', amount = 20) => {
    const id = deviceIdRef.current
    if (!id) return

    setBalance(prev => prev - amount)

    logLedgerEvent({
      deviceId: id,
      type: 'withdrawal',
      amount,
      source,
    }).catch(e => {
      console.log('LEDGER EVENT', e)
      setBalance(prev => prev + amount)
    })
  }

  const addWithdrawAmount = () => {
    setWithdrawAmount(prev => {
      return Math.min(prev + 20, balance)
    })
  }

  const minusWithdrawAmount = () => {
    setWithdrawAmount(prev => {
      return Math.max(60, prev - 20)
    })
  }

  const shellStateRef = useRef({
    initialized: false,
    balance: 0,
    withdrawAmount: 0,
    isWithdrawing: false,
    showWithdrawModal: false,
  })

  useEffect(() => {
    shellStateRef.current = {
      initialized,
      balance,
      withdrawAmount,
      isWithdrawing,
      showWithdrawModal,
    }
  }, [initialized, balance, withdrawAmount, isWithdrawing, showWithdrawModal])

  const addWithdrawAmountRef = useRef(addWithdrawAmount)
  const minusWithdrawAmountRef = useRef(minusWithdrawAmount)
  const setShowWithdrawModalRef = useRef(setShowWithdrawModal)
  const setIsWithdrawingRef = useRef(setIsWithdrawing)

  useEffect(() => {
    setShowWithdrawModalRef.current = setShowWithdrawModal
    setIsWithdrawingRef.current = setIsWithdrawing
    addWithdrawAmountRef.current = addWithdrawAmount
    minusWithdrawAmountRef.current = minusWithdrawAmount
  })

  const focusRef = useRef(focus)
  const pageRef = useRef(page)

  const gamesRef = useRef(games)

  const selectedGameRef = useRef(selectedGame)
  const confirmHeldRef = useRef(false)
  const lastMoveRef = useRef(0)

  useEffect(() => {
    focusRef.current = focus
  }, [focus])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  useEffect(() => {
    selectedGameRef.current = selectedGame
  }, [selectedGame])

  useEffect(() => {
    let exitHoldStart = 0

    window.__ARCADE_INPUT__ = payload => {
      const s = shellStateRef.current

      if (payload.type === 'INTERNET_LOST') {
        if (internetLossTimerRef.current) return

        internetLossTimerRef.current = setTimeout(() => {
          setNetworkStage('no-internet')
          internetLossTimerRef.current = null
        }, 3000)

        return
      }

      if (payload.type === 'INTERNET_RESTORED' || payload.type === 'INTERNET_OK') {
        if (internetLossTimerRef.current) {
          clearTimeout(internetLossTimerRef.current)
          internetLossTimerRef.current = null
        }

        setNetworkStage('ok')
        return
      }

      if (payload.type === 'WIFI_STATUS') {
        setWifiConnected(payload.connected)
        setWifiSignal(payload.signal)
        return
      }

      if (networkStageRef.current !== 'ok') return

      console.log('[MENU]', payload)
      if (!payload || !s.initialized) return

      if (payload.type === 'GAME_EXITED') {
        console.log('[UI] GAME_EXITED received')
        handleExitGame()

        if (deviceIdRef.current) {
          fetchDeviceBalance(deviceIdRef.current)
            .then(setBalance)
            .catch(() => {})
          fetchCabinetGames(deviceIdRef.current)
            .then(setGames)
            .catch(() => {})
        }

        return
      }

      // ----------------------------------
      // PLAYER INPUT
      // ----------------------------------
      if (payload.type === 'PLAYER' && payload.player === 'P1') {
        const button = payload.button

        if (!s.showWithdrawModal && !s.isWithdrawing) {
          handleMenuInput(button)
        }

        if (button === 6 && s.showWithdrawModal && !s.isWithdrawing) {
          setShowWithdrawModalRef.current(false)
        }
        // ----------------------------
        // MENU INPUT
        // ----------------------------
      }

      console.log('!runningCasino', !runningCasino)
      if (!runningCasino) {
        if (payload.type === 'COIN') {
          addBalance('coin', payload.credits)
          return
        }

        // --- WITHDRAW COMPLETE ---
        if (payload.type === 'WITHDRAW_DISPENSE') {
          minusBalance('hopper', payload.dispensed)
          return
        }

        if (payload.type === 'WITHDRAW_COMPLETE') {
          setIsWithdrawingRef.current(false)
          setShowWithdrawModalRef.current(false)
          return
        }

        switch (payload.action) {
          case 'TURBO': {
            if (s.showWithdrawModal) {
              setShowWithdrawModalRef.current(false)
              return
            }
            break
          }

          case 'BET_UP': {
            if (s.showWithdrawModal) {
              addWithdrawAmountRef.current()
            }
            break
          }

          case 'BET_DOWN': {
            if (s.showWithdrawModal) {
              minusWithdrawAmountRef.current()
            }
            break
          }

          case 'WITHDRAW': {
            if (!s.showWithdrawModal) {
              setShowWithdrawModalRef.current(true)
            } else if (!s.isWithdrawing && s.balance >= s.withdrawAmount) {
              fetch('http://localhost:5174', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: 'WITHDRAW',
                  amount: s.withdrawAmount,
                }),
              })

              setIsWithdrawingRef.current(true)
            }
            break
          }
        }
      }
    }

    return () => {
      delete window.__ARCADE_INPUT__
    }
  }, [])

  function handleMenuInput(button: any) {
    console.log('HANDLE MENU INPUT', button)
    switch (button) {
      case 'UP':
        moveFocus(-COLS)
        break
      case 'DOWN':
        moveFocus(COLS)
        break
      case 'LEFT':
        moveFocus(-1)
        break
      case 'RIGHT':
        moveFocus(1)
        break
      case 6:
        setTimeout(() => {
          handleExitGame()
        }, 300)

        break
      case 7: // A button still numeric
        if (selectedGameRef.current) launch(selectedGameRef.current)
        break
    }
  }

  function handleExitGame() {
    // if (!runningGame && !runningCasino) return
    setRunningGame(null)
    setRunningCasino(false)
    exitGame()
  }

  const COLS = 4

  const bgOffset = (focus % COLS) * 6

  function moveFocus(delta: number) {
    console.log('MOVE FOCUS', delta)

    setFocus(prev => {
      const currentPage = pageRef.current
      const currentGames = gamesRef.current

      const absoluteIndex = currentPage * PAGE_SIZE + prev
      const nextAbsolute = absoluteIndex + delta

      if (nextAbsolute < 0) return prev
      if (nextAbsolute >= currentGames.length) return prev

      const newPage = Math.floor(nextAbsolute / PAGE_SIZE)
      const newFocus = nextAbsolute % PAGE_SIZE

      if (newPage !== currentPage) {
        setPage(newPage)
      }

      return newFocus
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // EXIT ALWAYS WINS
      if (e.key === 'Escape') {
        handleExitGame()
        return
      }

      // if (isGameRunning()) return

      switch (e.key) {
        case 'ArrowRight':
          moveFocus(1)
          break

        case 'ArrowLeft':
          moveFocus(-1)
          break

        case 'ArrowDown':
          moveFocus(COLS)
          break

        case 'ArrowUp':
          moveFocus(-COLS)
          break

        case 'Enter':
          if (!selectedGame) return
          launch(selectedGame)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, page, selectedGame])

  async function launch(game: Game) {
    if (!game || isGameRunning()) return
    if (networkStageRef.current !== 'ok') return

    if (game.type === 'casino') {
      launchGame({
        id: game.id,
        type: 'casino',
        entry: `/games/${game.id}/index.html`,
      })
      setRunningGame({ id: game.id, type: 'casino' })

      setRunningCasino(true)
    } else {
      launchGame({
        id: game.id,
        type: 'arcade',
        core: game.emulator_core,
        rom: game.rom_path,
      })

      setRunningGame({ id: game.id, type: 'arcade', core: game.emulator_core, rom: game.rom_path })

      fetch('http://localhost:5174', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'LAUNCH_GAME',
          id: game.id,
          core: game.emulator_core,
          rom: game.rom_path,
        }),
      })
    }
  }

  function formatDateTime(d: Date) {
    return d.toLocaleString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function WifiIndicator({ signal, connected }: { signal: number | null; connected: boolean }) {
    let level = 0

    if (signal !== null) {
      if (signal > 75) level = 4
      else if (signal > 50) level = 3
      else if (signal > 25) level = 2
      else level = 1
    }

    const color = connected ? '#ffd84d' : '#ff5757'

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="28" height="20" viewBox="0 0 28 24">
          {/* Bars */}
          {[1, 2, 3, 4].map(bar => {
            const height = bar * 4
            const x = (bar - 1) * 6
            const y = 20 - height

            return (
              <rect
                key={bar}
                x={x}
                y={y}
                width="4"
                height={height}
                rx="1"
                fill={bar <= level ? color : '#555'}
              />
            )
          })}

          {/* Offline slash */}
          {!connected && <line x1="0" y1="0" x2="28" y2="20" stroke="#ff3b3b" strokeWidth="2" />}
        </svg>
      </div>
    )
  }

  if ((!initialized && networkStage === 'ok') || networkStage === 'boot') {
    return (
      <div className="boot-loading">
        <div className="boot-loading-content">
          <div className="boot-spinner" />
          <div className="boot-text">Initializing…</div>
        </div>
      </div>
    )
  }

  if (networkStage !== 'ok') {
    return (
      <>
        {networkStage === 'no-internet' && (
          <NoInternetModal onConnect={() => setNetworkStage('wifi-form')} />
        )}

        {networkStage === 'wifi-form' && (
          <WifiSetupModal
            onConnected={() => setNetworkStage('ok')}
            onCancel={() => setNetworkStage('no-internet')}
          />
        )}
      </>
    )
  }

  return (
    <div>
      {showWithdrawModal && (
        <WithdrawModal
          withdrawAmount={withdrawAmount}
          balance={balance}
          isWithdrawing={isWithdrawing}
          onAddAmount={addWithdrawAmount}
          onMinusAmount={minusWithdrawAmount}
          onCancel={() => setShowWithdrawModal(false)}
          onConfirm={() => {
            fetch('http://localhost:5174', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'WITHDRAW',
                amount: withdrawAmount,
              }),
            })
            setIsWithdrawing(true)
          }}
        />
      )}
      {selectedGame && (
        <div className="scene-bg" style={{ backgroundImage: `url(${selectedGame.art})` }} />
      )}

      <div className="top-status-bar">
        <div>{formatDateTime(now)}</div>

        <WifiIndicator signal={wifiSignal} connected={wifiConnected} />
      </div>

      <GameGrid games={pageGames} focusedIndex={focus} page={page} />

      <div className="overlay-hud">
        <div className="balance-display">
          Balance <span className="balance-amount">{formatPeso(balance ?? 0)}</span>
        </div>

        <div className="device-info">
          <label className="device-label">
            Device:<span>{deviceId}</span>{' '}
          </label>
        </div>
      </div>
      {runningCasino && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'black',
            zIndex: 9999,
          }}
        >
          <iframe
            src="/games/ultraace/index.html"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            allow="gamepad; fullscreen"
          />
        </div>
      )}
    </div>
  )
}
