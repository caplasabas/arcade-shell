import { useCallback, useEffect, useRef, useState } from 'react'

import { GameGrid } from './components/GameGrid'
import { NoInternetModal } from './components/NoInternetModal'
import { WifiSetupModal } from './components/WifiSetupModal'
import { SettingsModal } from './components/SettingsModal'

import { ArcadeShellVersionBadge } from './components/ArcadeShellVersionBadge'

import { exitGame, isGameRunning, launchGame } from './lib/gameLoader'
import { fetchDeviceBalance, subscribeToDeviceBalance } from './lib/balance'
import { fetchCabinetGames, subscribeToCabinetGames, subscribeToGames } from './lib/games'
import { WithdrawModal } from './components/WithdrawModal'
import { type ExitConfirmContext, ExitConfirmModal } from './components/ExitConfirmModal'

import { ensureDeviceRegistered } from './lib/device'
import { flushMetricEvents, queueMetricEvent } from './lib/metrics'
import { API_BASE } from './lib/runtime'

import { supabase } from './lib/supabase'

import { formatPeso } from './utils'
import bootImage from './assets/boot.png'

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
  join_mode?: 'simultaneous' | 'alternating' | 'single_only'
  package_url?: string
  version?: number
}

const GRID_ROWS = 3
const GRID_VISIBLE_COLS = 4
const EXIT_CONFIRM_WINDOW_MS = 2800
const BOOT_UPDATER_NETWORK_GRACE_MS = 4500

type NetworkStage = 'boot' | 'ok' | 'no-internet' | 'wifi-form'
const INTERNET_LOSS_UI_DEBOUNCE_MS = 1200
const ARCADE_SHELL_VERSION =
  String(import.meta.env.VITE_ARCADE_SHELL_VERSION || '').trim() || '0.6.0'
type SettingsItem = 'volume' | 'network' | 'reboot' | 'shutdown'

type ShellUpdateStatus = {
  status?: string
  running?: boolean
  phase?: string | null
  label?: string
  detail?: string | null
  message?: string
}

type DeviceAdminCommandType = 'restart' | 'shutdown'

type DeviceAdminCommandRow = {
  id: number
  device_id: string
  command: DeviceAdminCommandType
  status: string
}

type ArcadeLifeOverlayState = {
  active: boolean
  status: string
  gameId: string | null
  gameName: string | null
  pricePerLife: number
  p1Unlocked: boolean
  p2Unlocked: boolean
  balance: number | null
}

type TransitionOverlayState = {
  visible: boolean
  label: string
  detail?: string | null
}

function normalizeDeviceAdminCommand(raw: any): DeviceAdminCommandRow | null {
  const id = Number(raw?.id ?? 0)
  const device_id = String(raw?.device_id ?? '').trim()
  const command = String(raw?.command ?? '')
    .trim()
    .toLowerCase()
  const status = String(raw?.status ?? '')
    .trim()
    .toLowerCase()

  if (!Number.isFinite(id) || id <= 0) return null
  if (!device_id) return null
  if (command !== 'restart' && command !== 'shutdown') return null

  return {
    id,
    device_id,
    command,
    status,
  }
}

export default function App() {
  const [focus, setFocus] = useState(0)
  const [runningCasino, setRunningCasino] = useState(false)
  const [runningCasinoSrc, setRunningCasinoSrc] = useState<string | null>(null)
  const casinoFrameRef = useRef<HTMLIFrameElement | null>(null)
  const [casinoPreparing, setCasinoPreparing] = useState(false)
  const [casinoPreparingDetail, setCasinoPreparingDetail] = useState<string | null>(null)
  const [casinoLaunchError, setCasinoLaunchError] = useState<string | null>(null)
  const preparedCasinoVersionRef = useRef<Record<string, number>>({})

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const recoveryInFlightRef = useRef(false)
  const adminCommandsInFlightRef = useRef<Set<number>>(new Set())

  const [networkStage, setNetworkStage] = useState<NetworkStage>('boot')

  const internetLossTimerRef = useRef<number | null>(null)

  const [now, setNow] = useState(new Date())
  const [wifiSignal, setWifiSignal] = useState<number | null>(null)
  const [wifiConnected, setWifiConnected] = useState<boolean>(false)
  const [wifiSsid, setWifiSsid] = useState<string | null>(null)
  const [ethernetIp, setEthernetIp] = useState<string | null>(null)
  const [wifiIp, setWifiIp] = useState<string | null>(null)

  const [showWifiModal, setShowWifiModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsFocused, setSettingsFocused] = useState(false)
  const [selectedSettingsItem, setSelectedSettingsItem] = useState<SettingsItem>('volume')
  const [volumeLabel, setVolumeLabel] = useState('100%')
  const [volumePercent, setVolumePercent] = useState<number | null>(null)
  const [uiNotice, setUiNotice] = useState<string | null>(null)

  const [initialized, setInitialized] = useState(false)
  const [balance, setBalance] = useState(0)

  const [games, setGames] = useState<Game[]>([])

  const selectedGame = games[focus] ?? null
  const hasLocalLink = wifiConnected || Boolean(ethernetIp)

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!casinoLaunchError) return
    const timer = window.setTimeout(() => setCasinoLaunchError(null), 4000)
    return () => window.clearTimeout(timer)
  }, [casinoLaunchError])

  useEffect(() => {
    if (!uiNotice) return
    const timer = window.setTimeout(() => setUiNotice(null), 2200)
    return () => window.clearTimeout(timer)
  }, [uiNotice])

  useEffect(() => {
    let stopped = false

    const fetchNetworkInfo = async () => {
      try {
        const res = await fetch(`${API_BASE}/network-info`)
        if (!res.ok) return
        const data = (await res.json()) as { ethernet?: string | null; wifi?: string | null }
        if (stopped) return
        setEthernetIp(data.ethernet ?? null)
        setWifiIp(data.wifi ?? null)
      } catch {
        // ignore transient network info failures
      }
    }

    fetchNetworkInfo()
    const interval = window.setInterval(fetchNetworkInfo, 5000)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [])

  const balanceRef = useRef(balance)
  useEffect(() => {
    balanceRef.current = balance
  }, [balance])

  const wifiConnectedRef = useRef(wifiConnected)
  useEffect(() => {
    wifiConnectedRef.current = wifiConnected
  }, [wifiConnected])

  const ethernetIpRef = useRef(ethernetIp)
  useEffect(() => {
    ethernetIpRef.current = ethernetIp
  }, [ethernetIp])

  const networkStageRef = useRef(networkStage)

  useEffect(() => {
    networkStageRef.current = networkStage
  }, [networkStage])

  const hasLocalLinkRef = useRef(false)
  useEffect(() => {
    hasLocalLinkRef.current = Boolean(wifiConnected || ethernetIp)
  }, [wifiConnected, ethernetIp])

  const [loading, setLoading] = useState(false)
  const [transitionOverlay, setTransitionOverlay] = useState<TransitionOverlayState>({
    visible: false,
    label: 'Loading Game...',
    detail: null,
  })
  const [bootFlowComplete, setBootFlowComplete] = useState(false)
  const [shellUpdateOverlayVisible, setShellUpdateOverlayVisible] = useState(false)
  const [shellUpdateOverlayStatus, setShellUpdateOverlayStatus] = useState<ShellUpdateStatus>({
    label: 'Checking for updates',
    detail: null,
  })
  const shellUpdateRequestedRef = useRef(false)
  const shellUpdateSkippedThisBootRef = useRef(false)
  const shellUpdateStableTimerRef = useRef<number | null>(null)
  const bootOverlayLabel = (
    shellUpdateOverlayStatus.label?.trim() ||
    shellUpdateOverlayStatus.message?.trim() ||
    'Preparing system'
  ).trim()
  const bootOverlayDetail = shellUpdateOverlayStatus.detail?.trim() || null

  const [runningGame, setRunningGame] = useState<{
    id: string
    type: 'arcade' | 'casino'
    core?: string
    rom?: string
  } | null>(null)
  const [arcadeLifeOverlay, setArcadeLifeOverlay] = useState<ArcadeLifeOverlayState>({
    active: false,
    status: 'idle',
    gameId: null,
    gameName: null,
    pricePerLife: 10,
    p1Unlocked: false,
    p2Unlocked: false,
    balance: null,
  })

  const runningGameRef = useRef(runningGame)

  useEffect(() => {
    runningGameRef.current = runningGame
  }, [runningGame])

  const [withdrawAmount, setWithdrawAmount] = useState(60)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false)
  const [exitConfirmContext, setExitConfirmContext] = useState<ExitConfirmContext | null>(null)
  const volumeAdjustRef = useRef<{ direction: 'up' | 'down' | null; at: number; streak: number }>({
    direction: null,
    at: 0,
    streak: 0,
  })

  const exitConfirmDeadlineRef = useRef(0)
  const exitConfirmTimerRef = useRef<number | null>(null)

  const isMissingDeviceRowError = (err: unknown) => {
    const code = String((err as any)?.code ?? '')
    const message = String((err as any)?.message ?? '')
    const details = String((err as any)?.details ?? '')
    return (
      code === 'PGRST116' ||
      message.toLowerCase().includes('0 rows') ||
      details.toLowerCase().includes('0 rows')
    )
  }

  const recoverDeviceState = useCallback(async (reason: string) => {
    if (recoveryInFlightRef.current) return

    recoveryInFlightRef.current = true
    setLoading(true)
    try {
      console.log(`[RECOVERY] Auto re-init start (${reason})`)
      const id = await ensureDeviceRegistered('Arcade Cabinet')
      deviceIdRef.current = id
      setDeviceId(current => (current === id ? current : id))

      const [nextBalance, nextGames] = await Promise.all([
        fetchDeviceBalance(id).catch(() => 0),
        fetchCabinetGames(id).catch(() => [] as Game[]),
      ])

      setBalance(nextBalance)
      setGames(nextGames)
      setInitialized(true)
      setNetworkStage('ok')

      const current = runningGameRef.current
      if (current && !nextGames.find(g => g.id === current.id)) {
        handleExitGame()
      }

      setFocus(prev => {
        if (prev >= nextGames.length) {
          return Math.max(0, nextGames.length - 1)
        }
        return prev
      })

      console.log(`[RECOVERY] Auto re-init complete (${reason})`)
    } catch (err) {
      console.error(`[RECOVERY] Auto re-init failed (${reason})`, err)
    } finally {
      setLoading(false)
      recoveryInFlightRef.current = false
    }
  }, [])

  const executeLocalPowerCommand = useCallback(async (command: DeviceAdminCommandType) => {
    const endpoint = command === 'restart' ? '/system/restart' : '/system/shutdown'
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'device_admin_commands',
        requestedAt: new Date().toISOString(),
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Local ${command} failed (${response.status})${text ? `: ${text}` : ''}`)
    }
  }, [])

  const flashUiNotice = useCallback((message: string) => {
    setUiNotice(message)
  }, [])

  const refreshVolumeState = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/system/volume`)
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; volume?: string; percent?: number | null; error?: string }
        | null

      if (!response.ok) {
        throw new Error(`volume read failed (${response.status})`)
      }

      if (payload?.error === 'NO_AUDIO_DEVICE' || payload?.volume === 'NO AUDIO DEVICE') {
        setVolumeLabel('NO AUDIO DEVICE')
        setVolumePercent(null)
        return
      }

      const nextPercent = typeof payload?.percent === 'number' ? payload.percent : 0
      setVolumeLabel(`${nextPercent}%`)
      setVolumePercent(nextPercent)
    } catch (error) {
      console.error('[SETTINGS] volume refresh failed', error)
      setVolumeLabel('VOLUME ERROR')
      setVolumePercent(null)
    }
  }, [])

  const adjustVolume = useCallback(
    async (direction: 'up' | 'down') => {
      try {
        const now = Date.now()
        const prev = volumeAdjustRef.current
        const streak =
          prev.direction === direction && now - prev.at < 450 ? Math.min(prev.streak + 1, 5) : 1
        volumeAdjustRef.current = { direction, at: now, streak }
        const step = streak >= 5 ? 8 : streak >= 4 ? 6 : streak >= 3 ? 4 : streak >= 2 ? 2 : 1

        const response = await fetch(`${API_BASE}/system/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction, step }),
        })
        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; volume?: string; percent?: number | null; error?: string }
          | null
        if (!response.ok) {
          if (payload?.error === 'NO_AUDIO_DEVICE' || payload?.volume === 'NO AUDIO DEVICE') {
            setVolumeLabel('NO AUDIO DEVICE')
            setVolumePercent(null)
            flashUiNotice('NO AUDIO DEVICE')
            return
          }
          throw new Error(`volume failed (${response.status})`)
        }
        if (payload?.volume) {
          if (payload.volume === 'NO AUDIO DEVICE') {
            setVolumeLabel('NO AUDIO DEVICE')
            setVolumePercent(null)
            flashUiNotice('NO AUDIO DEVICE')
            return
          }
          const nextPercent = typeof payload?.percent === 'number' ? payload.percent : null
          setVolumeLabel(nextPercent === null ? '0%' : `${nextPercent}%`)
          setVolumePercent(nextPercent)
          flashUiNotice(nextPercent === null ? 'VOLUME' : `${nextPercent}%`)
          return
        }
        flashUiNotice(direction === 'up' ? 'VOLUME UP' : 'VOLUME DOWN')
      } catch (error) {
        console.error('[SETTINGS] volume adjust failed', error)
        flashUiNotice('VOLUME ERROR')
      }
    },
    [flashUiNotice],
  )

  useEffect(() => {
    if (!showSettingsModal) return
    void refreshVolumeState()
  }, [refreshVolumeState, showSettingsModal])

  const closeSettingsModal = useCallback(() => {
    setShowSettingsModal(false)
    setShowWifiModal(false)
  }, [])

  const openSettingsModal = useCallback(() => {
    setSelectedSettingsItem('volume')
    setShowSettingsModal(true)
  }, [])

  const openNetworkSettings = useCallback(() => {
    setShowSettingsModal(false)
    setShowWifiModal(true)
  }, [])

  const handleSettingsAction = useCallback(async () => {
    switch (selectedSettingsItem) {
      case 'volume':
        return
      case 'network':
        openNetworkSettings()
        return
      case 'reboot':
        flashUiNotice('REBOOTING')
        await executeLocalPowerCommand('restart').catch(error => {
          console.error('[SETTINGS] reboot failed', error)
          flashUiNotice('REBOOT FAILED')
        })
        return
      case 'shutdown':
        flashUiNotice('SHUTTING DOWN')
        await executeLocalPowerCommand('shutdown').catch(error => {
          console.error('[SETTINGS] shutdown failed', error)
          flashUiNotice('SHUTDOWN FAILED')
        })
        return
    }
  }, [executeLocalPowerCommand, flashUiNotice, openNetworkSettings, selectedSettingsItem])

  const processAdminCommand = useCallback(
    async (command: DeviceAdminCommandRow) => {
      if (adminCommandsInFlightRef.current.has(command.id)) return
      adminCommandsInFlightRef.current.add(command.id)

      try {
        const processingAt = new Date().toISOString()
        const { data: claimed, error: claimError } = await supabase
          .from('device_admin_commands')
          .update({
            status: 'processing',
            processed_at: processingAt,
            updated_at: processingAt,
            error: null,
          })
          .eq('id', command.id)
          .eq('status', 'queued')
          .select('id,device_id,command,status')
          .maybeSingle()

        if (claimError) throw claimError
        if (!claimed) return

        const claimedCommand = normalizeDeviceAdminCommand(claimed)
        if (!claimedCommand) return

        await executeLocalPowerCommand(claimedCommand.command)

        const completedAt = new Date().toISOString()
        const { error: completeError } = await supabase
          .from('device_admin_commands')
          .update({
            status: 'completed',
            completed_at: completedAt,
            updated_at: completedAt,
            result: {
              ok: true,
              handled_by: deviceIdRef.current,
              completed_at: completedAt,
            },
          })
          .eq('id', claimedCommand.id)
          .eq('status', 'processing')
        if (completeError) throw completeError
      } catch (err) {
        console.error('[ADMIN CMD] processing failed', err)
        const failedAt = new Date().toISOString()
        const failError = String((err as any)?.message ?? err ?? 'Unknown error')
        await supabase
          .from('device_admin_commands')
          .update({
            status: 'failed',
            completed_at: failedAt,
            updated_at: failedAt,
            error: failError,
          })
          .eq('id', command.id)
          .eq('status', 'processing')
      } finally {
        adminCommandsInFlightRef.current.delete(command.id)
      }
    },
    [executeLocalPowerCommand],
  )

  useEffect(() => {
    if (networkStage !== 'ok') return
    if (initialized) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    async function init() {
      setLoading(true)
      try {
        const id = await ensureDeviceRegistered('Arcade Cabinet')
        if (cancelled) return

        setDeviceId(id)

        let initialBalance: number
        try {
          initialBalance = await fetchDeviceBalance(id)
        } catch (err) {
          if (!isMissingDeviceRowError(err)) throw err
          // RESET may have removed the row while app stayed mounted; recreate and retry.
          await ensureDeviceRegistered('Arcade Cabinet')
          initialBalance = await fetchDeviceBalance(id)
        }
        if (cancelled) return

        setBalance(initialBalance)

        unsubscribe = subscribeToDeviceBalance(id, newBalance => {
          setBalance(prev => (prev !== newBalance ? newBalance : prev))
        })

        setInitialized(true)
      } catch (err) {
        console.error('Boot failed', err)

        // Keep the shell usable when the Pi still has a local network link but
        // remote services are slow or temporarily unreachable.
        setNetworkStage(wifiConnectedRef.current || Boolean(ethernetIpRef.current) ? 'ok' : 'no-internet')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
    }
  }, [networkStage])

  useEffect(() => {
    if (networkStage !== 'ok' || !initialized) {
      if (shellUpdateStableTimerRef.current !== null) {
        window.clearTimeout(shellUpdateStableTimerRef.current)
        shellUpdateStableTimerRef.current = null
      }
      return
    }

    if (bootFlowComplete || shellUpdateRequestedRef.current || shellUpdateSkippedThisBootRef.current)
      return

    shellUpdateStableTimerRef.current = window.setTimeout(async () => {
      shellUpdateStableTimerRef.current = null

      if (shellUpdateRequestedRef.current) return
      shellUpdateRequestedRef.current = true
      setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
      setShellUpdateOverlayVisible(true)

      try {
        const runResponse = await fetch(`${API_BASE}/arcade-shell-update/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'ui-stable-online' }),
        })

        if (!runResponse.ok) return

        const runPayload = (await runResponse.json().catch(() => null)) as {
          status?: ShellUpdateStatus
        } | null
        if (runPayload?.status) {
          setShellUpdateOverlayStatus(runPayload.status)
        }

        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 500))

          const statusResponse = await fetch(`${API_BASE}/arcade-shell-update/status`, {
            cache: 'no-store',
          }).catch(() => null)

          if (!statusResponse?.ok) continue

          const status = (await statusResponse.json()) as ShellUpdateStatus
          setShellUpdateOverlayStatus(status)

          if (!status.running && status.status && status.status !== 'running') {
            break
          }
        }
      } catch (error) {
        console.error('[UPDATER] failed to trigger', error)
      } finally {
        setShellUpdateOverlayVisible(false)
        setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
        setBootFlowComplete(true)
      }
    }, 2500)

    return () => {
      if (shellUpdateStableTimerRef.current !== null) {
        window.clearTimeout(shellUpdateStableTimerRef.current)
        shellUpdateStableTimerRef.current = null
      }
    }
  }, [bootFlowComplete, initialized, networkStage])

  useEffect(() => {
    if (bootFlowComplete) return

    const timer = window.setTimeout(() => {
      if (shellUpdateRequestedRef.current || shellUpdateSkippedThisBootRef.current) return
      if (networkStageRef.current === 'ok') return

      shellUpdateSkippedThisBootRef.current = true
      setShellUpdateOverlayVisible(false)
      setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
      setBootFlowComplete(true)

      if (networkStageRef.current === 'boot') {
        setNetworkStage(wifiConnectedRef.current || Boolean(ethernetIpRef.current) ? 'ok' : 'no-internet')
      }
    }, BOOT_UPDATER_NETWORK_GRACE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [bootFlowComplete])

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return

    if (networkStage !== 'ok') return

    console.log('[RECOVERY] Re-syncing after reconnect or game exit')

    // 1️⃣ Hard refresh balance
    fetchDeviceBalance(deviceId)
      .then(setBalance)
      .catch(err => {
        if (isMissingDeviceRowError(err)) {
          void recoverDeviceState('network-recovery-missing-device')
        }
      })

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

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return
    if (networkStage !== 'ok') return

    let cancelled = false
    let inFlight = false

    const hardSync = async () => {
      if (inFlight || cancelled) return
      inFlight = true

      try {
        const [nextBalance, nextGames] = await Promise.all([
          fetchDeviceBalance(deviceId),
          fetchCabinetGames(deviceId),
        ])

        if (cancelled) return

        setBalance(nextBalance)
        setGames(nextGames)

        const current = runningGameRef.current
        if (current && !nextGames.find(g => g.id === current.id)) {
          handleExitGame()
        }

        setFocus(prev => {
          if (prev >= nextGames.length) {
            return Math.max(0, nextGames.length - 1)
          }
          return prev
        })
      } catch (err) {
        // Device reset can remove row while UI is still running; self-heal without manual restart.
        if (isMissingDeviceRowError(err)) {
          void recoverDeviceState('hard-sync-missing-device')
        }
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        hardSync()
      }
    }

    const onFocus = () => hardSync()
    const onOnline = () => hardSync()

    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        hardSync()
      }
    }, 5000)

    hardSync()

    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [deviceId, initialized, networkStage, recoverDeviceState])

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return

    const channel = supabase
      .channel(`device-reset-watch-${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'devices',
          filter: `device_id=eq.${deviceId}`,
        },
        () => {
          void recoverDeviceState('device-delete-realtime')
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [deviceId, initialized, recoverDeviceState])

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return

    let cancelled = false

    const fetchQueuedCommands = async () => {
      const { data, error } = await supabase
        .from('device_admin_commands')
        .select('id,device_id,command,status,requested_at')
        .eq('device_id', deviceId)
        .eq('status', 'queued')
        .order('requested_at', { ascending: true })
        .limit(10)

      if (cancelled || error) return

      for (const raw of data ?? []) {
        const command = normalizeDeviceAdminCommand(raw)
        if (!command) continue
        void processAdminCommand(command)
      }
    }

    void fetchQueuedCommands()

    const channel = supabase
      .channel(`device-admin-commands-${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'device_admin_commands',
          filter: `device_id=eq.${deviceId}`,
        },
        payload => {
          const command = normalizeDeviceAdminCommand(payload.new)
          if (!command || command.status !== 'queued') return
          void processAdminCommand(command)
        },
      )
      .subscribe()

    const poll = window.setInterval(() => {
      void fetchQueuedCommands()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [deviceId, initialized, processAdminCommand])

  useEffect(() => {
    if (!initialized) return
    if (networkStage !== 'ok') return

    const timer = window.setTimeout(() => {
      console.log('[UI BALANCE PUSH]', balance)

      fetch(`${API_BASE}/arcade-life/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance }),
      }).catch(err => {
        console.error('[UI BALANCE PUSH] failed', err)
      })
    }, 80)

    return () => window.clearTimeout(timer)
  }, [balance, initialized, networkStage])

  const addBalance = (source = 'coin', amount = 5) => {
    const id = deviceIdRef.current
    if (!id) return

    setBalance(prev => prev + amount)
    queueMetricEvent(id, 'coins_in', amount)
  }

  const minusBalance = (source = 'hopper', amount = 20) => {
    const id = deviceIdRef.current
    if (!id) return

    setBalance(prev => prev - amount)
    if (source === 'hopper') {
      queueMetricEvent(id, 'withdrawal', amount)
    }
  }

  const addHopperBalance = (amount = 20) => {
    const id = deviceIdRef.current
    if (!id) return
    queueMetricEvent(id, 'hopper_in', amount)
  }

  const recordBet = (amount = 0) => {
    const id = deviceIdRef.current
    if (!id || amount <= 0) return
    setBalance(prev => prev - amount)
    queueMetricEvent(id, 'bet', amount)
  }

  const recordWin = (amount = 0) => {
    const id = deviceIdRef.current
    if (!id || amount <= 0) return
    setBalance(prev => prev + amount)
    queueMetricEvent(id, 'win', amount)
  }

  const STEP = 20
  const MIN = 60
  const getMaxSelectable = (balance: number) => {
    return Math.floor(balance / STEP) * STEP
  }
  const isValidWithdrawAmount = (amount: number, balanceValue: number) => {
    if (!Number.isFinite(amount)) return false
    const max = getMaxSelectable(balanceValue)
    return amount >= MIN && amount <= max && amount % STEP === 0
  }
  const maxSelectable = getMaxSelectable(balance)
  const isWithdrawDisabled = maxSelectable < MIN

  const addWithdrawAmount = () => {
    if (isWithdrawDisabled) return
    setWithdrawAmount(prev => {
      const max = getMaxSelectable(balance)
      return Math.min(prev + STEP, max)
    })
  }

  const minusWithdrawAmount = () => {
    if (isWithdrawDisabled) return
    setWithdrawAmount(prev => {
      return Math.max(MIN, prev - STEP)
    })
  }

  useEffect(() => {
    if (!showWithdrawModal) return
    if (isWithdrawDisabled) return
    const max = getMaxSelectable(balance)
    setWithdrawAmount(prev => {
      const normalized = Math.floor(prev / STEP) * STEP
      const withMin = Math.max(MIN, normalized)
      return Math.min(withMin, max)
    })
  }, [showWithdrawModal, isWithdrawDisabled, balance])

  const clearExitConfirmTimer = useCallback(() => {
    if (exitConfirmTimerRef.current !== null) {
      window.clearTimeout(exitConfirmTimerRef.current)
      exitConfirmTimerRef.current = null
    }
  }, [])

  const closeExitConfirm = useCallback(() => {
    clearExitConfirmTimer()
    exitConfirmDeadlineRef.current = 0
    setShowExitConfirmModal(false)
    setExitConfirmContext(null)
  }, [clearExitConfirmTimer])

  const confirmExit = useCallback(() => {
    closeExitConfirm()
    setTimeout(() => {
      handleExitGame()
    }, 120)
  }, [closeExitConfirm])

  const requestExitConfirm = useCallback(
    (context: ExitConfirmContext) => {
      if (!runningGameRef.current && !runningCasino) return

      const now = Date.now()
      if (
        showExitConfirmModal &&
        exitConfirmContext === context &&
        exitConfirmDeadlineRef.current > now
      ) {
        confirmExit()
        return
      }

      clearExitConfirmTimer()
      setShowWithdrawModal(false)
      setExitConfirmContext(context)
      setShowExitConfirmModal(true)

      exitConfirmDeadlineRef.current = now + EXIT_CONFIRM_WINDOW_MS
      exitConfirmTimerRef.current = window.setTimeout(() => {
        closeExitConfirm()
      }, EXIT_CONFIRM_WINDOW_MS)
    },
    [
      clearExitConfirmTimer,
      closeExitConfirm,
      confirmExit,
      exitConfirmContext,
      runningCasino,
      showExitConfirmModal,
    ],
  )

  useEffect(() => {
    return () => {
      clearExitConfirmTimer()
    }
  }, [clearExitConfirmTimer])

  const shellStateRef = useRef({
    initialized: false,
    balance: 0,
    withdrawAmount: 0,
    isWithdrawing: false,
    showWithdrawModal: false,
    showExitConfirmModal: false,
    runningCasino: false,
    showSettingsModal: false,
    showWifiModal: false,
  })

  useEffect(() => {
    shellStateRef.current = {
      initialized,
      balance,
      withdrawAmount,
      isWithdrawing,
      showWithdrawModal,
      showExitConfirmModal,
      runningCasino,
      showSettingsModal,
      showWifiModal,
    }
  }, [
    initialized,
    balance,
    withdrawAmount,
    isWithdrawing,
    showWithdrawModal,
    showExitConfirmModal,
    runningCasino,
    showSettingsModal,
    showWifiModal,
  ])

  const addWithdrawAmountRef = useRef(addWithdrawAmount)
  const minusWithdrawAmountRef = useRef(minusWithdrawAmount)
  const setShowWithdrawModalRef = useRef(setShowWithdrawModal)
  const setIsWithdrawingRef = useRef(setIsWithdrawing)
  const requestExitConfirmRef = useRef(requestExitConfirm)
  const confirmExitRef = useRef(confirmExit)
  const closeExitConfirmRef = useRef(closeExitConfirm)
  const adjustVolumeRef = useRef(adjustVolume)
  const handleSettingsActionRef = useRef(handleSettingsAction)
  const closeSettingsModalRef = useRef(closeSettingsModal)
  const openSettingsModalRef = useRef(openSettingsModal)
  const settingsFocusedRef = useRef(settingsFocused)
  const selectedSettingsItemRef = useRef(selectedSettingsItem)

  useEffect(() => {
    setShowWithdrawModalRef.current = setShowWithdrawModal
    setIsWithdrawingRef.current = setIsWithdrawing
    addWithdrawAmountRef.current = addWithdrawAmount
    minusWithdrawAmountRef.current = minusWithdrawAmount
    requestExitConfirmRef.current = requestExitConfirm
    confirmExitRef.current = confirmExit
    closeExitConfirmRef.current = closeExitConfirm
    adjustVolumeRef.current = adjustVolume
    handleSettingsActionRef.current = handleSettingsAction
    closeSettingsModalRef.current = closeSettingsModal
    openSettingsModalRef.current = openSettingsModal
  })

  useEffect(() => {
    settingsFocusedRef.current = settingsFocused
  }, [settingsFocused])

  useEffect(() => {
    selectedSettingsItemRef.current = selectedSettingsItem
  }, [selectedSettingsItem])

  const focusRef = useRef(focus)

  const gamesRef = useRef(games)

  const selectedGameRef = useRef(selectedGame)
  const confirmHeldRef = useRef(false)
  const lastMoveRef = useRef(0)

  useEffect(() => {
    focusRef.current = focus
  }, [focus])

  useEffect(() => {
    gamesRef.current = games
  }, [games])

  useEffect(() => {
    selectedGameRef.current = selectedGame
  }, [selectedGame])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void flushMetricEvents()
    }, 1200)

    const flushNow = () => {
      void flushMetricEvents()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushNow()
      }
    }

    window.addEventListener('beforeunload', flushNow)
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('beforeunload', flushNow)
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
      flushNow()
    }
  }, [])

  useEffect(() => {
    window.__ARCADE_INPUT__ = payload => {
      const s = shellStateRef.current
      const casinoFrameWindow = casinoFrameRef.current?.contentWindow as
        | (Window & { __ARCADE_INPUT__?: (payload: any) => void })
        | null
      const forwardToCasino = () => {
        try {
          casinoFrameWindow?.__ARCADE_INPUT__?.(payload)
        } catch {}

        try {
          casinoFrameWindow?.postMessage({ type: 'ARCADE_INPUT', payload }, '*')
        } catch {}
      }

      if (payload.type === 'INTERNET_LOST') {
        if (internetLossTimerRef.current) {
          clearTimeout(internetLossTimerRef.current)
          internetLossTimerRef.current = null
        }
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
        setWifiSsid(payload.ssid ?? null)
        return
      }

      if (payload.type === 'PLAYER' && payload.player === 'P1' && s.showWifiModal) {
        window.dispatchEvent(
          new CustomEvent('ARCADE_MODAL_INPUT', {
            detail: { button: payload.button },
          }),
        )
        return
      }

      if (!payload || !s.initialized) return

      if (payload.type === 'ARCADE_LIFE_STATE') {
        setArcadeLifeOverlay({
          active: Boolean(payload.active),
          status: String(payload.status ?? 'state'),
          gameId: payload.gameId ?? null,
          gameName: payload.gameName ?? null,
          pricePerLife: Number(payload.pricePerLife ?? 10),
          p1Unlocked: Boolean(payload.p1Unlocked),
          p2Unlocked: Boolean(payload.p2Unlocked),
          balance:
            payload.balance === null || payload.balance === undefined
              ? null
              : Number(payload.balance),
        })
        return
      }

      if (payload.type === 'GAME_LAUNCHING') {
        setTransitionOverlay({
          visible: true,
          label: 'Loading Game...',
          detail: payload.gameName ? `PREPARING ${String(payload.gameName).toUpperCase()}` : null,
        })
        return
      }

      if (payload.type === 'GAME_EXITING') {
        setTransitionOverlay({
          visible: true,
          label: 'Returning to Menu...',
          detail: 'RESTORING ARCADE SHELL',
        })
        return
      }

      if (payload.type === 'ARCADE_LIFE_SESSION_ENDED') {
        setArcadeLifeOverlay(prev => ({
          ...prev,
          active: false,
          status: String(payload.status ?? 'ended'),
          p1Unlocked: false,
          p2Unlocked: false,
        }))
      }

      if (payload.type === 'GAME_EXITED') {
        console.log('[UI] GAME_EXITED received')
        setArcadeLifeOverlay(prev => ({
          ...prev,
          active: false,
          status: 'exited',
          p1Unlocked: false,
          p2Unlocked: false,
        }))
        handleExitGame()
        window.setTimeout(() => {
          setTransitionOverlay({
            visible: false,
            label: 'Loading Game...',
            detail: null,
          })
        }, 220)

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

      if (payload.type === 'HOPPER_COIN') {
        if (s.runningCasino) {
          forwardToCasino()
        }
        addHopperBalance(payload.amount ?? 20)
        return
      }

      if (payload.type === 'BET') {
        recordBet(payload.amount ?? 0)
        return
      }

      if (payload.type === 'WIN') {
        recordWin(payload.amount ?? 0)
        return
      }

      if (s.runningCasino) {
        if (
          payload.type === 'COIN' ||
          payload.type === 'WITHDRAW_DISPENSE' ||
          payload.type === 'WITHDRAW_COMPLETE'
        ) {
          forwardToCasino()
          return
        }
      }

      // ----------------------------------
      // PLAYER INPUT
      // ----------------------------------
      if (payload.type === 'PLAYER' && (payload.player === 'P1' || payload.player === 'CASINO')) {
        const button = payload.button

        if (s.runningCasino) {
          forwardToCasino()
          return
        }

        if (s.showSettingsModal) {
          if (button === 'UP') {
            setSelectedSettingsItem(prev =>
              prev === 'volume'
                ? 'shutdown'
                : prev === 'network'
                  ? 'volume'
                  : prev === 'reboot'
                    ? 'network'
                    : 'reboot',
            )
            return
          }
          if (button === 'DOWN') {
            setSelectedSettingsItem(prev =>
              prev === 'volume'
                ? 'network'
                : prev === 'network'
                  ? 'reboot'
                  : prev === 'reboot'
                    ? 'shutdown'
                    : 'volume',
            )
            return
          }
          if (
            (button === 'LEFT' || button === 'RIGHT') &&
            selectedSettingsItemRef.current === 'volume'
          ) {
            void adjustVolumeRef.current(button === 'LEFT' ? 'down' : 'up')
            return
          }
          if (button === 6 || button === 5) {
            closeSettingsModalRef.current()
            return
          }
          if (button === 7 || button === 0 || button === 1) {
            void handleSettingsActionRef.current()
            return
          }
          return
        }

        if (s.showExitConfirmModal) {
          if (button === 6 || button === 7 || button === 0) {
            confirmExitRef.current()
            return
          }
          if (button === 1 || button === 5) {
            closeExitConfirmRef.current()
            return
          }
          return
        }

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

      if (!s.runningCasino) {
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

        if (payload.type === 'ACTION' && payload.action === 'MENU') {
          if (s.showWifiModal) {
            setShowWifiModal(false)
            return
          }
          if (s.showSettingsModal) {
            closeSettingsModalRef.current()
            return
          }
        }

        if (s.showSettingsModal && payload.type === 'ACTION' && payload.action === 'MENU') {
          return
        }

        switch (payload.action) {
          case 'MENU': {
            if (s.showExitConfirmModal) {
              confirmExitRef.current()
              return
            }
            if (s.showWithdrawModal) {
              setShowWithdrawModalRef.current(false)
              return
            }
            requestExitConfirmRef.current('menu')
            return
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
            if (!hasLocalLinkRef.current) {
              flashUiNotice('OFFLINE')
              break
            }
            if (!s.showWithdrawModal) {
              if (getMaxSelectable(s.balance) < MIN) break
              setShowWithdrawModalRef.current(true)
            } else if (!s.isWithdrawing && isValidWithdrawAmount(s.withdrawAmount, s.balance)) {
              fetch(API_BASE, {
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
      } else if (payload.type === 'ACTION') {
        forwardToCasino()
        if (payload.action === 'MENU') {
          if (s.showExitConfirmModal) {
            confirmExitRef.current()
            return
          }
          requestExitConfirmRef.current('casino')
          return
        }
        if (s.showExitConfirmModal) {
          closeExitConfirmRef.current()
        }
      }
    }

    return () => {
      delete window.__ARCADE_INPUT__
    }
  }, [])

  function handleMenuInput(button: any) {
    if (settingsFocusedRef.current) {
      switch (button) {
        case 'DOWN':
          setSettingsFocused(false)
          return
        case 7:
        case 0:
        case 1:
          openSettingsModalRef.current()
          return
        case 6:
          requestExitConfirm('menu')
          return
      }
      return
    }

    switch (button) {
      case 'UP':
        if (focusRef.current % GRID_ROWS === 0) {
          setSettingsFocused(true)
          return
        }
        moveFocus(-1)
        break
      case 'DOWN':
        moveFocus(1)
        break
      case 'LEFT':
        moveFocus(-GRID_ROWS)
        break
      case 'RIGHT':
        moveFocus(GRID_ROWS)
        break
      case 6:
        requestExitConfirm('menu')
        break
      case 7: {
        console.log('[UI] start/confirm pressed', {
          selectedGame: selectedGameRef.current,
          focus: focusRef.current,
        })
        if (selectedGameRef.current) {
          void launch(selectedGameRef.current)
        }
        break
      }
    }
  }

  function handleExitGame() {
    // if (!runningGame && !runningCasino) return
    closeExitConfirm()
    setRunningGame(null)
    setRunningCasino(false)
    setRunningCasinoSrc(null)
    setArcadeLifeOverlay(prev => ({
      ...prev,
      active: false,
      status: 'idle',
      p1Unlocked: false,
      p2Unlocked: false,
    }))
    exitGame()
  }

  const bgOffset = (Math.floor(focus / GRID_ROWS) % GRID_VISIBLE_COLS) * 6

  function moveFocus(delta: number) {
    setSettingsFocused(false)
    setFocus(prev => {
      const currentGames = gamesRef.current
      const nextIndex = prev + delta

      if (nextIndex < 0) return prev
      if (nextIndex >= currentGames.length) return prev

      return nextIndex
    })
  }

  useEffect(() => {
    setFocus(prev => {
      if (games.length === 0) return 0
      return Math.min(prev, games.length - 1)
    })
  }, [games.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const context: ExitConfirmContext = runningCasino ? 'casino' : 'menu'
        requestExitConfirm(context)
        return
      }

      // if (isGameRunning()) return

      switch (e.key) {
        case 'ArrowRight':
          if (settingsFocused) return
          moveFocus(GRID_ROWS)
          break

        case 'ArrowLeft':
          if (settingsFocused) return
          moveFocus(-GRID_ROWS)
          break

        case 'ArrowDown':
          if (settingsFocused) {
            setSettingsFocused(false)
            return
          }
          moveFocus(1)
          break

        case 'ArrowUp':
          if (settingsFocused) return
          if (focusRef.current % GRID_ROWS === 0) {
            setSettingsFocused(true)
            return
          }
          moveFocus(-1)
          break

        case 'Enter':
          if (showSettingsModal) {
            void handleSettingsAction()
            return
          }
          if (settingsFocused) {
            openSettingsModal()
            return
          }
          if (!selectedGame) return
          launch(selectedGame)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    focus,
    handleSettingsAction,
    openSettingsModal,
    requestExitConfirm,
    runningCasino,
    selectedGame,
    settingsFocused,
    showSettingsModal,
  ])

  async function launch(game: Game) {
    const frontendGameRunning = Boolean(runningGameRef.current) || runningCasino
    const engineGameRunning = isGameRunning()

    console.log('[LAUNCH] requested', {
      game,
      networkStage: networkStageRef.current,
      frontendGameRunning,
      engineGameRunning,
      runningGame: runningGameRef.current,
      runningCasino,
    })

    if (!game) {
      console.warn('[LAUNCH] aborted: missing game')
      return
    }

    if (frontendGameRunning) {
      console.warn('[LAUNCH] aborted: frontend already has running game state', {
        runningGame: runningGameRef.current,
        runningCasino,
      })
      return
    }

    if (engineGameRunning) {
      console.warn('[LAUNCH] continuing despite stale gameLoader running flag')
    }

    if (game.type === 'casino') {
      if (!hasLocalLinkRef.current) {
        flashUiNotice('OFFLINE')
        return
      }

      if (!game.package_url) {
        console.error('[LAUNCH] Missing package_url for casino game', { id: game.id })
        setCasinoLaunchError('Game package unavailable.')
        return
      }

      const requestedVersion = Number(game.version ?? 1)
      let entry: string

      setCasinoPreparingDetail(
        describeLoadingTarget(game.package_url, `PREPARING ${game.name.toUpperCase()}`),
      )
      setCasinoPreparing(true)
      try {
        const prepareRes = await fetch(`${API_BASE}/game-package/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: game.id,
            packageUrl: game.package_url,
            version: requestedVersion,
            force: false,
          }),
        })

        if (!prepareRes.ok) {
          const errorText = await prepareRes.text().catch(() => 'Unknown package prepare error')
          throw new Error(`prepare failed (${prepareRes.status}): ${errorText}`)
        }

        const prepareData = await prepareRes.json()
        if (!prepareData?.success || typeof prepareData.entry !== 'string') {
          throw new Error(prepareData?.error ?? 'invalid prepare response')
        }

        entry = prepareData.entry

        const prevVersion = preparedCasinoVersionRef.current[game.id]
        preparedCasinoVersionRef.current[game.id] = requestedVersion

        // Clean up old version in /dev/shm to avoid stale buildup.
        if (Number.isFinite(prevVersion) && prevVersion !== requestedVersion) {
          void fetch(`${API_BASE}/game-package/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: game.id,
              version: prevVersion,
            }),
          })
        }
      } catch (err) {
        console.error('[LAUNCH] Casino package prepare failed', {
          id: game.id,
          package_url: game.package_url,
          version: requestedVersion,
          error: err instanceof Error ? err.message : String(err),
        })
        setCasinoLaunchError('Failed to load latest game package.')
        return
      } finally {
        setCasinoPreparing(false)
        setCasinoPreparingDetail(null)
      }

      launchGame({
        id: game.id,
        type: 'casino',
        entry,
      })
      setRunningGame({ id: game.id, type: 'casino' })

      setRunningCasinoSrc(entry)
      setRunningCasino(true)
    } else {
      if (!game.emulator_core || !game.rom_path) {
        console.error('[LAUNCH] Missing emulator_core or rom_path', {
          id: game.id,
          emulator_core: game.emulator_core,
          rom_path: game.rom_path,
        })
        return
      }

      console.log('[LAUNCH] arcade request payload', {
        id: game.id,
        name: game.name,
        core: game.emulator_core,
        rom: game.rom_path,
        join_mode: game.join_mode,
        balance: balanceRef.current,
      })

      setTransitionOverlay({
        visible: true,
        label: 'Loading Game...',
        detail: game.rom_path
          ? describeLoadingTarget(game.rom_path, `PREPARING ${game.name.toUpperCase()}`)
          : `PREPARING ${game.name.toUpperCase()}`,
      })

      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'LAUNCH_GAME',
          id: game.id,
          name: game.name,
          price: game.price,
          core: game.emulator_core,
          rom: game.rom_path,
          joinMode: game.join_mode,
          balance: balanceRef.current,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown launch error')
        console.error('[LAUNCH] Arcade launch failed', {
          id: game.id,
          status: response.status,
          error: errorText,
        })
        setTransitionOverlay({
          visible: false,
          label: 'Loading Game...',
          detail: null,
        })
        return
      }

      console.log('[LAUNCH] arcade backend accepted launch', {
        id: game.id,
        core: game.emulator_core,
        rom: game.rom_path,
      })

      setRunningGame({ id: game.id, type: 'arcade', core: game.emulator_core, rom: game.rom_path })

      launchGame({
        id: game.id,
        type: 'arcade',
        core: game.emulator_core,
        rom: game.rom_path,
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

  function formatLoadingDetail(detail: string | null | undefined) {
    const text = String(detail ?? '').trim()
    return text || null
  }

  function describeLoadingTarget(input: string | null | undefined, fallback: string) {
    const raw = String(input ?? '').trim()
    if (!raw) return fallback

    try {
      const url = new URL(raw)
      const fileName = url.pathname.split('/').filter(Boolean).pop()
      return fileName ? `DOWNLOADING ${fileName}` : fallback
    } catch {
      const fileName = raw.split('/').filter(Boolean).pop()
      return fileName ? `PREPARING ${fileName}` : fallback
    }
  }

  function LoadingOverlay({
    label,
    detail,
    zIndex = 99999,
  }: {
    label: string
    detail?: string | null
    zIndex?: number
  }) {
    const footerDetail = formatLoadingDetail(detail)

    return (
      <div className="boot-loading" style={{ position: 'fixed', inset: 0, zIndex }}>
        <img
          src={bootImage}
          alt="Loading"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
          }}
        />
        <div
          className="boot-loading-content"
          style={{
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div className="boot-spinner" />
          <div className="boot-text">{label}</div>
        </div>
        {footerDetail ? (
          <div className="boot-loading-footer">
            <div className="boot-loading-footer-spinner" />
            <div className="boot-loading-footer-value">{footerDetail}</div>
          </div>
        ) : null}
      </div>
    )
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

  if (networkStage === 'boot' || (networkStage === 'ok' && !bootFlowComplete)) {
    return (
      <LoadingOverlay
        label={shellUpdateOverlayVisible ? bootOverlayLabel : 'Starting Arcade Shell'}
        detail={shellUpdateOverlayVisible ? bootOverlayDetail : 'INITIALIZING SYSTEM SERVICES'}
      />
    )
  }

  return (
    <div>
      {uiNotice && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100002,
            background: 'rgba(0,0,0,0.88)',
            border: '1px solid #a07d37',
            color: '#ffd84d',
            padding: '10px 16px',
            borderRadius: 6,
            fontSize: 18,
            fontFamily: 'Bebas Neue, sans-serif',
            letterSpacing: '0.06em',
          }}
        >
          {uiNotice}
        </div>
      )}
      {transitionOverlay.visible && (
        <LoadingOverlay
          label={transitionOverlay.label}
          detail={transitionOverlay.detail}
          zIndex={99999}
        />
      )}
      {casinoPreparing && (
        <LoadingOverlay
          label="Loading Game Package..."
          detail={casinoPreparingDetail}
          zIndex={99998}
        />
      )}
      {networkStage === 'no-internet' && !showWifiModal && !hasLocalLink && (
        <NoInternetModal
          onConnect={() => setShowWifiModal(true)}
          wifiConnected={wifiConnected}
          currentSsid={wifiSsid}
        />
      )}
      {showWifiModal && (
        <WifiSetupModal
          onConnected={() => {
            setShowWifiModal(false)
            setNetworkStage('ok')
            flashUiNotice('NETWORK READY')
          }}
          wifiConnected={wifiConnected}
          currentSsid={wifiSsid}
        />
      )}
      {showSettingsModal && (
        <SettingsModal
          selected={selectedSettingsItem}
          volumeLabel={volumeLabel}
          volumePercent={volumePercent}
          offline={!hasLocalLinkRef.current}
        />
      )}
      {casinoLaunchError && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100000,
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #ff5757',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          {casinoLaunchError}
        </div>
      )}
      {showWithdrawModal && (
        <WithdrawModal
          withdrawAmount={withdrawAmount}
          balance={balance}
          isWithdrawing={isWithdrawing}
          onAddAmount={addWithdrawAmount}
          onMinusAmount={minusWithdrawAmount}
          onCancel={() => setShowWithdrawModal(false)}
          onConfirm={() => {
            if (!hasLocalLinkRef.current) {
              flashUiNotice('OFFLINE')
              return
            }
            if (!isValidWithdrawAmount(withdrawAmount, balance)) return
            fetch(API_BASE, {
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
      {showExitConfirmModal && (
        <ExitConfirmModal
          context={exitConfirmContext ?? (runningCasino ? 'casino' : 'menu')}
          onCancel={closeExitConfirm}
          onConfirm={confirmExit}
        />
      )}
      {selectedGame && (
        <div className="scene-bg" style={{ backgroundImage: `url(${selectedGame.art})` }} />
      )}

      {!runningCasino && (
        <div className="top-status-bar">
          <div className="top-status-left">
            <div className="top-status-network">
              <WifiIndicator signal={wifiSignal} connected={wifiConnected} />
              <span className="top-status-ssid">
                {wifiSsid?.trim() || (wifiConnected ? 'CONNECTED' : ethernetIp ? 'ETHERNET' : 'OFFLINE')}
              </span>
            </div>
            <div>{formatDateTime(now)}</div>
          </div>
          <button
            type="button"
            className={['settings-cog', settingsFocused ? 'focused' : ''].join(' ').trim()}
            onClick={openSettingsModal}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.36 7.36 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.16a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
        </div>
      )}

      <GameGrid
        balance={balance}
        games={games}
        focusedIndex={settingsFocused ? -1 : focus}
        hasOverflow={games.length > GRID_ROWS * GRID_VISIBLE_COLS}
      />
      {/*{!runningCasino && runningGame?.type === 'arcade' && arcadeLifeOverlay.active && (*/}
      {/*  <div className="arcade-life-overlay">*/}
      {/*    <div className="arcade-life-title">{arcadeLifeOverlay.gameName ?? 'Arcade'}</div>*/}
      {/*    <div className="arcade-life-subtitle">*/}
      {/*      PRESS START TO BUY LIFE ({formatPeso(arcadeLifeOverlay.pricePerLife)})*/}
      {/*    </div>*/}
      {/*    <div className="arcade-life-status">*/}
      {/*      P1 {arcadeLifeOverlay.p1Unlocked ? 'READY' : 'LOCKED'} | P2{' '}*/}
      {/*      {arcadeLifeOverlay.p2Unlocked ? 'READY' : 'LOCKED'}*/}
      {/*    </div>*/}
      {/*    {arcadeLifeOverlay.balance !== null && (*/}
      {/*      <div className="balance-display arcade-life-balance-display">*/}
      {/*        Balance <span className="balance-amount">{formatPeso(arcadeLifeOverlay.balance)}</span>*/}
      {/*      </div>*/}
      {/*    )}*/}
      {/*  </div>*/}
      {/*)}*/}

      {!runningCasino && (
        <>
          <div className="overlay-hud">
            <div className="balance-display">
              Balance <span className="balance-amount">{formatPeso(balance ?? 0)}</span>
            </div>
            <ArcadeShellVersionBadge deviceId={deviceId} ethernetIp={ethernetIp} wifiIp={wifiIp} />
          </div>
        </>
      )}
      {runningCasino && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'black',
            zIndex: 99999,
          }}
        >
          <iframe
            ref={casinoFrameRef}
            src={runningCasinoSrc ?? 'about:blank'}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            allow="autoplay; gamepad; fullscreen; encrypted-media"
          />
        </div>
      )}
    </div>
  )
}
