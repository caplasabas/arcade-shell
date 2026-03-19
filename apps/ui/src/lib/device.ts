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

  const { error } = await supabase
    .from('devices')
    .upsert({ device_id: deviceId, name: name ?? null }, { onConflict: 'device_id' })

  if (error) throw error

  return deviceId
}
