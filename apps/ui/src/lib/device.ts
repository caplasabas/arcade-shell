import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'
import { API_BASE } from './runtime'

let cachedDeviceId: string | null = null

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

  if (lookupError) throw lookupError

  const payload =
    existing && existing.device_id
      ? { device_id: deviceId }
      : nextName
        ? { device_id: deviceId, name: nextName }
        : { device_id: deviceId }

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'device_id' })

  if (error) throw error

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
      updated_at: clearedAt,
    })
    .eq('device_id', deviceId)

  if (error) throw error
}
