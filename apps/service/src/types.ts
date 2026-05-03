export type GameType = 'arcade' | 'casino'

export type SessionState = 'IDLE' | 'LAUNCHING' | 'RUNNING' | 'CONTINUE_WAIT'

export type OverlayMode = 'WAIT_COIN' | 'READY_TO_START' | 'RUNNING' | 'CONTINUE'

export type RuntimeMode = 'cabinet' | 'web'

export type JoystickAction =
  | 'SPIN'
  | 'BET_DOWN'
  | 'BET_UP'
  | 'AUTO'
  | 'COIN'
  | 'WITHDRAW'
  | 'WITHDRAW_COIN'
  | 'TURBO'
  | 'BUY'
  | 'MENU'
  | 'AUDIO'
  | 'HOPPER_COIN'

export interface GameDefinition {
  id: string
  type: GameType
  price: number
  core?: string
  rom?: string
}

export interface SessionSnapshot {
  state: SessionState
  game: GameDefinition | null
  startedAt: number | null
  paid: boolean
  continueDeadline: number | null
}

export interface OverlayState {
  mode: OverlayMode
  balancePeso: number
  gameId: string | null
  price: number | null
  paid: boolean
  continueSeconds: number | null
}

export interface ServiceConfig {
  host: string
  port: number
  localApiOrigin: string
  serviceDir: string
  runtimeDir: string
  romsRoot: string
  uiDistDir: string
  runtimeGamesDir: string
  retroarchReadyFile: string
  supabaseUrl: string
  supabaseServiceKey: string
  arcadeLifePriceDefault: number
  isLinux: boolean
  isMacOs: boolean
  forcePiMode: boolean
  isPi: boolean
  devInputBypassEnabled: boolean
}

export interface RuntimeAuthContext {
  deviceId: string | null
  runtimeMode: RuntimeMode
  backendAuthority: 'input-service'
}

export interface NetworkInfo {
  ethernet: string | null
  wifi: string | null
  ethernet_name: string | null
  wifi_name: string | null
}

export interface WithdrawLimits {
  success: boolean
  enabled: boolean
  balance: number
  hopperBalance: number
  configuredMax: number | null
  maxWithdrawalAmount: number | null
}

export interface DeviceStateSnapshot {
  deviceId: string | null
  runtimeMode: RuntimeMode
  backendAuthority: 'input-service'
  connected: boolean
  lastSeenAt: string | null
  lastActivityAt: string | null
  balance: number
  hopperBalance?: number
  arcadeCredit?: number
  arcadeTimeMs?: number
  withdrawEnabled?: boolean
  deploymentMode?: string | null
  processActive: boolean
  note?: string
}

export interface CoinConfig {
  idleGapMs: number
  pesoByPulseCount: Record<number, number>
}

export interface HopperConfig {
  gpioChip: string
  payPin: number
  coinInhibitPin: number
  timeoutMs: number
  noPulseTimeoutMs: number
  topupCoinValue: number
}

export interface InternetConfig {
  probeTimeoutSec: number
  monitorIntervalMs: number
  failThreshold: number
  restoreThreshold: number
}

export interface BuyFlowConfig {
  confirmWindowMs: number
  arcadeTimePurchaseMs: number
}
