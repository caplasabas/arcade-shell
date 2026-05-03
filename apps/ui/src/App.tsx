import { useCallback, useEffect, useRef, useState } from 'react'

import { GameGrid } from './components/GameGrid'
import { NoInternetModal } from './components/NoInternetModal'
import { StandbyModal } from './components/StandbyModal'
import { WifiSetupModal } from './components/WifiSetupModal'
import { SettingsModal } from './components/SettingsModal'

import { ArcadeShellVersionBadge } from './components/ArcadeShellVersionBadge'

import { exitGame, isGameRunning, launchGame } from './lib/gameLoader'
import {
  type DeviceBalanceSnapshot,
  fetchDeviceBalance,
  subscribeToDeviceBalance,
} from './lib/balance'
import { fetchCabinetGames, subscribeToCabinetGames, subscribeToGames } from './lib/games'
import { WithdrawModal } from './components/WithdrawModal'
import { type ExitConfirmContext, ExitConfirmModal } from './components/ExitConfirmModal'

import {
  clearDeviceRuntimeState,
  ensureDeviceRegistered,
  syncDeviceRuntimeState,
} from './lib/device'
import {
  applyMetricEventsDirect,
  flushMetricEvents,
  type MetricEvent,
  queueMetricEvent,
} from './lib/metrics'
import { API_BASE } from './lib/runtime'

import { supabase } from './lib/supabase'

import { formatPeso } from './utils'
import bootImage from './assets/boot.png'

export type GameType = 'arcade' | 'casino'

export type Game = {
  id: string
  name: string
  type: GameType
  enabled?: boolean
  launchable?: boolean
  availability_reason?: 'missing_rom' | 'missing_core' | null
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
const MENU_INPUT_SUPPRESS_AFTER_EXIT_MS = 1200
const CASINO_ENTRY_INPUT_GUARD_MS = 2000
const CASINO_ENTRY_ACCOUNTING_GUARD_MS = 750
const WITHDRAW_INPUT_DEBOUNCE_MS = 300
const WITHDRAW_STALL_RESET_MS = 15000
const BOOT_UPDATER_NETWORK_GRACE_MS = 2500
const BOOT_UPDATER_STABLE_NETWORK_MS = 5000
const AUTO_BOOT_UPDATE_CHECK = true
const DEVICE_HEARTBEAT_MS = 15000
const DEVICE_PLAYING_IDLE_MS = 300000 // 5 minutes

type NetworkStage = 'boot' | 'ok' | 'no-internet' | 'wifi-form'

type SettingsItem = 'volume' | 'network' | 'reboot' | 'shutdown'

type ShellUpdateStatus = {
  status?: string
  running?: boolean
  phase?: string | null
  label?: string
  detail?: string | null
  message?: string
}

type DeviceAdminCommandType = 'restart' | 'shutdown' | 'reset'

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

type CasinoWithdrawState = {
  canOpen: boolean
  balance: number
  isWithdrawing: boolean
  min: number
  step: number
}

type CasinoMenuExitState = {
  canExit: boolean
}

type WithdrawLimitsState = {
  hopperBalance: number | null
  maxWithdrawalAmount: number | null
  enabled: boolean
}

type DeploymentMode = 'online' | 'standby' | 'maintenance'

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
  if (command !== 'restart' && command !== 'shutdown' && command !== 'reset') return null

  return {
    id,
    device_id,
    command,
    status,
  }
}

function loggableError(err: unknown) {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? 'unknown error') }
  }

  return {
    message: String((err as any).message ?? 'unknown error'),
    code: (err as any).code ?? null,
    details: (err as any).details ?? null,
    hint: (err as any).hint ?? null,
    status: (err as any).status ?? null,
    name: (err as any).name ?? null,
  }
}

async function fetchSpinJackpotPayout(deviceId: string, spinKey: string): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { data, error } = await supabase
      .from('device_metric_events')
      .select('id,metadata,event_ts')
      .eq('device_id', deviceId)
      .eq('event_type', 'spin')
      .order('event_ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(40)

    if (!error) {
      const row = (data ?? []).find(
        item => String((item as any)?.metadata?.spinKey ?? '') === String(spinKey || ''),
      )
      if (row) {
        const payout = Number(
          (row as any)?.metadata?.jackpotPayout ??
            (row as any)?.metadata?.jackpot_payout ??
            (row as any)?.metadata?.jackpotAmount ??
            0,
        )
        if (Number.isFinite(payout) && payout > 0) return payout
        return 0
      }
    }

    if (attempt < 19) {
      await new Promise(resolve => window.setTimeout(resolve, 120))
    }
  }

  return 0
}

export default function App() {
  const [focus, setFocus] = useState(0)
  const [isPiCabinet, setIsPiCabinet] = useState(false)
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
  const lastAppliedRevisionRef = useRef(0)
  const [networkStage, setNetworkStage] = useState<NetworkStage>('boot')

  const internetLossTimerRef = useRef<number | null>(null)

  const [now, setNow] = useState(new Date())
  const [wifiSignal, setWifiSignal] = useState<number | null>(null)
  const [wifiConnected, setWifiConnected] = useState<boolean>(false)
  const [wifiSsid, setWifiSsid] = useState<string | null>(null)
  const [serviceInternetOnline, setServiceInternetOnline] = useState<boolean | null>(null)
  const [ethernetIp, setEthernetIp] = useState<string | null>(null)
  const [wifiIp, setWifiIp] = useState<string | null>(null)
  const [ethernetName, setEthernetName] = useState<string | null>(null)
  const [wifiName, setWifiName] = useState<string | null>(null)
  const [networkLatencyMs, setNetworkLatencyMs] = useState<number | null>(null)
  const [shellVersion, setShellVersion] = useState<string>('')
  const shellVersionRef = useRef('')

  const isWifi = Boolean(wifiConnected)
  const isEthernet = !isWifi && Boolean(ethernetIp)

  const [showWifiModal, setShowWifiModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsFocused, setSettingsFocused] = useState(false)
  const [selectedSettingsItem, setSelectedSettingsItem] = useState<SettingsItem>('volume')
  const [volumeLabel, setVolumeLabel] = useState('100%')
  const [volumePercent, setVolumePercent] = useState<number | null>(null)
  const [uiNotice, setUiNotice] = useState<string | null>(null)

  const [initialized, setInitialized] = useState(false)

  const refreshNetworkInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/network-info`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as {
        ethernet?: string | null
        wifi?: string | null
        ethernet_name?: string | null
        wifi_name?: string | null
        latency_ms?: number | null
      }
      setEthernetIp(data.ethernet ?? null)
      setWifiIp(data.wifi ?? null)
      setEthernetName(data.ethernet_name ?? null)
      setWifiName(data.wifi_name ?? null)
      setNetworkLatencyMs(data.latency_ms ?? null)
    } catch {
      // ignore transient network info failures
    }
  }, [])

  const isOfflineModalConfirmInput = (payload: any) => {
    if (!payload || typeof payload !== 'object') return false

    if (payload.type === 'PLAYER') {
      const button = payload.button
      return button === 0 || button === '0' || button === 'A'
    }

    return false
  }

  const isUiNavigationPlayer = (player: unknown) =>
    player === 'P1' || player === 'P2' || player === 'CASINO'

  const [balance, setBalance] = useState(0)
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>('online')
  const lastAuthoritativeUpdatedAtRef = useRef(0)
  const lastAuthoritativeRevisionRef = useRef(0)
  const authoritativeBalanceRef = useRef(0)
  const pendingBalanceDeltaRef = useRef(0)
  const pendingMetricQueueRef = useRef<Array<{ revisionDelta: number; balanceDelta: number }>>([])

  const [games, setGames] = useState<Game[]>([])
  const devInputBypassEnabled =
    import.meta.env.DEV &&
    deviceId?.startsWith('dev-') &&
    /mac/i.test(
      typeof navigator !== 'undefined'
        ? [navigator.platform, navigator.userAgent].filter(Boolean).join(' ')
        : '',
    )

  const isSelectableGame = useCallback((game: Game | null | undefined) => {
    if (!game) return false
    return game.enabled !== false && game.launchable !== false
  }, [])

  const canAffordGame = useCallback((game: Game | null | undefined, balanceValue: number) => {
    if (!game) return false
    if (game.type === 'casino') return true
    return Math.max(0, Number(balanceValue ?? 0)) >= Math.max(0, Number(game.price ?? 0))
  }, [])

  const findFirstSelectableGameIndex = useCallback(
    (list: Game[]) => list.findIndex(game => isSelectableGame(game)),
    [isSelectableGame],
  )

  const findNextSelectableGameIndex = useCallback(
    (list: Game[], startIndex: number, delta: number) => {
      const nextIndex = startIndex + delta
      if (nextIndex < 0 || nextIndex >= list.length) return startIndex

      let index = nextIndex
      while (index >= 0 && index < list.length) {
        if (isSelectableGame(list[index])) return index
        index += delta
      }

      return startIndex
    },
    [isSelectableGame],
  )

  const selectedGame = games[focus] ?? null
  const selectedGameArt = selectedGame?.art?.trim() || bootImage
  const hasLocalLink = wifiConnected || Boolean(ethernetIp) || Boolean(wifiIp)
  const currentIp = ethernetIp?.trim() || wifiIp?.trim() || null
  const piOfflineLockActive =
    isPiCabinet && networkStage === 'no-internet' && serviceInternetOnline !== true
  const isStandbyMode = deploymentMode === 'standby'

  useEffect(() => {
    let cancelled = false

    fetch(`${API_BASE}/device-id`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data || typeof data !== 'object') return
        const nextDeviceId = String((data as { deviceId?: string }).deviceId ?? '').trim()
        if (nextDeviceId) {
          setDeviceId(current => (current === nextDeviceId ? current : nextDeviceId))
        }
        setIsPiCabinet(Boolean((data as { isPi?: boolean }).isPi))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

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
    shellVersionRef.current = shellVersion
  }, [shellVersion])

  useEffect(() => {
    let stopped = false

    const sync = async () => {
      if (stopped) return
      await refreshNetworkInfo()
    }

    void sync()
    const interval = window.setInterval(sync, showWifiModal ? 5000 : 30000)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [refreshNetworkInfo, showWifiModal])

  const fetchShellVersion = useCallback(async () => {
    const response = await fetch(`${API_BASE}/arcade-shell-build.json`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { version?: string }
    const nextVersion = String(data?.version || '').trim()
    shellVersionRef.current = nextVersion
    setShellVersion(current => (current === nextVersion ? current : nextVersion))
    return nextVersion
  }, [])

  useEffect(() => {
    let cancelled = false

    void fetchShellVersion().catch(error => {
      if (cancelled) return
      console.error('[DEVICE] shell version fetch failed', error)
      shellVersionRef.current = ''
      setShellVersion('')
    })

    return () => {
      cancelled = true
    }
  }, [fetchShellVersion])

  const balanceRef = useRef(balance)
  useEffect(() => {
    balanceRef.current = balance
  }, [balance])

  const setMergedBalance = useCallback((authoritativeBalance: number) => {
    const merged = Math.max(0, authoritativeBalance + pendingBalanceDeltaRef.current)
    setBalance(prev => (prev !== merged ? merged : prev))
  }, [])

  const resetPendingBalance = useCallback(() => {
    pendingBalanceDeltaRef.current = 0
    pendingMetricQueueRef.current = []
  }, [])

  const queuePendingBalanceDelta = useCallback(
    (revisionDelta: number, balanceDelta: number) => {
      const safeRevisionDelta = Number(revisionDelta ?? 0)
      const safeBalanceDelta = Number(balanceDelta ?? 0)
      if (!Number.isFinite(safeRevisionDelta) || safeRevisionDelta <= 0) return
      if (!Number.isFinite(safeBalanceDelta)) return

      pendingMetricQueueRef.current.push({
        revisionDelta: safeRevisionDelta,
        balanceDelta: safeBalanceDelta,
      })
      pendingBalanceDeltaRef.current += safeBalanceDelta
      setMergedBalance(authoritativeBalanceRef.current)
    },
    [setMergedBalance],
  )

  const consumePendingRevision = useCallback((revisionDelta: number) => {
    let remaining = Number(revisionDelta ?? 0)
    if (!Number.isFinite(remaining) || remaining <= 0) return

    const nextQueue: Array<{ revisionDelta: number; balanceDelta: number }> = []

    for (const entry of pendingMetricQueueRef.current) {
      if (remaining <= 0) {
        nextQueue.push(entry)
        continue
      }

      if (entry.revisionDelta <= remaining + 0.0001) {
        pendingBalanceDeltaRef.current -= entry.balanceDelta
        remaining -= entry.revisionDelta
        continue
      }

      const consumedRatio = remaining / entry.revisionDelta
      const consumedBalanceDelta = entry.balanceDelta * consumedRatio

      pendingBalanceDeltaRef.current -= consumedBalanceDelta
      nextQueue.push({
        revisionDelta: entry.revisionDelta - remaining,
        balanceDelta: entry.balanceDelta - consumedBalanceDelta,
      })
      remaining = 0
    }

    pendingMetricQueueRef.current = nextQueue
  }, [])

  const applyAuthoritativeBalance = useCallback((snapshot: DeviceBalanceSnapshot) => {
    if (!snapshot) return

    const nextDeploymentMode = String(snapshot.deploymentMode || 'online')
      .trim()
      .toLowerCase()
    setDeploymentMode(
      nextDeploymentMode === 'standby' || nextDeploymentMode === 'maintenance'
        ? nextDeploymentMode
        : 'online',
    )

    const nextUpdatedAt =
      snapshot.updatedAt && Number.isFinite(Date.parse(snapshot.updatedAt))
        ? Date.parse(snapshot.updatedAt)
        : 0
    const previousRevision = lastAppliedRevisionRef.current
    const previousUpdatedAt = lastAuthoritativeUpdatedAtRef.current
    const previousBalance = authoritativeBalanceRef.current
    const balanceChanged = snapshot.balance !== previousBalance

    if (previousRevision !== 0) {
      if (snapshot.revision < previousRevision) return
      if (
        snapshot.revision === previousRevision &&
        !balanceChanged &&
        nextUpdatedAt <= previousUpdatedAt
      ) {
        return
      }
    }
    // console.log('[AUTH APPLY]', {
    //   incoming: snapshot.balance,
    //   revision: snapshot.revision,
    //   last: previousRevision,
    //   updatedAt: snapshot.updatedAt,
    // })

    const delta = Math.max(0, snapshot.revision - previousRevision)

    lastAppliedRevisionRef.current = snapshot.revision
    lastAuthoritativeRevisionRef.current = snapshot.revision
    lastAuthoritativeUpdatedAtRef.current = Math.max(previousUpdatedAt, nextUpdatedAt)

    authoritativeBalanceRef.current = snapshot.balance

    consumePendingRevision(delta)

    setMergedBalance(snapshot.balance)
  }, [])

  const wifiConnectedRef = useRef(wifiConnected)
  useEffect(() => {
    wifiConnectedRef.current = wifiConnected
  }, [wifiConnected])

  const ethernetIpRef = useRef(ethernetIp)
  useEffect(() => {
    ethernetIpRef.current = ethernetIp
  }, [ethernetIp])

  const wifiIpRef = useRef(wifiIp)
  useEffect(() => {
    wifiIpRef.current = wifiIp
  }, [wifiIp])

  const networkStageRef = useRef(networkStage)

  useEffect(() => {
    networkStageRef.current = networkStage
  }, [networkStage])

  const hasLocalLinkRef = useRef(false)
  useEffect(() => {
    hasLocalLinkRef.current = Boolean(wifiConnected || ethernetIp || wifiIp)
  }, [wifiConnected, ethernetIp, wifiIp])

  const [, setLoading] = useState(false)
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
  const shellUpdateStableTimerRef = useRef<number | null>(null)
  const bootOverlayLabel = (
    normalizeBootOverlayLabel(shellUpdateOverlayStatus.label, shellUpdateOverlayStatus.detail) ||
    shellUpdateOverlayStatus.message?.trim() ||
    'Preparing system'
  ).trim()
  const bootOverlayDetail = normalizeBootOverlayDetail(
    shellUpdateOverlayStatus.label,
    shellUpdateOverlayStatus.detail,
  )

  const [runningGame, setRunningGame] = useState<{
    id: string
    name: string
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
  const activeSessionIdRef = useRef<number | null>(null)
  const lastDeviceActivityAtRef = useRef<number>(Date.now())
  const casinoEntryGuardRef = useRef({
    launchedAt: 0,
    unlockAt: 0,
    gameplayArmed: false,
    accountingUnlockAt: 0,
  })

  useEffect(() => {
    runningGameRef.current = runningGame
  }, [runningGame])

  const runningCasinoRef = useRef(runningCasino)
  useEffect(() => {
    runningCasinoRef.current = runningCasino
  }, [runningCasino])

  function resetCasinoEntryGuard() {
    casinoEntryGuardRef.current = {
      launchedAt: 0,
      unlockAt: 0,
      gameplayArmed: false,
      accountingUnlockAt: 0,
    }
  }

  function startCasinoEntryGuard() {
    const now = Date.now()
    casinoEntryGuardRef.current = {
      launchedAt: now,
      unlockAt: now + CASINO_ENTRY_INPUT_GUARD_MS,
      gameplayArmed: false,
      accountingUnlockAt: 0,
    }
  }

  function isCasinoGameplayPayload(payload: any) {
    if (!payload || typeof payload !== 'object') return false

    if (payload.type === 'PLAYER') return true
    if (payload.type !== 'ACTION') return false

    switch (String(payload.action ?? '').trim()) {
      case 'SPIN':
      case 'AUTO':
      case 'TURBO':
      case 'BET_UP':
      case 'BET_DOWN':
      case 'BUY':
        return true
      default:
        return false
    }
  }

  function canForwardCasinoGameplayInput(payload: any) {
    if (!isCasinoGameplayPayload(payload)) return true

    const guard = casinoEntryGuardRef.current
    const now = Date.now()
    if (now < guard.unlockAt) {
      return false
    }

    if (!guard.gameplayArmed) {
      casinoEntryGuardRef.current = {
        ...guard,
        gameplayArmed: true,
        accountingUnlockAt: now + CASINO_ENTRY_ACCOUNTING_GUARD_MS,
      }
    }

    return true
  }

  function shouldGuardCasinoAccounting(events: MetricEvent[]) {
    const guard = casinoEntryGuardRef.current
    if (!guard.unlockAt) return false

    const hasDebitLikeEvent = events.some(event => {
      const eventType = String(event?.event_type ?? '')
        .trim()
        .toLowerCase()
      return (eventType === 'bet' || eventType === 'spin') && Number(event?.amount ?? 0) > 0
    })

    if (!hasDebitLikeEvent) return false

    if (!guard.gameplayArmed) return true

    return Date.now() < guard.accountingUnlockAt
  }

  const [withdrawAmount, setWithdrawAmount] = useState(20)

  function clampWithdrawAmount(value: number, max: number, step: number) {
    const min = 20
    const safeMax = Number.isFinite(max) && max > 0 ? max : min
    const clamped = Math.min(Math.max(min, value), safeMax)
    const stepped = Math.floor(clamped / step) * step
    return Math.max(min, Math.min(stepped, safeMax))
  }

  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawRequestedAmount, setWithdrawRequestedAmount] = useState(0)
  const [withdrawRemainingAmount, setWithdrawRemainingAmount] = useState(0)
  const withdrawFlowActiveRef = useRef(false)
  const withdrawInputLockedUntilRef = useRef(0)
  const withdrawLastActivityAtRef = useRef(0)
  const withdrawRequestedAmountRef = useRef(0)
  const withdrawSubmitPendingRef = useRef(false)
  const [casinoWithdrawState, setCasinoWithdrawState] = useState<CasinoWithdrawState>({
    canOpen: false,
    balance: 0,
    isWithdrawing: false,
    min: 20,
    step: 20,
  })
  const casinoWithdrawStateRef = useRef(casinoWithdrawState)
  useEffect(() => {
    casinoWithdrawStateRef.current = casinoWithdrawState
  }, [casinoWithdrawState])
  const [casinoMenuExitState, setCasinoMenuExitState] = useState<CasinoMenuExitState>({
    canExit: false,
  })
  const casinoMenuExitStateRef = useRef(casinoMenuExitState)
  useEffect(() => {
    casinoMenuExitStateRef.current = casinoMenuExitState
  }, [casinoMenuExitState])
  const [withdrawLimits, setWithdrawLimits] = useState<WithdrawLimitsState>({
    hopperBalance: null,
    maxWithdrawalAmount: null,
    enabled: false,
  })
  const [withdrawLimitsLoading, setWithdrawLimitsLoading] = useState(false)
  useEffect(() => {
    if (!showWithdrawModal) return

    let stopped = false
    setWithdrawLimitsLoading(true)

    const fetchWithdrawLimits = async () => {
      try {
        const response = await fetch(`${API_BASE}/withdraw-limits`, { cache: 'no-store' })

        if (!response.ok) return
        const data = (await response.json().catch(() => null)) as {
          hopperBalance?: number | null
          maxWithdrawalAmount?: number | null
          enabled?: boolean
        } | null
        if (stopped || !data) return

        setWithdrawLimits({
          hopperBalance: typeof data.hopperBalance === 'number' ? Number(data.hopperBalance) : null,
          maxWithdrawalAmount:
            typeof data.maxWithdrawalAmount === 'number' ? Number(data.maxWithdrawalAmount) : null,
          enabled: Boolean(data.enabled),
        })
        setWithdrawLimitsLoading(false)

        const nextMax =
          typeof data.maxWithdrawalAmount === 'number' ? Number(data.maxWithdrawalAmount) : 0

        if (nextMax > 0) {
          setWithdrawAmount(prev => clampWithdrawAmount(prev, nextMax, 20))
        }
      } catch {
        // ignore transient withdraw-limit failures
      } finally {
        if (!stopped) {
          setWithdrawLimitsLoading(false)
        }
      }
    }

    void fetchWithdrawLimits()
    const interval = window.setInterval(fetchWithdrawLimits, 15000)

    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [showWithdrawModal])
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false)
  const [exitConfirmContext, setExitConfirmContext] = useState<ExitConfirmContext | null>(null)
  const volumeAdjustRef = useRef<{ direction: 'up' | 'down' | null; at: number; streak: number }>({
    direction: null,
    at: 0,
    streak: 0,
  })

  const exitConfirmDeadlineRef = useRef(0)
  const exitConfirmTimerRef = useRef<number | null>(null)
  const menuInputSuppressUntilRef = useRef(0)

  useEffect(() => {
    if (!isStandbyMode) return

    setShowWithdrawModal(false)
    setIsWithdrawing(false)
    setShowSettingsModal(false)
    setShowWifiModal(false)
    setShowExitConfirmModal(false)
  }, [isStandbyMode])

  const shouldExitForMissingRunningGame = useCallback(
    (
      currentGame: { id: string; type: 'arcade' | 'casino' } | null,
      nextGames: Game[],
      options: { allowEmptyList?: boolean } = {},
    ) => {
      if (!currentGame) return false
      if (!Array.isArray(nextGames)) return false

      if (nextGames.length === 0 && !options.allowEmptyList) {
        console.warn('[GAME] ignoring empty catalog refresh while a game is running', {
          currentGame,
        })
        return false
      }

      return !nextGames.some(game => game.id === currentGame.id)
    },
    [],
  )

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

  const recoverDeviceState = useCallback(
    async (reason: string) => {
      if (networkStageRef.current !== 'ok') {
        console.log(`[RECOVERY] Skipping auto re-init while offline (${reason})`)
        setInitialized(false)
        return
      }

      if (recoveryInFlightRef.current) return

      recoveryInFlightRef.current = true
      setLoading(true)
      try {
        console.log(`[RECOVERY] Auto re-init start (${reason})`)
        const id = await ensureDeviceRegistered()
        deviceIdRef.current = id
        setDeviceId(current => (current === id ? current : id))

        const [nextBalance, nextGames] = await Promise.all([
          fetchDeviceBalance(id).catch(() => ({
            balance: 0,
            deploymentMode: 'online',
            updatedAt: null,
            revision: 0,
          })),
          fetchCabinetGames(id).catch(() => [] as Game[]),
        ])

        resetPendingBalance()
        applyAuthoritativeBalance(nextBalance)
        setGames(nextGames)
        setInitialized(true)
        setNetworkStage('ok')

        const current = runningGameRef.current
        if (shouldExitForMissingRunningGame(current, nextGames)) {
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
        setInitialized(false)
      } finally {
        setLoading(false)
        recoveryInFlightRef.current = false
      }
    },
    [applyAuthoritativeBalance, resetPendingBalance, shouldExitForMissingRunningGame],
  )

  const executeLocalPowerCommand = useCallback(async (command: DeviceAdminCommandType) => {
    if (command === 'reset') {
      throw new Error('reset is not a power command')
    }
    const endpoint = command === 'restart' ? '/system/restart' : '/system/shutdown'
    if (deviceIdRef.current) {
      const nowIso = new Date().toISOString()
      await syncDeviceRuntimeState({
        deviceId: deviceIdRef.current,
        status: 'offline',
        activeSessionId: null,
        sessionEndedAt: nowIso,
        lastSeenAt: nowIso,
      }).catch(error => {
        console.error(`[DEVICE] failed to mark ${command} as offline`, error)
      })
      activeSessionIdRef.current = null
    }
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

  const markDeviceActivity = useCallback(() => {
    lastDeviceActivityAtRef.current = Date.now()
  }, [])

  const startDeviceSession = useCallback(
    async (game: { id: string; name: string; type: 'arcade' | 'casino' }) => {
      const id = deviceIdRef.current
      if (!id) return
      if (activeSessionIdRef.current) return

      const nowIso = new Date().toISOString()
      const state = {
        gameType: game.type,
        startedAt: nowIso,
      }

      const { data, error } = await supabase.rpc('start_device_game_session', {
        p_device_id: id,
        p_game_id: game.id,
        p_game_name: game.name,
        p_runtime_mode: game.type,
        p_state: state,
      })

      if (error) throw error

      activeSessionIdRef.current = Number(data ?? 0) || null
      lastDeviceActivityAtRef.current = Date.now()
    },
    [],
  )

  const updateDeviceSessionHeartbeat = useCallback(
    async (
      options: {
        markActive?: boolean
        status?: 'idle' | 'playing'
        clearCurrentGame?: boolean
      } = {},
    ) => {
      const id = deviceIdRef.current
      if (!id) return

      const game = runningGameRef.current
      const nowIso = new Date().toISOString()
      const effectiveStatus = options.status ?? (game ? 'playing' : 'idle')

      if (effectiveStatus === 'playing' && game) {
        if (!activeSessionIdRef.current) {
          await startDeviceSession(game)
        }

        const state = {
          gameType: game.type,
          markActive: options.markActive !== false,
          updatedAt: nowIso,
        }

        const { error } = await supabase.rpc('update_device_game_state', {
          p_device_id: id,
          p_session_id: activeSessionIdRef.current,
          p_state: state,
        })
        if (error) throw error
        await syncDeviceRuntimeState({
          deviceId: id,
          status: 'playing',
          currentGameId: game.id,
          currentGameName: game.name,
          currentGameType: game.type,
          arcadeShellVersion: shellVersionRef.current || null,
          currentIp: currentIp ?? null,
          activeSessionId: activeSessionIdRef.current,
          lastSeenAt: nowIso,
          lastActivityAt:
            options.markActive === false
              ? undefined
              : new Date(lastDeviceActivityAtRef.current).toISOString(),
        })
        return
      }

      if (activeSessionIdRef.current) {
        const { error } = await supabase.rpc('end_device_game_session', {
          p_device_id: id,
          p_session_id: activeSessionIdRef.current,
          p_reason: options.clearCurrentGame ? 'game_exit' : 'idle_timeout',
        })
        if (error) throw error
        activeSessionIdRef.current = null
      }

      await syncDeviceRuntimeState({
        deviceId: id,
        status: 'idle',
        currentGameId: options.clearCurrentGame ? null : (game?.id ?? undefined),
        currentGameName: options.clearCurrentGame ? null : (game?.name ?? undefined),
        currentGameType: options.clearCurrentGame ? null : (game?.type ?? undefined),
        arcadeShellVersion: shellVersionRef.current || null,
        currentIp: currentIp ?? null,
        activeSessionId: null,
        sessionEndedAt: nowIso,
        lastSeenAt: nowIso,
        lastActivityAt:
          options.markActive === false
            ? undefined
            : new Date(lastDeviceActivityAtRef.current).toISOString(),
      })
    },
    [currentIp, startDeviceSession],
  )

  const flashUiNotice = useCallback((message: string) => {
    setUiNotice(message)
  }, [])

  const refreshVolumeState = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/system/volume`)
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean
        volume?: string
        percent?: number | null
        error?: string
      } | null

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
      setVolumeLabel('Audio Error')
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
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean
          volume?: string
          percent?: number | null
          error?: string
        } | null
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
        flashUiNotice('Audio Error')
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

  const openOfflineNetworkFlow = useCallback(() => {
    setSelectedSettingsItem('network')
    setShowWifiModal(false)
    setShowSettingsModal(true)
  }, [])

  const isNoInternetModalActive =
    piOfflineLockActive && !showWifiModal && !showSettingsModal && runningGame?.type !== 'arcade'

  const openNetworkSettings = useCallback(() => {
    setShowSettingsModal(false)
    setShowWifiModal(true)
  }, [])

  const closeWifiSettingsToSettings = useCallback(() => {
    setShowWifiModal(false)
    setShowSettingsModal(true)
  }, [])

  const deleteKnownWifiProfile = useCallback(
    async (profile: { id: string; ssid: string }) => {
      try {
        const response = await fetch(`${API_BASE}/wifi-delete-known`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: profile.id, ssid: profile.ssid }),
        })

        const payload = (await response.json().catch(() => null)) as {
          success?: boolean
          error?: string
        } | null

        if (!response.ok || !payload?.success) {
          flashUiNotice('DELETE FAILED')
          return false
        }

        flashUiNotice('NETWORK DELETED')
        return true
      } catch (error) {
        console.error('[WIFI] delete known profile failed', error)
        flashUiNotice('DELETE FAILED')
        return false
      }
    },
    [flashUiNotice],
  )

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

  useEffect(() => {
    if (networkStage !== 'ok') return
    if (initialized) return

    let unsubscribe: (() => void) | null = null
    let cancelled = false

    async function init() {
      setLoading(true)
      try {
        const id = await ensureDeviceRegistered()
        if (cancelled) return

        setDeviceId(id)

        const [initialBalance, initialGames] = await Promise.all([
          (async (): Promise<DeviceBalanceSnapshot> => {
            try {
              return await fetchDeviceBalance(id)
            } catch (err) {
              if (isMissingDeviceRowError(err)) {
                // RESET may have removed the row while app stayed mounted; recreate and retry.
                await ensureDeviceRegistered()
                return fetchDeviceBalance(id)
              }

              console.error('[INIT] balance bootstrap failed, using fallback snapshot', err)
              return {
                balance: 0,
                deploymentMode: 'online',
                updatedAt: null,
                revision: 0,
              }
            }
          })(),
          fetchCabinetGames(id).catch(err => {
            console.error('[INIT] game bootstrap failed', err)
            return [] as Game[]
          }),
        ])
        if (cancelled) return

        resetPendingBalance()
        applyAuthoritativeBalance(initialBalance)
        setGames(initialGames)

        unsubscribe = subscribeToDeviceBalance(id, snapshot => {
          applyAuthoritativeBalance(snapshot)
        })

        setInitialized(true)
      } catch (err) {
        console.error('Boot failed', loggableError(err))
        setInitialized(false)
        if (isMissingDeviceRowError(err)) {
          console.warn('[INIT] Device missing, attempting recovery')
          await recoverDeviceState('init-missing-device')
          return
        }

        setNetworkStage('no-internet')
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
  }, [applyAuthoritativeBalance, networkStage, resetPendingBalance])

  useEffect(() => {
    if (!AUTO_BOOT_UPDATE_CHECK) {
      if (networkStage === 'ok' && initialized && !bootFlowComplete) {
        setShellUpdateOverlayVisible(false)
        setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
        setBootFlowComplete(true)
      }
      return
    }

    if (networkStage !== 'ok' || !initialized) {
      if (shellUpdateStableTimerRef.current !== null) {
        window.clearTimeout(shellUpdateStableTimerRef.current)
        shellUpdateStableTimerRef.current = null
      }
      return
    }

    if (runningGame || runningCasino) {
      if (shellUpdateStableTimerRef.current !== null) {
        window.clearTimeout(shellUpdateStableTimerRef.current)
        shellUpdateStableTimerRef.current = null
      }
      return
    }

    if (shellUpdateRequestedRef.current) return

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

        let finalStatus: ShellUpdateStatus | null = null

        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise(resolve => window.setTimeout(resolve, 500))

          const statusResponse = await fetch(`${API_BASE}/arcade-shell-update/status`, {
            cache: 'no-store',
          }).catch(() => null)

          if (!statusResponse?.ok) continue

          const status = (await statusResponse.json()) as ShellUpdateStatus
          finalStatus = status
          setShellUpdateOverlayStatus(status)

          if (!status.running && status.status && status.status !== 'running') {
            break
          }
        }

        if (finalStatus?.status === 'updated' || finalStatus?.status === 'up-to-date') {
          try {
            await fetchShellVersion()
          } catch (error) {
            console.error('[UPDATER] shell version refresh failed', error)
          }
        }
      } catch (error) {
        console.error('[UPDATER] failed to trigger', error)
      } finally {
        setShellUpdateOverlayVisible(false)
        setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
        setBootFlowComplete(true)
      }
    }, BOOT_UPDATER_STABLE_NETWORK_MS)

    return () => {
      if (shellUpdateStableTimerRef.current !== null) {
        window.clearTimeout(shellUpdateStableTimerRef.current)
        shellUpdateStableTimerRef.current = null
      }
    }
  }, [fetchShellVersion, initialized, networkStage, runningCasino, runningGame])

  useEffect(() => {
    if (bootFlowComplete) return

    const timer = window.setTimeout(() => {
      if (shellUpdateRequestedRef.current) return
      if (networkStageRef.current === 'ok') return

      setShellUpdateOverlayVisible(false)
      setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
      setBootFlowComplete(true)

      if (networkStageRef.current === 'boot') {
        setNetworkStage(
          wifiConnectedRef.current || Boolean(ethernetIpRef.current) || Boolean(wifiIpRef.current)
            ? 'ok'
            : 'no-internet',
        )
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

    ensureDeviceRegistered()
      .then(id => {
        if (!deviceIdRef.current) {
          console.log('[RECOVERY] Device registered after reconnect', id)
          deviceIdRef.current = id
          setDeviceId(id)
        }
      })
      .catch(err => {
        console.error('[RECOVERY] Device registration failed', err)
      })

    // 1️⃣ Hard refresh balance
    fetchDeviceBalance(deviceId)
      .then(applyAuthoritativeBalance)
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

  const runtimeInfoSyncKeyRef = useRef('')
  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return
    if (networkStage !== 'ok') return

    let cancelled = false
    let timer: number | null = null

    const syncPresence = async () => {
      const now = Date.now()
      const playingActive =
        Boolean(runningGameRef.current) &&
        now - lastDeviceActivityAtRef.current < DEVICE_PLAYING_IDLE_MS

      const payload = {
        deviceId,
        status: playingActive ? ('playing' as const) : ('idle' as const),
        currentGameId: runningGameRef.current?.id ?? null,
        currentGameName: runningGameRef.current?.name ?? null,
        currentGameType: runningGameRef.current?.type ?? null,
        arcadeShellVersion: shellVersionRef.current || null,
        currentIp: currentIp ?? null,
        lastSeenAt: new Date(now).toISOString(),
        lastActivityAt: new Date(lastDeviceActivityAtRef.current).toISOString(),
        activeSessionId: activeSessionIdRef.current,
      }

      const syncKey = JSON.stringify(payload)
      const shouldForceSync =
        !runtimeInfoSyncKeyRef.current ||
        runtimeInfoSyncKeyRef.current !== syncKey ||
        now - lastDeviceActivityAtRef.current >= DEVICE_PLAYING_IDLE_MS

      if (!shouldForceSync) return

      try {
        if (playingActive) {
          await updateDeviceSessionHeartbeat({ markActive: false, status: 'playing' })
        } else {
          await updateDeviceSessionHeartbeat({ markActive: false, status: 'idle' })
        }
        if (!cancelled) {
          runtimeInfoSyncKeyRef.current = syncKey
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[DEVICE] runtime info sync failed', error)
        }
      }
    }

    void syncPresence()
    timer = window.setInterval(() => {
      void syncPresence()
    }, DEVICE_HEARTBEAT_MS)

    return () => {
      cancelled = true
      if (timer) {
        window.clearInterval(timer)
      }
    }
  }, [currentIp, deviceId, initialized, networkStage, updateDeviceSessionHeartbeat])

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return
    if (networkStage !== 'ok') return

    async function load() {
      if (!deviceId) return
      const list = await fetchCabinetGames(deviceId)

      setGames(list)

      const current = runningGameRef.current

      if (shouldExitForMissingRunningGame(current, list)) {
        handleExitGame()
      }

      setFocus(prev => {
        const firstSelectable = findFirstSelectableGameIndex(list)
        if (firstSelectable < 0) return 0
        if (prev >= list.length) {
          return firstSelectable
        }
        if (!isSelectableGame(list[prev])) return firstSelectable
        return prev
      })
    }

    load()

    const unsubGames = subscribeToGames(deviceId, load, disabledGame => {
      const current = runningGameRef.current
      if (current?.id === disabledGame.id) {
        if (current.type === 'casino' || disabledGame.type === 'casino') {
          window.setTimeout(() => {
            handleExitGame()
          }, EXIT_CONFIRM_WINDOW_MS)
          return
        }
        handleExitGame()
      }
    })

    const unsubCabinet = subscribeToCabinetGames(deviceId, load)

    return () => {
      unsubGames()
      unsubCabinet()
    }
  }, [
    deviceId,
    findFirstSelectableGameIndex,
    initialized,
    isSelectableGame,
    networkStage,
    runningGame,
    shouldExitForMissingRunningGame,
  ])

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

        applyAuthoritativeBalance(nextBalance)
        setGames(nextGames)

        const current = runningGameRef.current
        if (shouldExitForMissingRunningGame(current, nextGames)) {
          handleExitGame()
        }

        setFocus(prev => {
          const firstSelectable = findFirstSelectableGameIndex(nextGames)
          if (firstSelectable < 0) return 0
          if (prev >= nextGames.length) {
            return firstSelectable
          }
          if (!isSelectableGame(nextGames[prev])) return firstSelectable
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
    }, 30000)

    hardSync()

    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [
    applyAuthoritativeBalance,
    deviceId,
    findFirstSelectableGameIndex,
    initialized,
    isSelectableGame,
    networkStage,
    recoverDeviceState,
    shouldExitForMissingRunningGame,
  ])

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

  // useEffect(() => {
  //   if (!initialized) return
  //   if (networkStage !== 'ok') return
  //
  //   const timer = window.setTimeout(() => {
  //     console.log('[UI BALANCE PUSH]', balance)
  //
  //     fetch(`${API_BASE}/arcade-life/balance`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ balance }),
  //     }).catch(err => {
  //       console.error('[UI BALANCE PUSH] failed', err)
  //     })
  //   }, 80)
  //
  //   return () => window.clearTimeout(timer)
  // }, [balance, initialized, networkStage])

  const addBalance = (source = 'coin', amount = 5) => {
    const id = deviceIdRef.current
    const safeAmount = Number(amount || 0)

    if (!id || safeAmount <= 0) return

    if (source === 'coin') {
      markDeviceActivity()
      queuePendingBalanceDelta(safeAmount, safeAmount)
    }
  }

  const minusBalance = (source = 'hopper', amount = 20) => {
    const id = deviceIdRef.current
    if (!id) return

    if (source === 'hopper') {
      markDeviceActivity()
      queuePendingBalanceDelta(amount, -amount)
    }
  }

  const addHopperBalance = (amount = 20) => {
    void amount
  }

  const recordBet = (amount = 0) => {
    const id = deviceIdRef.current
    if (!id || amount <= 0) return
    markDeviceActivity()
    queuePendingBalanceDelta(amount, -amount)
    queueMetricEvent(id, 'bet', amount)
  }

  const recordWin = (amount = 0) => {
    const id = deviceIdRef.current
    if (!id || amount <= 0) return
    markDeviceActivity()
    queuePendingBalanceDelta(amount, amount)
    queueMetricEvent(id, 'win', amount)
  }

  const STEP = 20
  const MIN = 20
  const activeWithdrawBalance = runningCasino ? casinoWithdrawState.balance : balance
  const resetWithdrawUi = useCallback(
    (nextAmount = MIN) => {
      withdrawFlowActiveRef.current = false
      withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
      shellStateRef.current = {
        ...shellStateRef.current,
        isWithdrawing: false,
        showWithdrawModal: false,
      }
      setIsWithdrawingRef.current(false)
      setShowWithdrawModalRef.current(false)
      withdrawSubmitPendingRef.current = false
      setWithdrawAmount(nextAmount)
      withdrawRequestedAmountRef.current = 0
      setWithdrawRequestedAmount(0)
      setWithdrawRemainingAmount(0)
    },
    [MIN],
  )
  const getMaxSelectable = (balance: number) => {
    if (!withdrawLimits.enabled) return 0

    let capped = Math.max(0, balance)

    // server max cap (fall back to local balance if server returns 0)
    if (
      typeof withdrawLimits.maxWithdrawalAmount === 'number' &&
      withdrawLimits.maxWithdrawalAmount > 0
    ) {
      capped = Math.min(capped, withdrawLimits.maxWithdrawalAmount)
    }

    // hopper constraint (fall back to local balance if server returns 0)
    if (typeof withdrawLimits.hopperBalance === 'number' && withdrawLimits.hopperBalance > 0) {
      capped = Math.min(capped, withdrawLimits.hopperBalance)
    }

    // ensure at least MIN if we have any balance
    if (capped < MIN && balance >= MIN) {
      capped = MIN
    }

    return Math.floor(capped / STEP) * STEP
  }
  const isValidWithdrawAmount = (amount: number, balanceValue: number) => {
    if (!Number.isFinite(amount)) return false
    const max = getMaxSelectable(balanceValue)
    return amount >= MIN && amount <= max && amount % STEP === 0
  }
  const maxSelectable = getMaxSelectable(activeWithdrawBalance)

  const isWithdrawDisabled = maxSelectable < MIN

  const addWithdrawAmount = () => {
    if (isWithdrawDisabled) return
    setWithdrawAmount(prev => {
      const max = getMaxSelectable(activeWithdrawBalance)
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
    const max = getMaxSelectable(activeWithdrawBalance)

    setWithdrawAmount(prev => {
      const normalized = Math.floor(prev / STEP) * STEP
      const withMin = Math.max(MIN, normalized)
      return Math.min(withMin, max)
    })
  }, [
    showWithdrawModal,
    isWithdrawDisabled,
    activeWithdrawBalance,
    withdrawLimits.maxWithdrawalAmount,
    withdrawLimits.hopperBalance,
    withdrawLimits.enabled,
  ])

  const submitWithdraw = useCallback(async () => {
    if (Date.now() < withdrawInputLockedUntilRef.current) {
      return
    }
    if (withdrawFlowActiveRef.current) {
      return
    }
    withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
    if (!hasLocalLinkRef.current) {
      flashUiNotice('OFFLINE')
      return
    }
    if (
      withdrawSubmitPendingRef.current ||
      isWithdrawing ||
      !isValidWithdrawAmount(withdrawAmount, activeWithdrawBalance)
    ) {
      return
    }
    withdrawSubmitPendingRef.current = true
    withdrawLastActivityAtRef.current = Date.now()
    withdrawRequestedAmountRef.current = withdrawAmount
    setWithdrawRequestedAmount(withdrawAmount)
    setWithdrawRemainingAmount(withdrawAmount)
    setIsWithdrawing(true)
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'WITHDRAW',
          amount: withdrawAmount,
        }),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`withdraw failed (${response.status}): ${errorText}`)
      }
    } catch (error) {
      withdrawSubmitPendingRef.current = false
      if (!withdrawFlowActiveRef.current) {
        setIsWithdrawing(false)
      }
      withdrawRequestedAmountRef.current = 0
      setWithdrawRequestedAmount(0)
      setWithdrawRemainingAmount(0)
      console.error('[WITHDRAW] submit failed', error)
      const message = String((error as Error)?.message || error || '')
      if (message.toLowerCase().includes('max withdrawal amount is')) {
        const match = message.match(/max withdrawal amount is ([0-9.,]+)/i)
        flashUiNotice(match ? `MAX ${match[1]}` : 'MAX WITHDRAW REACHED')
        return
      }
      if (message.toLowerCase().includes('insufficient hopper balance')) {
        flashUiNotice('INSUFFICIENT HOPPER')
        return
      }
      if (message.toLowerCase().includes('withdrawal disabled')) {
        flashUiNotice('WITHDRAW DISABLED')
        return
      }
      flashUiNotice('WITHDRAW FAILED')
    }
  }, [activeWithdrawBalance, flashUiNotice, isWithdrawing, withdrawAmount])

  const finalizeWithdrawFlow = useCallback(
    (dispensedAmount: number) => {
      const actualDispensed = Math.max(0, Math.floor(Number(dispensedAmount || 0) / STEP) * STEP)
      const nextAmount = withdrawRequestedAmountRef.current || MIN

      resetWithdrawUi(nextAmount)

      if (actualDispensed > 0) {
        flashUiNotice(`SUCCESSFULLY WITHDRAWN ${formatPeso(actualDispensed)}`)
      } else {
        flashUiNotice('WITHDRAW FAILED')
      }
    },
    [MIN, flashUiNotice, resetWithdrawUi],
  )

  const openCasinoWithdrawModal = useCallback(() => {
    if (Date.now() < withdrawInputLockedUntilRef.current) {
      return
    }
    if (withdrawFlowActiveRef.current) {
      return
    }
    withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
    if (deploymentMode !== 'online') {
      flashUiNotice('UNDER MAINTENANCE')
      return
    }

    if (!hasLocalLinkRef.current) {
      flashUiNotice('OFFLINE')
      return
    }

    const next = casinoWithdrawStateRef.current
    if (!runningCasinoRef.current || !next.canOpen || next.isWithdrawing) return

    const max = getMaxSelectable(next.balance)

    setWithdrawAmount(prev => {
      const normalized = Math.floor(prev / STEP) * STEP
      const withMin = Math.max(MIN, normalized)
      return Math.min(withMin, max)
    })

    setShowWithdrawModal(true)
  }, [deploymentMode, flashUiNotice])

  const clearExitConfirmTimer = useCallback(() => {
    if (exitConfirmTimerRef.current !== null) {
      window.clearTimeout(exitConfirmTimerRef.current)
      exitConfirmTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isWithdrawing) {
      withdrawLastActivityAtRef.current = 0
      return
    }

    const timer = window.setInterval(() => {
      const lastActivityAt = withdrawLastActivityAtRef.current
      if (!lastActivityAt) return
      if (Date.now() - lastActivityAt < WITHDRAW_STALL_RESET_MS) return

      console.warn('[WITHDRAW] shell watchdog cleared stalled withdraw state', {
        runningCasino: runningCasinoRef.current,
        requestedAmount: withdrawRequestedAmountRef.current,
      })
      resetWithdrawUi(withdrawRequestedAmountRef.current || MIN)
      flashUiNotice('WITHDRAW RESET')
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [MIN, flashUiNotice, isWithdrawing, resetWithdrawUi])

  const closeExitConfirm = useCallback(() => {
    clearExitConfirmTimer()
    exitConfirmDeadlineRef.current = 0
    setShowExitConfirmModal(false)
    setExitConfirmContext(null)
  }, [clearExitConfirmTimer])

  const executeLocalRuntimeReset = useCallback(async () => {
    closeSettingsModal()
    setShowWithdrawModal(false)
    setCasinoLaunchError(null)
    closeExitConfirm()
    setTransitionOverlay({
      visible: true,
      label: 'Resetting Demo...',
      detail: 'Returning to main menu',
    })

    const current = runningGameRef.current
    if (current) {
      if (current.type === 'casino') {
        await new Promise(resolve => window.setTimeout(resolve, EXIT_CONFIRM_WINDOW_MS))
      }

      handleExitGame()
      await new Promise(resolve =>
        window.setTimeout(resolve, current.type === 'casino' ? 350 : 150),
      )
    }

    if (deviceIdRef.current) {
      await clearDeviceRuntimeState(deviceIdRef.current)
      resetPendingBalance()
      applyAuthoritativeBalance({
        balance: 0,
        deploymentMode: 'online',
        updatedAt: new Date().toISOString(),
        revision: 0,
      })
    }

    setWithdrawRequestedAmount(0)
    setWithdrawRemainingAmount(0)
    withdrawRequestedAmountRef.current = 0
    withdrawSubmitPendingRef.current = false
    setIsWithdrawing(false)
    setCasinoWithdrawState({
      canOpen: false,
      balance: 0,
      isWithdrawing: false,
      min: 20,
      step: 20,
    })
    setInitialized(false)

    preparedCasinoVersionRef.current = {}

    try {
      setTransitionOverlay({
        visible: true,
        label: 'Restarting Device...',
        detail: 'Applying reset and rebooting cabinet',
      })
      await executeLocalPowerCommand('restart')
    } catch (error) {
      console.error('[RESET] local reboot request failed', error)
      setTransitionOverlay({
        visible: false,
        label: 'Loading Game...',
        detail: null,
      })
    }
  }, [
    applyAuthoritativeBalance,
    closeExitConfirm,
    closeSettingsModal,
    executeLocalPowerCommand,
    resetPendingBalance,
  ])

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

        if (claimedCommand.command === 'reset') {
          await executeLocalRuntimeReset()
        } else {
          await executeLocalPowerCommand(claimedCommand.command)
        }

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
    [executeLocalPowerCommand, executeLocalRuntimeReset],
  )

  useEffect(() => {
    if (!deviceId) return
    if (!initialized) return
    if (networkStage !== 'ok') return

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
    }, 30000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [deviceId, initialized, networkStage, processAdminCommand])

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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = casinoFrameRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return

      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'ULTRAACE_WITHDRAW_STATE') {
        const nextState: CasinoWithdrawState = {
          canOpen: Boolean(data.canOpen),
          balance: Number(data.balance ?? 0),
          isWithdrawing: Boolean(data.isWithdrawing),
          min: Number(data.min ?? 20),
          step: Number(data.step ?? 20),
        }

        setCasinoWithdrawState(nextState)

        if (showWithdrawModal && !isWithdrawing && !nextState.canOpen) {
          setShowWithdrawModal(false)
        }
        return
      }

      if (data.type === 'ULTRAACE_WITHDRAW_REQUEST') {
        openCasinoWithdrawModal()
        return
      }

      if (data.type === 'ULTRAACE_MENU_EXIT_STATE') {
        setCasinoMenuExitState({
          canExit: Boolean(data.canExit),
        })
        return
      }

      if (data.type === 'ULTRAACE_REQUEST_EXIT_CONFIRM') {
        requestExitConfirm('casino')
        return
      }

      if (data.type === 'ULTRAACE_SHELL_STATE_REQUEST') {
        void (async () => {
          let refreshedBalance = shellStateRef.current.balance
          let refreshedUpdatedAt: string | null = new Date().toISOString()

          if (deviceIdRef.current) {
            try {
              const nextBalance = await fetchDeviceBalance(deviceIdRef.current)
              applyAuthoritativeBalance(nextBalance)
              refreshedBalance = Number(nextBalance.balance ?? 0)
              refreshedUpdatedAt = nextBalance.updatedAt ?? refreshedUpdatedAt
            } catch (error) {
              console.error('[ULTRAACE] shell state balance refresh failed', error)
            }
          }

          frameWindow.postMessage(
            {
              type: 'ARCADE_SHELL_STATE',
              payload: {
                initialized: shellStateRef.current.initialized,
                deviceId: deviceIdRef.current,
                balance: refreshedBalance,
                internetOnline: networkStageRef.current === 'ok',
                networkStage: networkStageRef.current,
                runningCasino: shellStateRef.current.runningCasino,
                updatedAt: refreshedUpdatedAt,
              },
            },
            '*',
          )
        })()
        return
      }

      if (data.type === 'ULTRAACE_ACCOUNTING_REQUEST') {
        const requestId = String((data as any).requestId ?? '').trim()
        const action = String((data as any).action ?? '').trim()
        const payload = (data as any).payload

        if (
          !requestId ||
          action !== 'apply_metric_events' ||
          !payload ||
          typeof payload !== 'object'
        ) {
          return
        }

        const events = Array.isArray((payload as any).events)
          ? ((payload as any).events as MetricEvent[])
          : []
        const writeLedger = Boolean((payload as any).writeLedger)
        const spinKey = String((payload as any).spinKey ?? '').trim()
        const metricDeviceId = String((payload as any).deviceId ?? '').trim()

        void (async () => {
          try {
            if (shouldGuardCasinoAccounting(events)) {
              console.warn('[ULTRAACE] guarded startup accounting request', {
                requestId,
                events,
                guard: casinoEntryGuardRef.current,
              })
              frameWindow.postMessage(
                {
                  type: 'ARCADE_ACCOUNTING_RESPONSE',
                  requestId,
                  ok: true,
                  guarded: true,
                  jackpotPayout: 0,
                },
                '*',
              )
              return
            }

            await applyMetricEventsDirect(events, writeLedger)
            const jackpotPayout =
              spinKey && metricDeviceId ? await fetchSpinJackpotPayout(metricDeviceId, spinKey) : 0

            frameWindow.postMessage(
              {
                type: 'ARCADE_ACCOUNTING_RESPONSE',
                requestId,
                ok: true,
                jackpotPayout,
              },
              '*',
            )
          } catch (error) {
            frameWindow.postMessage(
              {
                type: 'ARCADE_ACCOUNTING_RESPONSE',
                requestId,
                ok: false,
                error: loggableError(error),
              },
              '*',
            )
          }
        })()
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [isWithdrawing, openCasinoWithdrawModal, requestExitConfirm, showWithdrawModal])

  const shellStateRef = useRef({
    initialized: false,
    balance: 0,
    deploymentMode: 'online' as DeploymentMode,
    standbyModeActive: false,
    withdrawAmount: 0,
    isWithdrawing: false,
    showWithdrawModal: false,
    showExitConfirmModal: false,
    runningCasino: false,
    showSettingsModal: false,
    showWifiModal: false,
    noInternetModalActive: false,
    piOfflineLockActive: false,
  })

  useEffect(() => {
    shellStateRef.current = {
      initialized,
      balance,
      deploymentMode,
      standbyModeActive: isStandbyMode,
      withdrawAmount,
      isWithdrawing,
      showWithdrawModal,
      showExitConfirmModal,
      runningCasino,
      showSettingsModal,
      showWifiModal,
      noInternetModalActive: isNoInternetModalActive,
      piOfflineLockActive,
    }
  }, [
    initialized,
    balance,
    deploymentMode,
    isStandbyMode,
    withdrawAmount,
    isWithdrawing,
    showWithdrawModal,
    showExitConfirmModal,
    runningCasino,
    showSettingsModal,
    showWifiModal,
    isNoInternetModalActive,
    piOfflineLockActive,
  ])

  useEffect(() => {
    if (!runningCasino) return

    const frameWindow = casinoFrameRef.current?.contentWindow
    if (!frameWindow) return

    frameWindow.postMessage(
      {
        type: 'ARCADE_SHELL_STATE',
        payload: {
          initialized,
          deviceId,
          balance,
          deploymentMode,
          standbyModeActive: isStandbyMode,
          internetOnline: networkStage === 'ok',
          networkStage,
          runningCasino,
          updatedAt: new Date().toISOString(),
        },
      },
      '*',
    )
  }, [balance, deploymentMode, deviceId, initialized, isStandbyMode, networkStage, runningCasino])

  const addWithdrawAmountRef = useRef(addWithdrawAmount)
  const minusWithdrawAmountRef = useRef(minusWithdrawAmount)
  const submitWithdrawRef = useRef(submitWithdraw)
  const setShowWithdrawModalRef = useRef(setShowWithdrawModal)
  const setIsWithdrawingRef = useRef(setIsWithdrawing)
  const requestExitConfirmRef = useRef(requestExitConfirm)
  const confirmExitRef = useRef(confirmExit)
  const closeExitConfirmRef = useRef(closeExitConfirm)
  const adjustVolumeRef = useRef(adjustVolume)
  const handleSettingsActionRef = useRef(handleSettingsAction)
  const closeSettingsModalRef = useRef(closeSettingsModal)
  const openSettingsModalRef = useRef(openSettingsModal)
  const openOfflineNetworkFlowRef = useRef(openOfflineNetworkFlow)
  const settingsFocusedRef = useRef(settingsFocused)
  const selectedSettingsItemRef = useRef(selectedSettingsItem)

  useEffect(() => {
    setShowWithdrawModalRef.current = setShowWithdrawModal
    setIsWithdrawingRef.current = setIsWithdrawing
    addWithdrawAmountRef.current = addWithdrawAmount
    minusWithdrawAmountRef.current = minusWithdrawAmount
    submitWithdrawRef.current = submitWithdraw
    requestExitConfirmRef.current = requestExitConfirm
    confirmExitRef.current = confirmExit
    closeExitConfirmRef.current = closeExitConfirm
    adjustVolumeRef.current = adjustVolume
    handleSettingsActionRef.current = handleSettingsAction
    closeSettingsModalRef.current = closeSettingsModal
    openSettingsModalRef.current = openSettingsModal
    openOfflineNetworkFlowRef.current = openOfflineNetworkFlow
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
      const shouldForwardCasinoRuntimeEvent = (nextPayload: any) => {
        if (!nextPayload || typeof nextPayload !== 'object') return false

        switch (nextPayload.type) {
          case 'COIN':
            return true
          default:
            return false
        }
      }
      const forwardToCasino = () => {
        if (!canForwardCasinoGameplayInput(payload)) {
          console.log('[ULTRAACE] blocked entry gameplay input', {
            payload,
            guard: casinoEntryGuardRef.current,
          })
          return
        }

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

        setServiceInternetOnline(false)
        setNetworkStage('no-internet')
        return
      }

      if (payload.type === 'INTERNET_RESTORED' || payload.type === 'INTERNET_OK') {
        if (internetLossTimerRef.current) {
          clearTimeout(internetLossTimerRef.current)
          internetLossTimerRef.current = null
        }

        setShowWifiModal(false)
        setShowSettingsModal(false)

        setServiceInternetOnline(true)
        setNetworkStage('ok')
        return
      }

      if (payload.type === 'WIFI_STATUS') {
        setWifiConnected(payload.connected)
        setWifiSignal(payload.signal)
        setWifiSsid(payload.ssid ?? null)
        return
      }

      if (s.standbyModeActive) {
        switch (payload.type) {
          case 'COIN':
          case 'HOPPER_COIN':
          case 'PLAYER':
          case 'ACTION':
            return
        }
      }

      if (payload.type === 'PLAYER' && isUiNavigationPlayer(payload.player) && s.showWifiModal) {
        window.dispatchEvent(
          new CustomEvent('ARCADE_MODAL_INPUT', {
            detail: { button: payload.button },
          }),
        )
        return
      }

      if (
        s.noInternetModalActive &&
        networkStageRef.current !== 'ok' &&
        isOfflineModalConfirmInput(payload)
      ) {
        openOfflineNetworkFlowRef.current()
        return
      }

      if (s.noInternetModalActive) {
        return
      }

      if (!payload) return

      if (s.piOfflineLockActive && payload.type === 'COIN') {
        return
      }

      if (s.runningCasino && shouldForwardCasinoRuntimeEvent(payload)) {
        markDeviceActivity()
        if (payload.type === 'COIN') {
          const safeCredits = Math.max(0, Number(payload.credits ?? 0))
          if (safeCredits > 0) {
            queuePendingBalanceDelta(safeCredits, safeCredits)
          }
        }

        forwardToCasino()
        return
      }

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
        if (shellUpdateStableTimerRef.current !== null) {
          window.clearTimeout(shellUpdateStableTimerRef.current)
          shellUpdateStableTimerRef.current = null
        }
        setShellUpdateOverlayVisible(false)
        setShellUpdateOverlayStatus({ label: 'Checking for updates', detail: null })
        setBootFlowComplete(true)
        setTransitionOverlay({
          visible: true,
          label: 'Loading Game...',
          detail: payload.gameName ? describePreparingGame(payload.gameName) : null,
        })
        return
      }

      if (payload.type === 'GAME_EXITING') {
        setTransitionOverlay({
          visible: true,
          label: 'Returning to Menu...',
          detail: 'LEAVING GAME SESSION',
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

      if (payload.type === 'ULTRAACE_ACTIVITY') {
        markDeviceActivity()
        return
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
            .then(applyAuthoritativeBalance)
            .catch(() => {})
          fetchCabinetGames(deviceIdRef.current)
            .then(setGames)
            .catch(() => {})
        }

        return
      }

      if (payload.type === 'HOPPER_COIN') {
        markDeviceActivity()
        if (s.runningCasino) {
          forwardToCasino()
        }
        addHopperBalance(payload.amount ?? 20)
        return
      }

      if (payload.type === 'WITHDRAW_STARTED') {
        markDeviceActivity()
        withdrawFlowActiveRef.current = true
        withdrawLastActivityAtRef.current = Date.now()
        setIsWithdrawingRef.current(true)
        return
      }

      if (payload.type === 'BET') {
        markDeviceActivity()
        recordBet(payload.amount ?? 0)
        return
      }

      if (payload.type === 'WIN') {
        markDeviceActivity()
        recordWin(payload.amount ?? 0)
        return
      }

      if (s.runningCasino) {
        if (payload.type === 'COIN') {
          markDeviceActivity()
          forwardToCasino()
          return
        }

        if (payload.type === 'WITHDRAW_DISPENSE') {
          markDeviceActivity()
          withdrawFlowActiveRef.current = true
          withdrawLastActivityAtRef.current = Date.now()
          forwardToCasino()
          minusBalance('hopper', payload.dispensed)
          setWithdrawRemainingAmount(prev => Math.max(0, prev - Number(payload.dispensed ?? 0)))
          return
        }

        if (payload.type === 'WITHDRAW_COMPLETE') {
          markDeviceActivity()
          withdrawFlowActiveRef.current = false
          withdrawLastActivityAtRef.current = 0
          forwardToCasino()
          finalizeWithdrawFlow(payload.dispensed)
          return
        }
        if (payload.type === 'WITHDRAW_ABORTED') {
          markDeviceActivity()
          withdrawFlowActiveRef.current = false
          withdrawLastActivityAtRef.current = 0
          forwardToCasino()

          const dispensed = Number(payload.dispensed ?? 0)

          const requested = Number(payload.requested ?? withdrawRequestedAmountRef.current ?? 0)

          resetWithdrawUi(requested || MIN)

          if (dispensed > 0) {
            flashUiNotice(`PARTIAL WITHDRAW ${formatPeso(dispensed)} / ${formatPeso(requested)}`)
          } else {
            flashUiNotice('WITHDRAW ABORTED')
          }

          return
        }
      }

      if (payload.type === 'ULTRAACE_ACTIVITY') {
        markDeviceActivity()
        return
      }

      // ----------------------------------
      // PLAYER INPUT
      // ----------------------------------
      if (payload.type === 'PLAYER' && isUiNavigationPlayer(payload.player)) {
        markDeviceActivity()
        const button = payload.button

        if (s.showWithdrawModal || s.isWithdrawing) {
          if (button === 6 && s.showWithdrawModal && !s.isWithdrawing) {
            setShowWithdrawModalRef.current(false)
            return
          }

          if (s.showWithdrawModal && !s.isWithdrawing) {
            if (button === 'LEFT' || button === 'DOWN') {
              minusWithdrawAmountRef.current()
              return
            }
            if (button === 'RIGHT' || button === 'UP') {
              addWithdrawAmountRef.current()
              return
            }
            if (button === 7 || button === 0 || button === 1) {
              submitWithdrawRef.current()
              return
            }
          }
          return
        }

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
        handleMenuInput(button)
        // ----------------------------
        // MENU INPUT
        // ----------------------------
      }

      if (payload.type === 'ACTION' && (s.showWithdrawModal || s.isWithdrawing)) {
        switch (payload.action) {
          case 'MENU': {
            if (s.showWithdrawModal && !s.isWithdrawing) {
              withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
              setShowWithdrawModalRef.current(false)
            }
            return
          }
          case 'BET_UP': {
            if (s.showWithdrawModal) {
              addWithdrawAmountRef.current()
            }
            return
          }
          case 'BET_DOWN': {
            if (s.showWithdrawModal) {
              minusWithdrawAmountRef.current()
            }
            return
          }
          case 'WITHDRAW': {
            if (withdrawFlowActiveRef.current) {
              return
            }
            if (s.showWithdrawModal && !s.isWithdrawing) {
              submitWithdrawRef.current()
            }
            return
          }
        }
      }

      if (
        s.runningCasino &&
        payload.type === 'PLAYER' &&
        (s.showWithdrawModal || s.isWithdrawing)
      ) {
        return
      }

      if (!s.initialized) return

      if (!s.runningCasino) {
        if (payload.type === 'COIN') {
          addBalance('coin', payload.credits)
          return
        }

        // --- WITHDRAW COMPLETE ---
        if (payload.type === 'WITHDRAW_DISPENSE') {
          withdrawFlowActiveRef.current = true
          withdrawLastActivityAtRef.current = Date.now()
          minusBalance('hopper', payload.dispensed)
          setWithdrawRemainingAmount(prev => Math.max(0, prev - Number(payload.dispensed ?? 0)))
          return
        }

        if (payload.type === 'WITHDRAW_COMPLETE') {
          withdrawFlowActiveRef.current = false
          withdrawLastActivityAtRef.current = 0
          finalizeWithdrawFlow(payload.dispensed)
          return
        }
        if (payload.type === 'WITHDRAW_ABORTED') {
          withdrawFlowActiveRef.current = false
          withdrawLastActivityAtRef.current = 0
          const dispensed = Number(payload.dispensed ?? 0)
          const requested = Number(payload.requested ?? withdrawRequestedAmountRef.current ?? 0)

          resetWithdrawUi(requested || MIN)

          if (dispensed > 0) {
            flashUiNotice(`PARTIAL WITHDRAW ${formatPeso(dispensed)} / ${formatPeso(requested)}`)
          } else {
            flashUiNotice('WITHDRAW ABORTED')
          }

          return
        }

        if (payload.type === 'ACTION' && payload.action === 'MENU') {
          if (s.showWifiModal) {
            closeWifiSettingsToSettings()
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
            if (Date.now() < menuInputSuppressUntilRef.current) {
              return
            }
            if (s.showExitConfirmModal) {
              confirmExitRef.current()
              return
            }
            if (s.showWithdrawModal) {
              withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
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
            if (Date.now() < withdrawInputLockedUntilRef.current) {
              break
            }
            if (withdrawFlowActiveRef.current) {
              break
            }
            if (!s.showWithdrawModal) {
              withdrawInputLockedUntilRef.current = Date.now() + WITHDRAW_INPUT_DEBOUNCE_MS
              setShowWithdrawModalRef.current(true)
            } else if (!s.isWithdrawing && isValidWithdrawAmount(s.withdrawAmount, s.balance)) {
              submitWithdrawRef.current()
            }
            break
          }
        }
      } else if (payload.type === 'ACTION') {
        if (payload.action === 'WITHDRAW') {
          openCasinoWithdrawModal()
          return
        }

        forwardToCasino()
        if (payload.action === 'MENU') {
          if (s.showExitConfirmModal) {
            confirmExitRef.current()
            return
          }
          if (casinoMenuExitStateRef.current.canExit) {
            requestExitConfirmRef.current('casino')
          }
          return
        }
        if (s.showExitConfirmModal) {
          closeExitConfirmRef.current()
        }
      }
    }

    const pendingInputs = Array.isArray(window.__ARCADE_PENDING_INPUTS__)
      ? [...window.__ARCADE_PENDING_INPUTS__]
      : []
    window.__ARCADE_PENDING_INPUTS__ = []

    for (const payload of pendingInputs) {
      try {
        window.__ARCADE_INPUT__?.(payload)
      } catch {}
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
          if (Date.now() < menuInputSuppressUntilRef.current) {
            return
          }
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
        if (Date.now() < menuInputSuppressUntilRef.current) {
          return
        }
        requestExitConfirm('menu')
        break
      case 7: {
        console.log('[UI] start/confirm pressed', {
          selectedGame: selectedGameRef.current,
          focus: focusRef.current,
        })
        if (
          isSelectableGame(selectedGameRef.current) &&
          canAffordGame(selectedGameRef.current, balanceRef.current)
        ) {
          void launch(selectedGameRef.current)
          return
        }
        if (selectedGameRef.current?.type === 'arcade') {
          flashUiNotice('INSUFFICIENT BALANCE')
        }
        break
      }
    }
  }

  function handleExitGame() {
    // if (!runningGame && !runningCasino) return
    const deviceId = deviceIdRef.current
    const endedSessionId = activeSessionIdRef.current
    const endedAt = new Date().toISOString()
    menuInputSuppressUntilRef.current = Date.now() + MENU_INPUT_SUPPRESS_AFTER_EXIT_MS
    shellStateRef.current = {
      ...shellStateRef.current,
      isWithdrawing: false,
      showWithdrawModal: false,
      showExitConfirmModal: false,
      runningCasino: false,
    }
    casinoMenuExitStateRef.current = { canExit: false }
    resetCasinoEntryGuard()
    try {
      casinoFrameRef.current?.blur()
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      window.focus()
    } catch {}
    closeExitConfirm()
    setShowWithdrawModal(false)
    withdrawSubmitPendingRef.current = false
    setIsWithdrawing(false)
    // Reset any latched menu/modal UI state so joystick navigation resumes on the grid.
    setShowSettingsModal(false)
    setShowWifiModal(false)
    setSettingsFocused(false)
    setWithdrawRequestedAmount(0)
    setWithdrawRemainingAmount(0)
    withdrawRequestedAmountRef.current = 0
    setCasinoWithdrawState({
      canOpen: false,
      balance: 0,
      isWithdrawing: false,
      min: 20,
      step: 20,
    })
    setCasinoMenuExitState({ canExit: false })
    setRunningGame(null)
    setRunningCasino(false)
    setRunningCasinoSrc(null)
    activeSessionIdRef.current = null
    setArcadeLifeOverlay(prev => ({
      ...prev,
      active: false,
      status: 'idle',
      p1Unlocked: false,
      p2Unlocked: false,
    }))
    exitGame()
    if (deviceId) {
      void (async () => {
        if (endedSessionId) {
          const { error } = await supabase.rpc('end_device_game_session', {
            p_device_id: deviceId,
            p_session_id: endedSessionId,
            p_reason: 'game_exit',
          })
          if (error) {
            console.error('[DEVICE] failed to end game session', error)
          }
        }

        await syncDeviceRuntimeState({
          deviceId,
          status: 'idle',
          currentGameId: null,
          currentGameName: null,
          currentGameType: null,
          activeSessionId: null,
          sessionEndedAt: endedAt,
          lastSeenAt: endedAt,
        }).catch(error => {
          console.error('[DEVICE] failed to clear game state', error)
        })
      })()
    }
  }

  const bgOffset = (Math.floor(focus / GRID_ROWS) % GRID_VISIBLE_COLS) * 6

  function moveFocus(delta: number) {
    setSettingsFocused(false)
    setFocus(prev => {
      const currentGames = gamesRef.current
      return findNextSelectableGameIndex(currentGames, prev, delta)
    })
  }

  useEffect(() => {
    setFocus(prev => {
      if (games.length === 0) return 0
      const firstSelectable = findFirstSelectableGameIndex(games)
      if (firstSelectable < 0) return 0
      if (prev >= games.length) return firstSelectable
      if (!isSelectableGame(games[prev])) return firstSelectable
      return prev
    })
  }, [findFirstSelectableGameIndex, games, isSelectableGame])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isStandbyMode) {
        if (
          e.key === 'Enter' ||
          e.key === 'Escape' ||
          e.key.startsWith('Arrow') ||
          e.key === ' ' ||
          e.key === 'Tab'
        ) {
          e.preventDefault()
        }
        return
      }

      if (isNoInternetModalActive) {
        if (e.key === 'Enter') {
          e.preventDefault()
          openOfflineNetworkFlow()
          return
        }

        if (e.key.startsWith('Arrow') || e.key === 'Escape' || e.key === ' ' || e.key === 'Tab') {
          e.preventDefault()
        }
        return
      }

      if (showWithdrawModal || isWithdrawing) {
        switch (e.key) {
          case 'Escape':
            e.preventDefault()
            if (!isWithdrawing) {
              setShowWithdrawModal(false)
            }
            return
          case 'ArrowLeft':
          case 'ArrowDown':
            e.preventDefault()
            if (!isWithdrawing) {
              minusWithdrawAmount()
            }
            return
          case 'ArrowRight':
          case 'ArrowUp':
            e.preventDefault()
            if (!isWithdrawing) {
              addWithdrawAmount()
            }
            return
          case 'Enter':
            e.preventDefault()
            if (!isWithdrawing) {
              void submitWithdraw()
            }
            return
          default:
            return
        }
      }

      if (showWifiModal) {
        return
      }

      if (e.key === 'Escape') {
        if (showSettingsModal) {
          closeSettingsModal()
          return
        }
        if (devInputBypassEnabled) return
        const context: ExitConfirmContext = runningCasino ? 'casino' : 'menu'
        requestExitConfirm(context)
        return
      }

      if (showSettingsModal) {
        switch (e.key) {
          case 'ArrowUp':
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
          case 'ArrowDown':
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
          case 'ArrowLeft':
          case 'ArrowRight':
            if (selectedSettingsItem === 'volume') {
              void adjustVolume(e.key === 'ArrowLeft' ? 'down' : 'up')
            }
            return
          case 'Enter':
            void handleSettingsAction()
            return
          default:
            return
        }
      }

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
          if (!isSelectableGame(selectedGame)) return
          if (!canAffordGame(selectedGame, balanceRef.current)) {
            if (selectedGame?.type === 'arcade') {
              flashUiNotice('INSUFFICIENT BALANCE')
            }
            return
          }
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
    closeSettingsModal,
    requestExitConfirm,
    runningCasino,
    canAffordGame,
    flashUiNotice,
    isSelectableGame,
    selectedGame,
    selectedSettingsItem,
    adjustVolume,
    addWithdrawAmount,
    minusWithdrawAmount,
    openOfflineNetworkFlow,
    showWithdrawModal,
    isWithdrawing,
    isNoInternetModalActive,
    isStandbyMode,
    settingsFocused,
    showSettingsModal,
    submitWithdraw,
    devInputBypassEnabled,
    showWifiModal,
  ])

  useEffect(() => {
    if (!devInputBypassEnabled) return

    async function sendDevInput(payload: Record<string, unknown>) {
      try {
        await fetch('http://localhost:5174/dev-input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch (error) {
        console.error('[DEV INPUT] failed to forward payload', error)
      }
    }

    function onDevKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return
      if (event.repeat) return
      if (isStandbyMode) {
        return
      }
      if (piOfflineLockActive) {
        return
      }
      if (showWithdrawModal || isWithdrawing) {
        return
      }
      if (showWifiModal || showSettingsModal) return

      switch (event.key) {
        case 'w':
        case 'W':
          event.preventDefault()
          void sendDevInput({ type: 'PLAYER', player: 'P1', button: 'UP' })
          return
        case 's':
        case 'S':
          event.preventDefault()
          void sendDevInput({ type: 'PLAYER', player: 'P1', button: 'DOWN' })
          return
        case 'a':
        case 'A':
          event.preventDefault()
          void sendDevInput({ type: 'PLAYER', player: 'P1', button: 'LEFT' })
          return
        case 'd':
        case 'D':
          event.preventDefault()
          void sendDevInput({ type: 'PLAYER', player: 'P1', button: 'RIGHT' })
          return
        case ' ':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'SPIN' })
          return
        case 'q':
        case 'Q':
        case 'Escape':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'MENU' })
          return
        case 'c':
        case 'C':
          event.preventDefault()
          void sendDevInput({ type: 'COIN', credits: 5 })
          return
        case 'v':
        case 'V':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'WITHDRAW' })
          return
        case '-':
        case '_':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'BET_DOWN' })
          return
        case '=':
        case '+':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'BET_UP' })
          return
        case 'r':
        case 'R':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'AUTO' })
          return
        case 't':
        case 'T':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'TURBO' })
          return
        case 'b':
        case 'B':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'BUY' })
          return
        case 'm':
        case 'M':
          event.preventDefault()
          void sendDevInput({ type: 'ACTION', action: 'AUDIO' })
          return
      }
    }

    window.addEventListener('keydown', onDevKey)
    return () => window.removeEventListener('keydown', onDevKey)
  }, [
    devInputBypassEnabled,
    showSettingsModal,
    showWifiModal,
    showWithdrawModal,
    isWithdrawing,
    isStandbyMode,
    piOfflineLockActive,
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

    if (deploymentMode !== 'online') {
      flashUiNotice('UNDER MAINTENANCE')
      return
    }

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

    if (game.type === 'arcade' && !canAffordGame(game, balanceRef.current)) {
      console.warn('[LAUNCH] aborted: insufficient balance', {
        id: game.id,
        balance: balanceRef.current,
        price: game.price,
      })
      flashUiNotice('INSUFFICIENT BALANCE')
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

      setCasinoPreparingDetail(describePreparingGame(game.name))
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
      startCasinoEntryGuard()
      setRunningGame({ id: game.id, name: game.name, type: 'casino' })

      setRunningCasinoSrc(entry)
      setRunningCasino(true)
      markDeviceActivity()
      void startDeviceSession({ id: game.id, name: game.name, type: 'casino' }).catch(error => {
        console.error('[DEVICE] failed to start casino session', error)
      })
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
        detail: describePreparingGame(game.name),
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
        if (response.status === 402) {
          flashUiNotice('INSUFFICIENT BALANCE')
        }
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

      setRunningGame({
        id: game.id,
        name: game.name,
        type: 'arcade',
        core: game.emulator_core,
        rom: game.rom_path,
      })
      markDeviceActivity()
      void startDeviceSession({ id: game.id, name: game.name, type: 'arcade' }).catch(error => {
        console.error('[DEVICE] failed to start arcade session', error)
      })

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

  function describePreparingGame(name: string | null | undefined) {
    const text = String(name ?? '').trim()
    return text ? `PREPARING ${text.toUpperCase()}` : 'PREPARING GAME'
  }

  function normalizeBootOverlayLabel(
    label: string | null | undefined,
    detail: string | null | undefined,
  ) {
    const normalizedLabel = String(label ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    const normalizedDetail = String(detail ?? '')
      .trim()
      .replace(/\s+/g, ' ')

    if (/fetching games/i.test(normalizedLabel)) {
      return 'Updating Assets'
    }

    if (/updating system|installing update/i.test(normalizedLabel)) {
      return 'Preparing UltraAce'
    }

    if (/using local test build/i.test(normalizedLabel)) {
      return 'Preparing UltraAce'
    }

    if (/games ready/i.test(normalizedLabel)) {
      return 'Assets Ready'
    }

    if (/^ultraace[-_.\w]*/i.test(normalizedDetail)) {
      return 'Preparing UltraAce'
    }

    return normalizedLabel
  }

  function normalizeBootOverlayDetail(
    label: string | null | undefined,
    detail: string | null | undefined,
  ) {
    const normalizedLabel = String(label ?? '')
      .trim()
      .replace(/\s+/g, ' ')
    const normalizedDetail = String(detail ?? '')
      .trim()
      .replace(/\s+/g, ' ')

    if (!normalizedDetail) return null

    if (/fetching games/i.test(normalizedLabel)) {
      return normalizedDetail
    }

    if (/updating system|installing update|using local test build/i.test(normalizedLabel)) {
      return null
    }

    return normalizedDetail
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

  function EthernetIndicator() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="28" height="20" viewBox="0 0 24 24">
          <path
            fill="#ffd84d"
            d="M6 2h12a2 2 0 0 1 2 2v6h-2V4H6v6H4V4a2 2 0 0 1 2-2zm-2 10h16v6a2 2 0 0 1-2 2h-4v2h-4v-2H6a2 2 0 0 1-2-2v-6zm4 2v2h2v-2H8zm6 0v2h2v-2h-2z"
          />
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
      {isStandbyMode && <StandbyModal elevated />}
      {!isStandbyMode && isNoInternetModalActive && (
        <NoInternetModal
          onConnect={openOfflineNetworkFlow}
          wifiConnected={wifiConnected}
          currentSsid={wifiSsid}
          elevated
        />
      )}
      {showWifiModal && (
        <WifiSetupModal
          onConnected={() => {
            setShowWifiModal(false)
            setNetworkStage('ok')
            flashUiNotice('NETWORK READY')
          }}
          onClose={closeWifiSettingsToSettings}
          onDeleteKnownProfile={deleteKnownWifiProfile}
          wifiConnected={wifiConnected}
          currentSsid={wifiSsid}
          currentIp={ethernetIp ?? wifiIp}
          ethernetName={ethernetName ?? wifiName}
        />
      )}
      {showSettingsModal && (
        <SettingsModal
          selected={selectedSettingsItem}
          volumeLabel={volumeLabel}
          volumePercent={volumePercent}
          offline={piOfflineLockActive}
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
          balance={activeWithdrawBalance}
          isWithdrawing={isWithdrawing}
          requestedAmount={withdrawRequestedAmount}
          remainingAmount={withdrawRemainingAmount}
          loading={withdrawLimitsLoading}
          available={withdrawLimits.enabled}
          maxSelectableAmount={maxSelectable >= MIN ? maxSelectable : 0}
          elevated={runningCasino}
          onAddAmount={addWithdrawAmount}
          onMinusAmount={minusWithdrawAmount}
          onCancel={() => setShowWithdrawModal(false)}
          onConfirm={submitWithdraw}
        />
      )}
      {showExitConfirmModal && (
        <ExitConfirmModal
          context={exitConfirmContext ?? (runningCasino ? 'casino' : 'menu')}
          onCancel={closeExitConfirm}
          onConfirm={confirmExit}
        />
      )}
      <div className="scene-bg" style={{ backgroundImage: `url(${selectedGameArt})` }} />

      {!runningCasino && (
        <div className="top-status-bar">
          <div className="top-status-left">
            <div className="top-status-network">
              {isWifi ? (
                <WifiIndicator signal={wifiSignal} connected={wifiConnected} />
              ) : isEthernet ? (
                <EthernetIndicator />
              ) : (
                <WifiIndicator signal={null} connected={false} />
              )}
              <span className="top-status-ssid">
                {isWifi ? wifiSsid?.trim() || 'WIFI' : isEthernet ? 'ETHERNET' : 'OFFLINE'}
              </span>
            </div>
            {networkLatencyMs !== null && (
              <div
                className={`top-status-latency ${networkLatencyMs > 300 ? 'slow' : networkLatencyMs > 150 ? 'medium' : ''}`}
              >
                {networkLatencyMs}ms
              </div>
            )}
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
            <ArcadeShellVersionBadge deviceId={deviceId} />
          </div>
          {piOfflineLockActive && runningGame?.type === 'arcade' && (
            <div
              style={{
                position: 'fixed',
                top: 86,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100001,
                padding: '10px 18px',
                borderRadius: 999,
                background: 'rgba(0, 0, 0, 0.9)',
                border: '1px solid rgba(255, 87, 87, 0.95)',
                color: '#ffb0b0',
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                pointerEvents: 'none',
              }}
            >
              Offline
            </div>
          )}
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
