import { supabase } from './supabase'

export async function fetchDeviceBalance(deviceId: string) {
  const { data, error } = await supabase
    .from('devices')
    .select('balance')
    .eq('device_id', deviceId)
    .single()

  if (error) throw error

  return data.balance ?? 0
}

export function subscribeToDeviceBalance(deviceId: string, onChange: (balance: number) => void) {
  let disposed = false
  let reconnectTimer: number | null = null
  let channel: ReturnType<typeof supabase.channel> | null = null

  const syncLatest = async () => {
    try {
      const latest = await fetchDeviceBalance(deviceId)
      if (!disposed) {
        onChange(latest)
      }
    } catch {
      // Keep subscription alive; periodic/app-level recovery handles retries.
    }
  }

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      if (!disposed) {
        connect()
      }
    }, 1500)
  }

  const connect = () => {
    if (disposed) return
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }

    channel = supabase
      .channel(`device-balance-${deviceId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
          filter: `device_id=eq.${deviceId}`,
        },
        payload => {
          onChange(payload.new.balance)
        },
      )
      .subscribe(status => {
        if (disposed) return

        if (status === 'SUBSCRIBED') {
          syncLatest()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect()
        }
      })
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  }
}
