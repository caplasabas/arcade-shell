import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'
import { API_BASE } from './runtime'

let cachedDeviceId: string | null = null

export type DeviceStatus = 'offline' | 'idle' | 'playing' | 'error'
export type DeviceGameType = 'arcade' | 'casino' | null

function normalizeError(err: unknown) {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? 'unknown error') }
  }

  return {
    message: String((err as any).message ?? 'unknown error'),
    code: (err as any).code ?? null,
    details: (err as any).details ?? null,
    hint: (err as any).hint ?? null,
    status: (err as any).status ?? null,
  }
}

supabase.channel('debug').subscribe(status => {
  console.log('Realtime status:', status)
})

export async function getDeviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId

  try {
    console.log('Fetching hardware ID...')
    const res = await fetch(`${API_BASE}/device-id`, {
      signal: AbortSignal.timeout(3000),
    })
    console.log('Response status:', res.status)

    if (!res.ok) throw new Error('No input service')

    const data = await res.json()
    const hardwareId = String(data?.deviceId ?? '').trim()

    if (!hardwareId) {
      throw new Error('Empty hardware ID received')
    }

    console.log('Hardware ID received:', hardwareId)

    cachedDeviceId = hardwareId
    localStorage.setItem('arcade_device_id', hardwareId)
    return cachedDeviceId
  } catch (err) {
    console.error('Falling back to dev ID because:', err)

    const existingId = String(localStorage.getItem('arcade_device_id') ?? '').trim()
    if (existingId && !existingId.startsWith('dev-')) {
      cachedDeviceId = existingId
      return cachedDeviceId
    }

    let devId = existingId

    if (!devId) {
      devId = `dev-${uuidv4()}`
      localStorage.setItem('arcade_device_id', devId)
    }

    cachedDeviceId = devId
    return cachedDeviceId
  }
}

export async function ensureDeviceRegistered(name?: string) {
  const deviceId = await getDeviceId()

  if (!deviceId) throw new Error('Device not registered')

  const nextName = String(name ?? '').trim()
  const { data: existing, error: lookupError } = await supabase
    .from('devices')
    .select('device_id,name')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (lookupError) {
    console.error(
      '[DEVICE] browser lookup failed, trying local register fallback',
      normalizeError(lookupError),
    )

    const response = await fetch(`${API_BASE}/device-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name: String(name ?? '').trim() || null,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`local device register failed (${response.status})${text ? `: ${text}` : ''}`)
    }

    return deviceId
  }

  const payload =
    existing && existing.device_id
      ? { device_id: deviceId }
      : nextName
        ? { device_id: deviceId, name: nextName }
        : { device_id: deviceId }

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'device_id' })

  if (error) {
    console.error(
      '[DEVICE] browser upsert failed, trying local register fallback',
      normalizeError(error),
    )

    const response = await fetch(`${API_BASE}/device-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        name: nextName || null,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`local device register failed (${response.status})${text ? `: ${text}` : ''}`)
    }
  }

  return deviceId
}

export async function clearDeviceRuntimeState(deviceId: string) {
  const clearedAt = new Date().toISOString()

  const { error } = await supabase
    .from('devices')
    .update({
      balance: 0,
      hopper_balance: 0,
      coins_in_total: 0,
      hopper_in_total: 0,
      hopper_out_total: 0,
      bet_total: 0,
      win_total: 0,
      withdraw_total: 0,
      spins_total: 0,
      arcade_credit: 0,
      arcade_credit_updated_at: clearedAt,
      arcade_time_ms: 0,
      arcade_time_updated_at: clearedAt,
      arcade_session_started_at: null,
      arcade_time_last_deducted_at: null,
      arcade_total: 0,
      current_game_id: null,
      current_game_name: null,
      current_game_type: null,
      device_status: 'idle',
      active_session_id: null,
      session_started_at: null,
      session_last_heartbeat: clearedAt,
      session_ended_at: clearedAt,
      last_seen_at: clearedAt,
      last_activity_at: null,
      updated_at: clearedAt,
    })
    .eq('device_id', deviceId)

  if (error) throw error
}

type SyncDeviceRuntimeStateInput = {
  deviceId: string
  status?: DeviceStatus
  currentGameId?: string | null
  currentGameName?: string | null
  currentGameType?: DeviceGameType
  arcadeShellVersion?: string | null
  currentIp?: string | null
  lastSeenAt?: string | null
  lastActivityAt?: string | null
  activeSessionId?: number | null
  sessionStartedAt?: string | null
  sessionEndedAt?: string | null
}

export async function syncDeviceRuntimeState({
  deviceId,
  status,
  currentGameId,
  currentGameName,
  currentGameType,
  arcadeShellVersion,
  currentIp,
  lastSeenAt,
  lastActivityAt,
  activeSessionId,
  sessionStartedAt,
  sessionEndedAt,
}: SyncDeviceRuntimeStateInput) {
  const payload: Record<string, unknown> = {
    device_id: deviceId,
  }

  if (status) payload.device_status = status
  if (currentGameId !== undefined) payload.current_game_id = currentGameId
  if (currentGameName !== undefined) payload.current_game_name = currentGameName
  if (currentGameType !== undefined) payload.current_game_type = currentGameType
  if (arcadeShellVersion !== undefined) payload.arcade_shell_version = arcadeShellVersion
  if (currentIp !== undefined) payload.current_ip = currentIp
  if (lastSeenAt !== undefined) payload.last_seen_at = lastSeenAt
  if (lastActivityAt !== undefined) payload.last_activity_at = lastActivityAt
  if (activeSessionId !== undefined) payload.active_session_id = activeSessionId
  if (sessionStartedAt !== undefined) payload.session_started_at = sessionStartedAt
  if (sessionEndedAt !== undefined) payload.session_ended_at = sessionEndedAt

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'device_id' })
  if (error) throw error
}
